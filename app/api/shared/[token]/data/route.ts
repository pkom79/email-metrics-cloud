import { NextResponse } from 'next/server';
import { resolveShareTokenStrict } from '../../../../../lib/shareToken';
import { buildSnapshotJSON } from '../../../../../lib/snapshotBuilder';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const t0 = Date.now();
  try {
    const resolved = await resolveShareTokenStrict(params.token);
    const json = await buildSnapshotJSON({
      snapshotId: resolved.snapshotId,
      accountId: resolved.accountId,
      uploadId: resolved.uploadId,
      rangeStart: (resolved as any).rangeStart,
      rangeEnd: (resolved as any).rangeEnd,
    });
    return NextResponse.json(json, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Snapshot-Gen-Duration': String(Date.now() - t0),
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = /not found|inactive|expired/i.test(msg) ? 404 : 500;
    return NextResponse.json(
      { error: msg, token: params.token.slice(0, 8) + '…', duration_ms: Date.now() - t0 },
      { status }
    );
  }
}