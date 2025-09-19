import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Remove a pending invitation
// POST body: { accountId: string, invitationId: string }
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { accountId, invitationId } = await request.json().catch(() => ({}));
    if (!accountId || !invitationId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    const supabase = createServiceClient();

    const { data: acct } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('owner_user_id', user.id)
      .single();
    if (!acct) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { error } = await supabase
      .from('invitations')
      .delete()
      .eq('id', invitationId)
      .eq('account_id', accountId)
      .eq('status', 'pending');
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

