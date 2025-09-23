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
        const admin = (user.app_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.app_role === 'admin';

        if (overrideAccountId && admin && /^[0-9a-fA-F-]{36}$/.test(overrideAccountId)) {
            targetAccountId = overrideAccountId;
        }

        if (!targetAccountId) {
            const { data: own } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).limit(1);
            if (own && own.length) {
                targetAccountId = own[0].id;
            }
        }

        if (!targetAccountId) {
            return NextResponse.json({ snapshots: [] });
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
