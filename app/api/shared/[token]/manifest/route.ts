import { NextResponse } from 'next/server';
import { resolveShareStrict, listAvailableFiles } from '../../../../../lib/sharedCsv';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const t0 = Date.now();
  const token = params.token;
  try {
    const resolved = await resolveShareStrict(token);
    const files = await listAvailableFiles(resolved.accountId, resolved.uploadId);

    return NextResponse.json(
      {
        snapshot_id: resolved.snapshotId,
        account_id: resolved.accountId,
        upload_id: resolved.uploadId,
        files,
        debug: {
          looked_up_prefix: `${resolved.accountId}/${resolved.uploadId}/`,
          buckets_tried: ['uploads', 'csv-uploads'],
          duration_ms: Date.now() - t0,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      /not found/i.test(msg) ? 404 :
      /inactive|expired/i.test(msg) ? 403 : 500;
    return NextResponse.json({ error: msg, debug: { token, duration_ms: Date.now() - t0 } }, { status });
  }
}

// Removed legacy deep scanner variant; now using strict path resolution.
