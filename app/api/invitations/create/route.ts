import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Create a member invitation for a brand account. Owner-only.
// POST body: { accountId: string, email: string }
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { accountId, email } = await request.json().catch(() => ({}));
    if (!accountId || !email) {
      return NextResponse.json({ error: 'Missing accountId or email' }, { status: 400 });
    }
    const supabase = createServiceClient();

    // Verify requester is the brand owner
    const { data: acct } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('owner_user_id', user.id)
      .single();
    if (!acct) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Create invite with hashed token
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { data: inv, error } = await supabase
      .from('invitations')
      .insert({ account_id: accountId, email, token_hash, invited_by: user.id })
      .select('id')
      .single();
    if (error) throw error;

    // Outbox-only delivery: always enqueue a notification email with our token link
    try {
      await supabase.from('notifications_outbox').insert({
        topic: 'member_invited',
        account_id: accountId,
        recipient_email: email,
        payload: { token: rawToken }
      } as any);
    } catch {}

    // Audit (non-fatal)
    try {
      await supabase.rpc('audit_log_event', {
        p_action: 'member_invited',
        p_target_table: 'invitations',
        p_target_id: inv.id,
        p_account_id: accountId,
        p_details: { email }
      });
    } catch {}

    // Do not return the token to the client UI
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create invitation' }, { status: 500 });
  }
}
