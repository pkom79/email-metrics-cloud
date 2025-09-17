import { NextRequest } from 'next/server';
import crypto from 'crypto';
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
  // Optional orchestration flags (dry-run only)
  skipFlows?: boolean;
  skipCampaign?: boolean;
  skipAudience?: boolean;
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

    // Prepare payloads
    const flowPayload = {
      mode: 'dry-run',
      format: 'csv',
      days,
      start: start || undefined,
      end: end || undefined,
      limitFlows: body.flow?.limitFlows ?? 20,
      limitMessages: body.flow?.limitMessages ?? 50,
      // Default to enriching names in live runs so UI shows message names instead of IDs
      enrichMessageNames: body.flow?.enrichMessageNames ?? (mode === 'live'),
      klaviyoApiKey: apiKey,
    };
    const campaignPayload = {
      mode: 'dry-run',
      format: 'csv',
      klaviyoApiKey: apiKey,
      // Do not default timeframeKey; allow route to use explicit days/start/end for tight windows
      timeframeKey: body.campaign?.timeframeKey || undefined,
      days,
      start: start || undefined,
      end: end || undefined,
    } as any;
    const audPayload = {
      mode: 'dry-run',
      format: 'csv',
      source: 'klaviyo',
      schema: body.audience?.schema || 'required',
      pageSize: body.audience?.pageSize ?? 200,
      maxPages: body.audience?.maxPages ?? 2,
      klaviyoApiKey: apiKey,
    };
    // Launch all three in parallel to minimize total duration
    const flowReq = body.skipFlows
      ? Promise.resolve(new Response('Day,Flow ID,Flow Name,Flow Message ID,Flow Message Name,Flow Message Channel,Status,Delivered,Unique Opens,Open Rate,Unique Clicks,Click Rate,Placed Order,Placed Order Rate,Revenue,Revenue per Recipient,Unsub Rate,Complaint Rate,Bounce Rate,Tags\n', { status: 200 }))
      : fetch(`${origin}/api/klaviyo/flow-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET }, body: JSON.stringify(flowPayload)
      });
    // If skip flags are set, return header-only CSV even in live mode to allow partial/lite runs
    const campReq = body.skipCampaign
      ? Promise.resolve(new Response('Campaign Name,Tags,Subject,List,Send Time,Send Weekday,Total Recipients,Unique Placed Order,Placed Order Rate,Revenue,Unique Opens,Open Rate,Total Opens,Unique Clicks,Click Rate,Total Clicks,Unsubscribes,Spam Complaints,Spam Complaints Rate,Successful Deliveries,Bounces,Bounce Rate,Campaign ID,Campaign Channel\n', { status: 200 }))
      : fetch(`${origin}/api/klaviyo/campaign-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET }, body: JSON.stringify(campaignPayload)
      });
    const audReq = body.skipAudience
      ? Promise.resolve(new Response('Email,Klaviyo ID,First Name,Last Name,Email Marketing Consent\n', { status: 200 }))
      : fetch(`${origin}/api/klaviyo/audience-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET }, body: JSON.stringify(audPayload)
      });

    const [flowRes, campRes, audRes] = await Promise.all([flowReq, campReq, audReq]);

    if (!flowRes.ok) {
      const txt = await flowRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'FlowSyncFailed', status: flowRes.status, details: txt }), { status: 502 });
    }
    if (!campRes.ok) {
      const txt = await campRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'CampaignSyncFailed', status: campRes.status, details: txt }), { status: 502 });
    }
    if (!audRes.ok) {
      const txt = await audRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'AudienceSyncFailed', status: audRes.status, details: txt }), { status: 502 });
    }

    const [flowsCsv, campCsv, audienceCsvRaw] = await Promise.all([
      flowRes.text(), campRes.text(), audRes.text()
    ]);
    let audienceCsv = audienceCsvRaw;

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
  const uploadId = idemp ? stableUuid(`${accountId}:${idemp}`) : (crypto.randomUUID ? crypto.randomUUID() : stableUuid(`${accountId}:${Date.now()}`));

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
    {
      const { error: upErr } = await supabase
        .from('uploads')
        .upsert({ id: uploadId, account_id: accountId, status: 'bound', updated_at: new Date().toISOString() } as any, { onConflict: 'id' });
      if (upErr) return new Response(JSON.stringify({ error: 'UpsertUploadFailed', details: upErr.message }), { status: 500 });
    }

    // Create snapshot row
    const { data: snap, error: snapErr } = await supabase
      .from('snapshots')
      .insert({ account_id: accountId, upload_id: uploadId, label: 'Orchestrated Update', status: 'ready' } as any)
      .select('id')
      .single();
    if (snapErr) return new Response(JSON.stringify({ error: 'CreateSnapshotFailed', details: snapErr.message }), { status: 500 });

  // Trigger processing (admin bypass)
  await fetch(`${origin}/api/snapshots/process`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': ADMIN_SECRET! }, body: JSON.stringify({ uploadId }) }).catch(() => {});

    return new Response(JSON.stringify({ mode, accountId, uploadId, snapshotId: snap?.id, wrote: { bucket, keys: ['flows.csv','campaigns.csv','subscribers.csv'] }, ms: Date.now() - t0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

// Deterministic UUID (v5-like) using SHA-1 over a fixed namespace and the provided name
function stableUuid(name: string) {
  const ns = crypto.createHash('sha1').update('email-metrics-orchestrator').digest();
  const hash = crypto.createHash('sha1').update(ns).update(name).digest();
  const bytes = Uint8Array.from(hash.slice(0, 16));
  // Set version 5 (SHA-1) and variant RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // 0101 0000 -> version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // 10xx xxxx -> RFC 4122 variant
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.substr(0,8)}-${hex.substr(8,4)}-${hex.substr(12,4)}-${hex.substr(16,4)}-${hex.substr(20,12)}`;
}

