import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { ServerClient } from 'postmark';

export const runtime = 'nodejs';

// Lightweight notifications worker invoked by Vercel Cron (GET)
// - Reads pending rows from notifications_outbox
// - Sends via Postmark using your generic notification template
// - Updates status with retries and backoff
export async function GET() {
  try {
    // Basic config validation
    const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
    const POSTMARK_FROM = process.env.POSTMARK_FROM;
    const POSTMARK_TEMPLATE_NOTIFICATION_ID = process.env.POSTMARK_TEMPLATE_NOTIFICATION_ID; // generic fallback
    const POSTMARK_TEMPLATE_DATA_UPDATED_ID = process.env.POSTMARK_TEMPLATE_DATA_UPDATED_ID || POSTMARK_TEMPLATE_NOTIFICATION_ID;
    const POSTMARK_TEMPLATE_MEMBER_INVITED_ID = process.env.POSTMARK_TEMPLATE_MEMBER_INVITED_ID || POSTMARK_TEMPLATE_NOTIFICATION_ID;
    const POSTMARK_TEMPLATE_MEMBER_REVOKED_ID = process.env.POSTMARK_TEMPLATE_MEMBER_REVOKED_ID || POSTMARK_TEMPLATE_NOTIFICATION_ID;
    const POSTMARK_TEMPLATE_AGENCY_REQUESTED_ID = process.env.POSTMARK_TEMPLATE_AGENCY_REQUESTED_ID || POSTMARK_TEMPLATE_NOTIFICATION_ID;
    const POSTMARK_TEMPLATE_AGENCY_APPROVED_ID = process.env.POSTMARK_TEMPLATE_AGENCY_APPROVED_ID || POSTMARK_TEMPLATE_NOTIFICATION_ID;
    const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://emailmetrics.io';

    if (!POSTMARK_SERVER_TOKEN || !POSTMARK_FROM || !POSTMARK_TEMPLATE_NOTIFICATION_ID) {
      return NextResponse.json({
        ok: false,
        error: 'Postmark env not set (POSTMARK_SERVER_TOKEN, POSTMARK_FROM, POSTMARK_TEMPLATE_NOTIFICATION_ID)'
      }, { status: 500 });
    }

    const postmark = new ServerClient(POSTMARK_SERVER_TOKEN);

    // Fetch a small batch of pending notifications
    const { data: rows, error } = await supabaseAdmin
      .from('notifications_outbox')
      .select('*')
      .eq('status', 'pending')
      .lte('deliver_after', new Date().toISOString())
      .limit(50);
    if (error) throw error;

    let processed = 0;
    const found = (rows ?? []).length;

    for (const row of rows ?? []) {
      // Claim row (avoid double-send)
      const { data: claim, error: upd1 } = await supabaseAdmin
        .from('notifications_outbox')
        .update({ status: 'processing', attempts: (row.attempts ?? 0) + 1 })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id, attempts')
        .single();
      if (upd1 || !claim) continue;

      try {
        // Resolve dynamic variables
        const { data: acc } = await supabaseAdmin
          .from('accounts')
          .select('name, company')
          .eq('id', row.account_id)
          .single();
        const brandName = acc?.company || acc?.name || 'Brand';
        // Build CTA URL; for member_invited and agency_link_requested include tokens when available
        const tokenFromPayload = (row as any)?.payload?.token as string | undefined;
        let ctaUrl = `${SITE_URL}/dashboard?account=${row.account_id}`;
        if (row.topic === 'member_invited' && tokenFromPayload) {
          ctaUrl = `${SITE_URL}/invitations/accept?token=${encodeURIComponent(tokenFromPayload)}`;
        } else if (row.topic === 'agency_link_requested' && tokenFromPayload) {
          ctaUrl = `${SITE_URL}/agency/approve?token=${encodeURIComponent(tokenFromPayload)}`;
        }
        // Resolve recipient email (prefer explicit email)
        const to = row.recipient_email || (await resolveUserEmail(row.recipient_user_id));
        if (!to) throw new Error('No recipient');

        // Pick template + model copy by topic
        const topic = String(row.topic);
        let TemplateId = Number(POSTMARK_TEMPLATE_NOTIFICATION_ID);
        let model: any = { brand_name: brandName, cta_url: ctaUrl };
        if (topic === 'csv_uploaded') {
          TemplateId = Number(POSTMARK_TEMPLATE_DATA_UPDATED_ID);
          model = { brand_name: brandName, cta_url: ctaUrl, headline: `New data available for ${brandName}`, cta_label: 'View dashboard' };
        } else if (topic === 'member_invited') {
          TemplateId = Number(POSTMARK_TEMPLATE_MEMBER_INVITED_ID);
          model = { brand_name: brandName, cta_url: ctaUrl, headline: `You’re invited to join ${brandName}`, cta_label: 'Accept invite' };
        } else if (topic === 'member_revoked') {
          TemplateId = Number(POSTMARK_TEMPLATE_MEMBER_REVOKED_ID);
          model = { brand_name: brandName, cta_url: ctaUrl, headline: `Access removed for ${brandName}`, cta_label: 'Open dashboard' };
        } else if (topic === 'agency_link_requested') {
          TemplateId = Number(POSTMARK_TEMPLATE_AGENCY_REQUESTED_ID);
          model = { brand_name: brandName, cta_url: ctaUrl, headline: `Agency access requested for ${brandName}`, cta_label: 'Review in dashboard' };
        } else if (topic === 'agency_link_approved') {
          TemplateId = Number(POSTMARK_TEMPLATE_AGENCY_APPROVED_ID);
          model = { brand_name: brandName, cta_url: ctaUrl, headline: `Agency linked to ${brandName}`, cta_label: 'View brand' };
        }

        await postmark.sendEmailWithTemplate({
          From: POSTMARK_FROM,
          To: to,
          TemplateId,
          MessageStream: process.env.POSTMARK_STREAM || 'outbound',
          TemplateModel: model,
        });

        await supabaseAdmin
          .from('notifications_outbox')
          .update({ status: 'sent' })
          .eq('id', row.id);
        processed++;
      } catch (e: any) {
        const attempts = (row.attempts ?? 0) + 1;
        const nextStatus = attempts >= 5 ? 'dead' : 'pending';
        const delayMs = Math.min(60 * 60 * 1000, 2 ** attempts * 1000); // exponential backoff up to 1h
        await supabaseAdmin
          .from('notifications_outbox')
          .update({
            status: nextStatus,
            last_error: String(e?.message || e),
            deliver_after: new Date(Date.now() + delayMs).toISOString(),
          })
          .eq('id', row.id);
      }
    }

    return NextResponse.json({ ok: true, found, processed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Worker error' }, { status: 500 });
  }
}

async function resolveUserEmail(userId?: string | null) {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user?.email ?? null;
}
