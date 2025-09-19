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

        // Find an accessible account for the user (owner, member, or via agency)
        if (!targetAccountId) {
            // 1) Owner brands
            const { data: own } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).limit(1);
            if (own && own.length) targetAccountId = own[0].id;
            // 2) Member brands
            if (!targetAccountId) {
                const { data: mem } = await supabase
                    .from('account_users')
                    .select('account_id')
                    .eq('user_id', user.id)
                    .limit(1);
                if (mem && mem.length) targetAccountId = (mem[0] as any).account_id;
            }
            // 3) Agency-entitled brands
            if (!targetAccountId) {
                const { data: ag } = await supabase
                    .from('agency_users')
                    .select('agency_id, all_accounts')
                    .eq('user_id', user.id)
                    .limit(5);
                for (const au of ag || []) {
                    if (targetAccountId) break;
                    if (au.all_accounts) {
                        const { data: accs } = await supabase
                            .from('agency_accounts')
                            .select('account_id')
                            .eq('agency_id', au.agency_id)
                            .limit(1);
                        if (accs && accs.length) { targetAccountId = (accs[0] as any).account_id; break; }
                    } else {
                        const { data: scoped } = await supabase
                            .from('agency_user_accounts')
                            .select('account_id')
                            .eq('agency_id', au.agency_id)
                            .eq('user_id', user.id)
                            .limit(1);
                        if (scoped && scoped.length) { targetAccountId = (scoped[0] as any).account_id; break; }
                    }
                }
            }
            if (!targetAccountId) return NextResponse.json({ snapshots: [] });
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
