import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceClient();
  const snapshotId = params.id;
  try {
    const { data: snap, error: snapErr } = await supabase
      .from('snapshots')
      .select('id, account_id, upload_id, status, label, created_at')
      .eq('id', snapshotId)
      .maybeSingle();
    if (snapErr) throw snapErr;
    if (!snap) return NextResponse.json({ error: 'snapshot not found' }, { status: 404 });

    const [{ count: totalsCount }, { count: seriesCount }] = await Promise.all([
      supabase.from('snapshot_totals').select('snapshot_id', { count: 'exact', head: true }).eq('snapshot_id', snapshotId),
      supabase.from('snapshot_series').select('snapshot_id', { count: 'exact', head: true }).eq('snapshot_id', snapshotId)
    ]);

    // Check if any share has stored static JSON for this snapshot
    const { data: shareRows } = await supabase
      .from('snapshot_shares')
      .select('id, share_token, snapshot_json')
      .eq('snapshot_id', snapshotId)
      .limit(5);

  type ShareRowLite = { id: string; share_token: string; snapshot_json?: any };
  const shares = (shareRows as ShareRowLite[] | null | undefined || []).map(r => ({ id: r.id, token: r.share_token, hasStaticJson: !!r.snapshot_json }));

    return NextResponse.json({
      snapshot: snap,
      derived: { totalsCount, seriesCount },
      shares,
      hints: buildHints({ snap, totalsCount, seriesCount })
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

function buildHints(ctx: { snap: any; totalsCount: number | null; seriesCount: number | null }) {
  const hints: string[] = [];
  if (!ctx.snap.upload_id) hints.push('Snapshot has no upload_id; builder cannot locate CSVs.');
  if ((ctx.totalsCount ?? 0) === 0 && (ctx.seriesCount ?? 0) === 0) {
    hints.push('No derived metrics present. Run POST /api/snapshots/process with { uploadId } to populate totals/series.');
  }
  hints.push('If range_start / range_end columns are missing, run migrations to add them (optional).');
  return hints;
}
