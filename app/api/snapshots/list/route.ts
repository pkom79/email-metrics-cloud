import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

async function resolveAccountIdForUser(
    svc: ReturnType<typeof createServiceClient>,
    userId: string,
    requestedId: string | null
): Promise<{ accountId: string | null; error?: { message: string; status: number } }> {
    if (requestedId) {
        const { data: acct, error: acctErr } = await svc
            .from('accounts')
            .select('id, owner_user_id')
            .eq('id', requestedId)
            .maybeSingle();
        if (acctErr) return { accountId: null, error: { message: acctErr.message, status: 500 } };
        if (!acct) return { accountId: null, error: { message: 'Account not found', status: 404 } };
        if (acct.owner_user_id === userId) return { accountId: acct.id };
        const { data: membership } = await svc
            .from('account_users')
            .select('role')
            .eq('account_id', requestedId)
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle();
        if (membership) return { accountId: acct.id };
        return { accountId: null, error: { message: 'No access to account', status: 403 } };
    }

    const { data: own } = await svc
        .from('accounts')
        .select('id')
        .eq('owner_user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1);
    if (own && own.length) return { accountId: own[0].id };

    const { data: member } = await svc
        .from('account_users')
        .select('account_id')
        .eq('user_id', userId)
        .limit(1);
    if (member && member.length) return { accountId: (member as any)[0].account_id };

    return { accountId: null };
}

export async function GET(request: Request) {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const supabase = createServiceClient();
        const { searchParams } = new URL(request.url);
        const overrideAccountId = searchParams.get('account_id');

        let targetAccountId: string | null = null;
        const admin = (user.app_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.app_role === 'admin';

        if (overrideAccountId && admin && /^[0-9a-fA-F-]{36}$/.test(overrideAccountId)) {
            targetAccountId = overrideAccountId;
        }

        if (!targetAccountId) {
            const resolved = await resolveAccountIdForUser(supabase, user.id, overrideAccountId);
            if (resolved.error) {
                return NextResponse.json({ error: resolved.error.message }, { status: resolved.error.status });
            }
            targetAccountId = resolved.accountId;
            if (!targetAccountId) {
                return NextResponse.json({ snapshots: [] });
            }
        }

        const { data: snaps, error: snapsErr } = await supabase
            .from('snapshots')
            .select('id,label,created_at,last_email_date,status')
            .eq('account_id', targetAccountId)
            .order('created_at', { ascending: false });
        if (snapsErr) throw snapsErr;

        return NextResponse.json({ snapshots: snaps || [] });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to list snapshots' }, { status: 500 });
    }
}
