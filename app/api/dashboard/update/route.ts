import { NextRequest } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Mode = 'dry-run' | 'live';

interface Body {
  mode?: Mode;
  accountId?: string;
  days?: number;
  start?: string; // YYYY-MM-DD
  end?: string;   // YYYY-MM-DD
  klaviyoApiKey?: string;
  flow?: { limitFlows?: number; limitMessages?: number; enrichMessageNames?: boolean };
  audience?: { schema?: 'minimal'|'extended'|'required'; pageSize?: number; maxPages?: number };
  campaign?: { timeframeKey?: string };
}

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }
    const providedSecret = req.headers.get('x-admin-job-secret') || '';
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body: Body = await req.json().catch(() => ({}));
    const mode: Mode = body.mode || 'dry-run';
    const accountId = body.accountId || '';
    const days = Math.max(1, Math.min(body.days ?? 7, 30));
    const start = body.start || '';
    const end = body.end || '';
    const apiKey = body.klaviyoApiKey || process.env.KLAVIYO_API_KEY_PRIVATE || process.env.KLAVIYO_API_KEY || '';
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });

    // Build URLs to call internal APIs (reuse server base from incoming req)
    const base = new URL(req.url);
    base.pathname = '';
    base.search = '';
    const origin = base.origin;

    // --- FLOWS ---
    const flowPayload = {
      mode: 'dry-run',
      format: 'csv',
      days,
      start: start || undefined,
      end: end || undefined,
      limitFlows: body.flow?.limitFlows ?? 20,
      limitMessages: body.flow?.limitMessages ?? 50,
      enrichMessageNames: body.flow?.enrichMessageNames ?? true,
      klaviyoApiKey: apiKey,
    };
    const flowRes = await fetch(`${origin}/api/klaviyo/flow-sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET },
      body: JSON.stringify(flowPayload)
    });
    if (!flowRes.ok) {
      const txt = await flowRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'FlowSyncFailed', status: flowRes.status, details: txt }), { status: 502 });
    }
    const flowsCsv = await flowRes.text();

    // --- CAMPAIGNS ---
    const campaignPayload = {
      mode: 'dry-run',
      format: 'csv',
      klaviyoApiKey: apiKey,
      timeframeKey: body.campaign?.timeframeKey || (days <= 30 ? 'last_30_days' : undefined),
    };
    const campRes = await fetch(`${origin}/api/klaviyo/campaign-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET }, body: JSON.stringify(campaignPayload)
    });
    if (!campRes.ok) {
      const txt = await campRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'CampaignSyncFailed', status: campRes.status, details: txt }), { status: 502 });
    }
    const campCsv = await campRes.text();

    // --- AUDIENCE ---
    const audPayload = {
      mode: 'dry-run',
      format: 'csv',
      source: 'klaviyo',
      schema: body.audience?.schema || 'required',
      pageSize: body.audience?.pageSize ?? 200,
      maxPages: body.audience?.maxPages ?? 2,
      klaviyoApiKey: apiKey,
    };
    const audRes = await fetch(`${origin}/api/klaviyo/audience-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET }, body: JSON.stringify(audPayload)
    });
    if (!audRes.ok) {
      const txt = await audRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'AudienceSyncFailed', status: audRes.status, details: txt }), { status: 502 });
    }
    let audienceCsv = await audRes.text();

    // Ensure subscribers.csv exists even if audience fetch is skipped/empty
    if (!audienceCsv || !audienceCsv.trim()) {
      audienceCsv = 'Email,Klaviyo ID,First Name,Last Name,Email Marketing Consent\n';
    }

    if (mode === 'dry-run') {
      return new Response(JSON.stringify({
        mode,
        rows: {
          flows: Math.max(0, flowsCsv.split('\n').length - 1),
          campaigns: Math.max(0, campCsv ? campCsv.split('\n').length - 1 : 0),
          subscribers: Math.max(0, audienceCsv.split('\n').length - 1)
        },
        previews: {
          flows: flowsCsv.split('\n').slice(0, 3),
          campaigns: campCsv.split('\n').slice(0, 3),
          subscribers: audienceCsv.split('\n').slice(0, 3)
        },
        ms: Date.now() - t0
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // live write path requires accountId
    if (!accountId) return new Response(JSON.stringify({ error: 'accountId required for live mode' }), { status: 400 });

    const supabase = createServiceClient();
    const bucket = ingestBucketName();
    const idemp = (req.headers.get('x-idempotency-key') || '').trim();
    const uploadId = idemp ? stableId(`${accountId}:${idemp}`) : new Date().toISOString().replace(/[:.]/g, '-');

    // Write three CSVs to the ingest bucket
    const up = async (name: string, content: string) => {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(`${uploadId}/${name}`, new Blob([content], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });
      if (error) throw new Error(error.message);
    };
    await up('flows.csv', flowsCsv);
    await up('campaigns.csv', campCsv);
    await up('subscribers.csv', audienceCsv);

    // Ensure uploads row exists and is bound to account
    await supabase.from('uploads').upsert({ id: uploadId, account_id: accountId, status: 'bound', updated_at: new Date().toISOString() } as any, { onConflict: 'id' });

    // Create snapshot row
    const { data: snap, error: snapErr } = await supabase
      .from('snapshots')
      .insert({ account_id: accountId, upload_id: uploadId, label: 'Orchestrated Update', status: 'ready' } as any)
      .select('id')
      .single();
    if (snapErr) return new Response(JSON.stringify({ error: 'CreateSnapshotFailed', details: snapErr.message }), { status: 500 });

    // Trigger processing
    await fetch(`${origin}/api/snapshots/process`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId }) }).catch(() => {});

    return new Response(JSON.stringify({ mode, accountId, uploadId, snapshotId: snap?.id, wrote: { bucket, keys: ['flows.csv','campaigns.csv','subscribers.csv'] }, ms: Date.now() - t0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

function stableId(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'id_' + (h >>> 0).toString(16);
}
