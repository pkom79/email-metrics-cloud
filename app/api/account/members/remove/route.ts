import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

// POST { accountId, userId } — owner-only; cannot remove owner
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { accountId, userId } = await request.json().catch(() => ({}));
    if (!accountId || !userId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    const svc = createServiceClient();
    const { data: acc } = await svc.from('accounts').select('owner_user_id').eq('id', accountId).single();
    if (!acc || acc.owner_user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (acc.owner_user_id === userId) return NextResponse.json({ error: 'Cannot remove owner' }, { status: 400 });

    const { error } = await svc.from('account_users').delete().eq('account_id', accountId).eq('user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    try { await svc.rpc('audit_log_event', { p_action: 'member_revoked', p_target_table: 'account_users', p_target_id: userId, p_account_id: accountId, p_details: {} }); } catch {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

