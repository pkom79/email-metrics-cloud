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

    // Enrich with email via Auth Admin API
    const memberships = data || [];
    const ids = Array.from(new Set(memberships.map((m: any) => m.user_id).filter(Boolean))) as string[];
    const emailMap: Record<string, string> = {};
    for (const uid of ids) {
      try {
        const lookup: any = await (svc as any).auth.admin.getUserById(uid);
        const email = lookup?.data?.user?.email || lookup?.user?.email;
        if (email) emailMap[uid] = email as string;
      } catch { /* ignore per-user */ }
    }
    const enriched = memberships.map((m: any) => ({ ...m, email: emailMap[m.user_id as string] || null }));

    return NextResponse.json({ memberships: enriched });
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
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const role = body?.role === 'owner' ? 'owner' : 'manager';
    if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });

    const svc = createServiceClient();

    // Verify account exists
    const { data: acct, error: acctErr } = await svc.from('accounts').select('id').eq('id', accountId).maybeSingle();
    if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
    if (!acct) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    let targetUserId = userId;

    // Resolve user by email if provided
    if (!targetUserId && email) {
      try {
        const { data: found } = await (svc as any).auth.admin.listUsers({ email });
        if (found?.users?.length) {
          targetUserId = found.users[0].id;
        } else {
          // Invite user and use returned id
          const { data: invited, error: inviteErr } = await (svc as any).auth.admin.inviteUserByEmail(email);
          if (inviteErr) return NextResponse.json({ error: inviteErr.message || 'Invite failed' }, { status: 500 });
          targetUserId = invited?.user?.id;
        }
      } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'User lookup/invite failed' }, { status: 500 });
      }
    }

    if (!targetUserId || !/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
      return NextResponse.json({ error: 'Invalid user target (userId or email required)' }, { status: 400 });
    }

    if (role === 'owner') {
      const { error: updErr } = await svc.from('accounts').update({ owner_user_id: targetUserId }).eq('id', accountId);
      if (updErr) return NextResponse.json({ error: updErr.message || 'Failed to set owner' }, { status: 500 });
      // Trigger will sync owner row in account_users
      return NextResponse.json({ status: 'ok', role: 'owner', accountId, userId: targetUserId, invited: Boolean(email && userId === '') });
    }

    const { error: upsertErr } = await svc
      .from('account_users')
      .upsert({ account_id: accountId, user_id: targetUserId, role: 'manager' } as any, { onConflict: 'account_id,user_id' });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message || 'Failed to add member' }, { status: 500 });

    return NextResponse.json({ status: 'ok', role: 'manager', accountId, userId: targetUserId, invited: Boolean(email && userId === '') });
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
