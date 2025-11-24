import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin' || user?.app_metadata?.app_role === 'admin';
}

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user || !isAdminUser(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const svc = createServiceClient();

    let query = svc.from('account_users').select('account_id, user_id, role, created_at');
    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ memberships: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user || !isAdminUser(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const role = body?.role === 'owner' ? 'owner' : 'manager';
    if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
    if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });

    const svc = createServiceClient();

    // Verify account exists
    const { data: acct, error: acctErr } = await svc.from('accounts').select('id').eq('id', accountId).maybeSingle();
    if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
    if (!acct) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    // Ensure user exists in Auth
    try {
      const { data: userLookup } = await (svc as any).auth.admin.getUserById(userId);
      if (!userLookup?.user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'User lookup failed' }, { status: 500 });
    }

    if (role === 'owner') {
      const { error: updErr } = await svc.from('accounts').update({ owner_user_id: userId }).eq('id', accountId);
      if (updErr) return NextResponse.json({ error: updErr.message || 'Failed to set owner' }, { status: 500 });
      // Trigger will sync owner row in account_users
      return NextResponse.json({ status: 'ok', role: 'owner', accountId, userId });
    }

    const { error: upsertErr } = await svc
      .from('account_users')
      .upsert({ account_id: accountId, user_id: userId, role: 'manager' } as any, { onConflict: 'account_id,user_id' });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message || 'Failed to add member' }, { status: 500 });

    return NextResponse.json({ status: 'ok', role: 'manager', accountId, userId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user || !isAdminUser(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
    if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });

    const svc = createServiceClient();
    const { data: membership, error: memErr } = await svc
      .from('account_users')
      .select('role')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!membership) return NextResponse.json({ status: 'not_found' });
    if ((membership as any).role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove owner via membership API. Update accounts.owner_user_id instead.' }, { status: 400 });
    }

    const { error: delErr } = await svc
      .from('account_users')
      .delete()
      .eq('account_id', accountId)
      .eq('user_id', userId);
    if (delErr) return NextResponse.json({ error: delErr.message || 'Failed to remove member' }, { status: 500 });
    return NextResponse.json({ status: 'removed' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
