import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

// POST { accountId } — member self-removal; service role bypasses RLS safely
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { accountId } = await request.json().catch(() => ({}));
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
    const svc = createServiceClient();

    // Disallow if caller is the owner
    const { data: acc } = await svc.from('accounts').select('owner_user_id').eq('id', accountId).single();
    if (acc?.owner_user_id === user.id) return NextResponse.json({ error: 'Owners cannot leave their own brand' }, { status: 400 });

    const { error } = await svc.from('account_users').delete().eq('account_id', accountId).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

