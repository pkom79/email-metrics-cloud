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
    const POSTMARK_TEMPLATE_NOTIFICATION_ID = process.env.POSTMARK_TEMPLATE_NOTIFICATION_ID;
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
        // Build CTA URL; for member_invited include the acceptance token when available
        const tokenFromPayload = (row as any)?.payload?.token as string | undefined;
        const ctaUrl = row.topic === 'member_invited' && tokenFromPayload
          ? `${SITE_URL}/invitations/accept?token=${encodeURIComponent(tokenFromPayload)}`
          : `${SITE_URL}/dashboard?account=${row.account_id}`;

        // Resolve recipient email (prefer explicit email)
        const to = row.recipient_email || (await resolveUserEmail(row.recipient_user_id));
        if (!to) throw new Error('No recipient');

        await postmark.sendEmailWithTemplate({
          From: POSTMARK_FROM,
          To: to,
          TemplateId: Number(POSTMARK_TEMPLATE_NOTIFICATION_ID),
          MessageStream: process.env.POSTMARK_STREAM || 'outbound',
          TemplateModel: {
            brand_name: brandName,
            cta_url: ctaUrl,
          },
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
