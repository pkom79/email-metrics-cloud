import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Request a link to an existing brand. Only agency owner can request.
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { agencyId, accountId } = await request.json().catch(() => ({}));
    if (!agencyId || !accountId) {
      return NextResponse.json({ error: 'Missing agencyId or accountId' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify requester is the agency owner
    const { data: ag, error: agErr } = await supabase
      .from('agencies')
      .select('id')
      .eq('id', agencyId)
      .eq('owner_user_id', user.id)
      .single();
    if (agErr || !ag) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Upsert: if a request for (agency_id, account_id) already exists, refresh token and reset status
    const { data: lr, error } = await supabase
      .from('link_requests')
      .upsert({
        agency_id: agencyId,
        account_id: accountId,
        token_hash,
        requested_by: user.id,
        status: 'pending',
        expires_at,
        acted_by: null,
        acted_at: null,
      } as any, { onConflict: 'agency_id,account_id' })
      .select('id, account_id')
      .single();
    if (error) throw error;

    // Audit (non-fatal)
    try {
      await supabase.rpc('audit_log_event', {
        p_action: 'agency_link_requested',
        p_target_table: 'link_requests',
        p_target_id: lr.id,
        p_account_id: lr.account_id,
        p_details: { agency_id: agencyId }
      });
    } catch {}

    // Notify the brand owner directly via outbox (even if they didn't configure subscriptions)
    try {
      const { data: acc } = await supabase.from('accounts').select('owner_user_id').eq('id', accountId).single();
      if (acc?.owner_user_id) {
        await supabase.from('notifications_outbox').insert({
          topic: 'agency_link_requested',
          account_id: accountId,
          recipient_user_id: acc.owner_user_id,
          payload: { agency_id: agencyId }
        } as any);
      }
    } catch {}

    // Opportunistically trigger the notifications worker now to avoid delays
    try {
      const url = new URL(request.url);
      await fetch(`${url.origin}/api/cron/notifications`).catch(() => {});
    } catch {}

    return NextResponse.json({ ok: true, token: rawToken });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to request link' }, { status: 500 });
  }
}