// Cron-friendly GET: accepts query params, validates token, forwards to POST with idempotency
export async function GET(req: NextRequest) {
  try {
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }
    const url = new URL(req.url);
    const headerToken = req.headers.get('x-admin-job-secret') || '';
    const token = url.searchParams.get('token') || headerToken || '';
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Map query params into body shape; default to live for cron runs
    const qp = url.searchParams;
    const fast = qp.get('fast') === '1';
    const lite = qp.get('lite') === '1'; // live-friendly partial run: skip heavy producers, still writes header-only CSVs
    const body: Body = {
      mode: ((qp.get('mode') as Mode) || 'live'),
      accountId: qp.get('accountId') || undefined,
      klaviyoApiKey: qp.get('klaviyoApiKey') || undefined,
      days: qp.get('days') ? Number(qp.get('days')) : undefined,
      start: qp.get('start') || undefined,
      end: qp.get('end') || undefined,
      flow: {
        limitFlows: qp.get('limitFlows') ? Number(qp.get('limitFlows')) : ((fast || lite) ? 1 : undefined),
        limitMessages: qp.get('limitMessages') ? Number(qp.get('limitMessages')) : ((fast || lite) ? 1 : undefined),
        enrichMessageNames: qp.get('enrichMessageNames') ? qp.get('enrichMessageNames') === 'true' : ((fast || lite) ? false : undefined),
      },
      audience: {
        schema: (qp.get('audienceSchema') as any) || (fast ? 'required' : undefined),
        pageSize: qp.get('audiencePageSize') ? Number(qp.get('audiencePageSize')) : (fast ? 200 : undefined),
        maxPages: qp.get('audienceMaxPages') ? Number(qp.get('audienceMaxPages')) : (fast ? 0 : undefined),
      },
      campaign: {
        timeframeKey: qp.get('timeframeKey') || (fast ? 'last_7_days' : undefined),
      },
      skipFlows: fast || lite,
      skipCampaign: fast || lite,
      skipAudience: fast || lite,
    };

    // Basic guard: live mode requires accountId
    if ((body.mode || 'live') === 'live' && !body.accountId) {
      return new Response(JSON.stringify({ error: 'accountId required for live mode' }), { status: 400 });
    }

    // Idempotency for nightly runs (UTC date)
    const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const idempotency = qp.get('idempotency') || `nightly-${todayUtc}`;

    // Reuse the POST logic via internal fetch
    const origin = `${url.protocol}//${url.host}`;
    const res = await fetch(`${origin}/api/dashboard/update`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-job-secret': token,
        'x-idempotency-key': idempotency,
      },
      body: JSON.stringify(body),
    });

    const contentType = res.headers.get('content-type') || 'application/json';
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'content-type': contentType } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
