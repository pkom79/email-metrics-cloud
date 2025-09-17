import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';

export const runtime = 'nodejs';

// Admin-only: bind an existing upload (flows.csv, campaigns.csv, subscribers.csv) to an account,
// create a snapshot row, and optionally trigger processing.
// POST body: { accountId: string, uploadId: string, label?: string, process?: boolean }
export async function POST(request: Request) {
  try {
  const ADMIN_SECRET = (globalThis as any).process?.env?.ADMIN_JOB_SECRET || process.env.ADMIN_JOB_SECRET;
    const provided = (request.headers.get('x-admin-job-secret') || '').trim();
    if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

  const body = await request.json().catch(() => ({}));
  const accountId = body.accountId;
  let uploadId: string | undefined = body.uploadId;
  const label = body.label;
  const doProcess = body.process;
    if (!accountId || !uploadId) {
      return NextResponse.json({ error: 'accountId and uploadId are required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const bucket = ingestBucketName();
    const required = ['flows.csv','campaigns.csv','subscribers.csv'] as const;

    // If uploadId not provided, try to auto-detect most recent folder containing all required files
    if (!uploadId) {
      // First: prefer recent rows from uploads table
      const { data: uploadRows } = await supabase
        .from('uploads')
        .select('id,updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      const tryIds: string[] = (uploadRows || []).map((r: any) => r.id);
      const candidates = new Set<string>(tryIds);
      // Also discover top-level folder names in the bucket as a fallback
      const { data: rootList } = await supabase.storage.from(bucket).list('', { limit: 1000 });
      for (const ent of (rootList || [])) {
        const name = (ent as any)?.name;
        if (typeof name === 'string' && name.length >= 10) candidates.add(name);
      }
      // Validate candidates by checking for required files; pick the most recent by flows.csv updated_at when available
      let picked: { id: string; ts: number } | null = null;
      for (const id of candidates) {
        // Quick list inside this folder
        const { data: inner } = await supabase.storage.from(bucket).list(id, { limit: 100 });
        const present = new Set((inner || []).map((f: any) => f.name));
        const hasAll = required.every(r => present.has(r));
        if (!hasAll) continue;
        // Use flows.csv updated time as tiebreaker if available
        const flowMeta = (inner || []).find((f: any) => f.name === 'flows.csv');
        const ts = flowMeta?.updated_at ? Date.parse(flowMeta.updated_at) : Date.now();
        if (!picked || ts > picked.ts) picked = { id, ts };
      }
      if (picked) uploadId = picked.id;
    }

    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId not provided and no suitable upload discovered in bucket' }, { status: 400 });
    }

    // Validate required files exist under the chosen uploadId
    const miss: string[] = [];
    for (const f of required) {
      const { data } = await supabase.storage.from(bucket).download(`${uploadId}/${f}`);
      if (!data) miss.push(f);
    }
    if (miss.length) {
      return NextResponse.json({ error: 'Missing CSVs', missing: miss, hint: `Expecting ${required.join(', ')} under ${uploadId}/ in bucket ${bucket}` }, { status: 400 });
    }

    // Bind upload to account
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('uploads')
      .upsert({ id: uploadId, account_id: accountId, status: 'bound', updated_at: nowIso } as any, { onConflict: 'id' });
    if (upErr) return NextResponse.json({ error: 'UpsertUploadFailed', details: upErr.message }, { status: 500 });

    // Create snapshot
    const { data: snap, error: snapErr } = await supabase
      .from('snapshots')
      .insert({ account_id: accountId, upload_id: uploadId, label: label || 'Manual Upload', status: 'ready' } as any)
      .select('id')
      .single();
    if (snapErr) return NextResponse.json({ error: 'CreateSnapshotFailed', details: snapErr.message }, { status: 500 });

    let processed = false;
  if (doProcess !== false) {
      // Trigger processing via internal call; detect origin from request URL
      const url = new URL(request.url);
      const origin = `${url.protocol}//${url.host}`;
      try {
        const res = await fetch(`${origin}/api/snapshots/process`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET },
          body: JSON.stringify({ uploadId })
        });
        processed = res.ok;
      } catch {}
    }

  return NextResponse.json({ ok: true, snapshotId: snap?.id, uploadId, bucket, processed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create snapshot from upload' }, { status: 500 });
  }
}
