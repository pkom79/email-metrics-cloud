import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { snapshotId, lastEmailDate } = await request.json();
        if (!snapshotId || !lastEmailDate) return NextResponse.json({ error: 'snapshotId and lastEmailDate required' }, { status: 400 });

        const supabase = createServiceClient();

        // Ensure snapshot belongs to user's account
        const { data: snap, error: selErr } = await supabase
            .from('snapshots')
            .select('id,account_id')
            .eq('id', snapshotId)
            .maybeSingle();
        if (selErr) throw selErr;
        if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        // Update last_email_date
        const { error: updErr } = await supabase
            .from('snapshots')
            .update({ last_email_date: lastEmailDate })
            .eq('id', snapshotId);
        if (updErr) throw updErr;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to update last date' }, { status: 500 });
    }
}
