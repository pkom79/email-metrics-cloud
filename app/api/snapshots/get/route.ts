import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const snapshotId = searchParams.get('id');
        if (!snapshotId) return NextResponse.json({ error: 'id required' }, { status: 400 });

        const supabase = createServiceClient();

        // Ensure snapshot belongs to user's account
        const { data: snap, error: snapErr } = await supabase
            .from('snapshots')
            .select('id,account_id,label,last_email_date,created_at,status')
            .eq('id', snapshotId)
            .maybeSingle();
        if (snapErr) throw snapErr;
        if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        // Get series
        const { data: series, error: seriesErr } = await supabase
            .from('snapshot_series')
            .select('metric_key,date,value')
            .eq('snapshot_id', snapshotId);
        if (seriesErr) throw seriesErr;

        // Get totals
        const { data: totals, error: totalsErr } = await supabase
            .from('snapshot_totals')
            .select('metric_key,value')
            .eq('snapshot_id', snapshotId);
        if (totalsErr) throw totalsErr;

        return NextResponse.json({ snapshot: snap, series, totals });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to fetch snapshot' }, { status: 500 });
    }
}
