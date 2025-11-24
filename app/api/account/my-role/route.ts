import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    if (!accountId) {
      return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
    }

    const svc = createServiceClient();
    const { data: acct, error } = await svc
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message || 'Failed to resolve role' }, { status: 500 });
    }
    if (!acct) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    if ((acct as any).owner_user_id === user.id) {
      return NextResponse.json({ role: 'owner' });
    }

    const { data: membership, error: memberErr } = await svc
      .from('account_users')
      .select('role')
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (memberErr) {
      return NextResponse.json({ error: memberErr.message || 'Failed to resolve role' }, { status: 500 });
    }

    const role = membership?.role || null;
    return NextResponse.json({ role });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
