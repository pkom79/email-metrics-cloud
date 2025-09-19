import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Accept an invitation using the raw token. Requires login so we can bind to the current user.
// POST body: { token: string }
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { token } = await request.json().catch(() => ({}));
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }
    const supabase = createServiceClient();
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');

    // Load invitation
    const { data: inv, error } = await supabase
      .from('invitations')
      .select('id, account_id, email, status, expires_at')
      .eq('token_hash', token_hash)
      .single();
    if (error || !inv) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    if (inv.status !== 'pending' || new Date(inv.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Expired or already used' }, { status: 400 });
    }

    // Ensure the logged-in user's email matches the invite email (case-insensitive)
    const inviteEmail = String(inv.email || '').trim().toLowerCase();
    const userEmail = String(user.email || '').trim().toLowerCase();
    if (!inviteEmail || inviteEmail !== userEmail) {
      return NextResponse.json({ error: 'Email mismatch' }, { status: 403 });
    }

    // Add as member (quota enforced by trigger)
    const { error: addErr } = await supabase
      .from('account_users')
      .insert({ account_id: inv.account_id, user_id: user.id, role: 'member' });
    if (addErr) return NextResponse.json({ error: addErr.message }, { status: 400 });

    // Mark invitation accepted
    await supabase
      .from('invitations')
      .update({ status: 'accepted', used_by: user.id, used_at: new Date().toISOString() })
      .eq('id', inv.id);

    // No audit event here (invitation creation already logged). Optionally log acceptance.
    return NextResponse.json({ ok: true, accountId: inv.account_id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to accept invitation' }, { status: 500 });
  }
}
