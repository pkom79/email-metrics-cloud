import { NextResponse } from 'next/server';
import { resolveShareTokenStrict } from '../../../../../lib/shareToken';
import { buildSnapshotJSON } from '../../../../../lib/snapshotBuilder';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const t0 = Date.now();
  try {
    const resolved = await resolveShareTokenStrict(params.token);
    // First attempt: static JSON stored on share row
    const { data: shareRow } = await supabaseAdmin
      .from('snapshot_shares')
      .select('snapshot_json')
      .eq('share_token', params.token)
      .maybeSingle();
    let json;
    if (shareRow?.snapshot_json) {
      json = shareRow.snapshot_json;
      // Unwrap legacy wrapper style { sharedBundle } if present
      if (json && json.sharedBundle && !json.schemaVersion) {
        json = json.sharedBundle;
      }
    } else {
      json = await buildSnapshotJSON({
        snapshotId: resolved.snapshotId,
        accountId: resolved.accountId,
        uploadId: resolved.uploadId,
        rangeStart: (resolved as any).rangeStart,
        rangeEnd: (resolved as any).rangeEnd,
      });
      // Prune to supported sections but include aggregated campaign/flow performance blocks
      json = {
        meta: { ...json.meta, sections: json.meta.sections.filter((s: string) => ['audienceOverview','emailPerformance','campaignPerformance','flowPerformance','flows','campaigns'].includes(s)) },
        audienceOverview: json.audienceOverview,
        emailPerformance: json.emailPerformance,
        campaignPerformance: (json as any).campaignPerformance,
        flowPerformance: (json as any).flowPerformance,
        flows: json.flows,
        campaigns: json.campaigns
      } as any;
    }
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