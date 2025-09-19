import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Resend a pending invitation (regenerates token and emails invitee)
// POST body: { accountId: string, invitationId: string }
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { accountId, invitationId } = await request.json().catch(() => ({}));
    if (!accountId || !invitationId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const supabase = createServiceClient();
    // Verify requester is the brand owner
    const { data: acct } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('owner_user_id', user.id)
      .single();
    if (!acct) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Load invite
    const { data: inv, error: invErr } = await supabase
      .from('invitations')
      .select('id,email,status')
      .eq('id', invitationId)
      .eq('account_id', accountId)
      .single();
    if (invErr || !inv) return NextResponse.json({ error: 'InviteNotFound' }, { status: 404 });
    if (inv.status !== 'pending') return NextResponse.json({ error: 'InviteNotPending' }, { status: 400 });

    // Regenerate token and update
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updErr } = await supabase
      .from('invitations')
      .update({ token_hash, expires_at: expiresAt, used_by: null, used_at: null })
      .eq('id', invitationId);
    if (updErr) throw updErr;

    // Enqueue email
    try {
      await supabase.from('notifications_outbox').insert({
        topic: 'member_invited',
        account_id: accountId,
        recipient_email: inv.email,
        payload: { token: rawToken }
      } as any);
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

