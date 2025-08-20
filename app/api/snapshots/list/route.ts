import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const supabase = createServiceClient();

        // Find the user's account
        const { data: acct, error: acctErr } = await supabase
            .from('accounts')
            .select('id')
            .eq('owner_user_id', user.id)
            .maybeSingle();
        if (acctErr) throw acctErr;
        if (!acct) return NextResponse.json({ snapshots: [] });

        const { data: snaps, error: snapsErr } = await supabase
            .from('snapshots')
            .select('id,label,created_at,last_email_date,status')
            .eq('account_id', acct.id)
            .order('created_at', { ascending: false });
        if (snapsErr) throw snapsErr;

        return NextResponse.json({ snapshots: snaps || [] });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to list snapshots' }, { status: 500 });
    }
}
