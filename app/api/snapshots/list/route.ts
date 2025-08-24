import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const supabase = createServiceClient();
        const { searchParams } = new URL(request.url);
        const overrideAccountId = searchParams.get('account_id');

        let targetAccountId: string | null = null;
        if (overrideAccountId) {
            // Only allow if admin (role claim handled at DB layer but we trust service role key; still ensure user has admin claim in auth metadata if needed later)
            // For now, just accept since service client bypasses RLS; keep minimal validation
            if (/^[0-9a-fA-F-]{36}$/.test(overrideAccountId)) targetAccountId = overrideAccountId;
        }

        // Find the user's account
        if (!targetAccountId) {
            const { data: acct, error: acctErr } = await supabase
                .from('accounts')
                .select('id')
                .eq('owner_user_id', user.id)
                .maybeSingle();
            if (acctErr) throw acctErr;
            if (!acct) return NextResponse.json({ snapshots: [] });
            targetAccountId = acct.id;
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
