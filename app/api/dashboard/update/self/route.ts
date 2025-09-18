import { NextRequest } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../../lib/storage/ingest';
import crypto from 'crypto';
import { getAccountKlaviyoApiKey } from '../../../../../lib/integrations/klaviyoKey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Mode = 'dry-run' | 'live';

interface Body {
  mode?: Mode;
  days?: number;
  start?: string;
  end?: string;
  flow?: { limitFlows?: number; limitMessages?: number; enrichMessageNames?: boolean };
  audience?: { schema?: 'minimal'|'extended'|'required'; pageSize?: number; maxPages?: number };
  campaign?: { timeframeKey?: string };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }
    const user = await getServerUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const body: Body = await req.json().catch(() => ({}));
    const mode: Mode = body.mode || 'dry-run';
    const days = Math.max(1, Math.min(body.days ?? 7, 30));

    const base = new URL(req.url); base.pathname = ''; base.search = ''; const origin = base.origin;
    const supabase = createServiceClient();

    // Resolve user's account
    const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    if (!acct?.id) return new Response(JSON.stringify({ error: 'NoAccount' }), { status: 404 });
    const accountId = acct.id as string;

    // 7-day staleness guard (disable API updates if stale)
    const { data: latest } = await supabase
      .from('snapshots')
      .select('last_email_date')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.last_email_date) {
      try {
        const last = new Date(String(latest.last_email_date) + 'T00:00:00Z');
        const today = new Date();
        const diffDays = Math.floor((today.getTime() - last.getTime()) / 86400000);
        if (diffDays > 7) {
          return new Response(JSON.stringify({
            error: 'ApiUpdateDisabled',
            reason: 'stale_data',
            lastUpdateDays: diffDays,
            message: `API updates are disabled because your data is ${diffDays} days old. Please upload fresh CSV reports to re-enable API updates.`,
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
      } catch {}
    }

    // Resolve per-account Klaviyo key (self-serve uses owner account)
    const klaviyoApiKey = (await getAccountKlaviyoApiKey(accountId)) || process.env.KLAVIYO_API_KEY || '';

    // Flow CSV
    const flowRes = await fetch(`${origin}/api/klaviyo/flow-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': process.env.ADMIN_JOB_SECRET || '' }, body: JSON.stringify({
        mode: 'dry-run', format: 'csv', days, limitFlows: body.flow?.limitFlows ?? 20, limitMessages: body.flow?.limitMessages ?? 50, enrichMessageNames: body.flow?.enrichMessageNames ?? true,
        klaviyoApiKey,
      })
    });
    if (!flowRes.ok) return http502('FlowSyncFailed', await flowRes.text().catch(() => ''));
    const flowsCsv = await flowRes.text();

    // Campaign CSV (from preview lines)
    const campRes = await fetch(`${origin}/api/klaviyo/campaign-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': process.env.ADMIN_JOB_SECRET || '' }, body: JSON.stringify({
        mode: 'dry-run', format: 'csv', timeframeKey: body.campaign?.timeframeKey || (days <= 30 ? 'last_30_days' : undefined),
        klaviyoApiKey,
      })
    });
    if (!campRes.ok) return http502('CampaignSyncFailed', await campRes.text().catch(() => ''));
    const campJson = await campRes.json().catch(() => ({}));
    const campPreview: string[] = Array.isArray(campJson?.preview) ? campJson.preview : [];
    const campCsv = [campPreview[0] || '', campPreview[1] || '', campPreview[2] || '', campPreview[3] || ''].join('\n');

    // Audience CSV
    const audRes = await fetch(`${origin}/api/klaviyo/audience-sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': process.env.ADMIN_JOB_SECRET || '' }, body: JSON.stringify({
        mode: 'dry-run', format: 'csv', source: 'profiles', schema: body.audience?.schema || 'required', profiles: [],
        klaviyoApiKey,
      })
    });
    // If profiles source returns 400 (no profiles), fallback to klaviyo source (staging key must be configured for this workspace)
    let audienceCsv = audRes.ok ? await audRes.text() : '';
    if (!audienceCsv || !audienceCsv.trim()) {
      audienceCsv = 'Email,Klaviyo ID,First Name,Last Name,Email Marketing Consent\n';
    }

    if (mode === 'dry-run') {
      return new Response(JSON.stringify({
        mode,
        rows: {
          flows: Math.max(0, flowsCsv.split('\n').length - 1),
          campaigns: Math.max(0, campCsv ? campCsv.split('\n').length - 1 : 0),
          subscribers: Math.max(0, audienceCsv ? audienceCsv.split('\n').length - 1 : 0)
        },
        ms: Date.now() - t0
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // Live write
    const bucket = ingestBucketName();
    const idemp = (req.headers.get('x-idempotency-key') || '').trim();
    const uploadId = idemp ? stableUuid(`${accountId}:${idemp}`) : (crypto.randomUUID ? crypto.randomUUID() : stableUuid(`${accountId}:${Date.now()}`));
    const up = async (name: string, content: string) => {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(`${uploadId}/${name}`, new Blob([content], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });
      if (error) throw new Error(error.message);
    };
    await up('flows.csv', flowsCsv);
    if (campCsv) await up('campaigns.csv', campCsv);
    if (audienceCsv) await up('subscribers.csv', audienceCsv);

    await supabase.from('uploads').upsert({ id: uploadId, account_id: accountId, status: 'bound', updated_at: new Date().toISOString() } as any, { onConflict: 'id' });
    const { data: snapRow, error: snapErr } = await supabase
      .from('snapshots')
      .insert({ account_id: accountId, upload_id: uploadId, label: 'Self-Serve Update', status: 'ready' } as any)
      .select('id')
      .single();
    if (snapErr) return new Response(JSON.stringify({ error: 'CreateSnapshotFailed', details: snapErr.message }), { status: 500 });

    await fetch(`${origin}/api/snapshots/process`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-job-secret': process.env.ADMIN_JOB_SECRET || '' }, body: JSON.stringify({ uploadId }) }).catch(() => {});

    return new Response(JSON.stringify({ mode, accountId, uploadId, snapshotId: (snapRow as any)?.id, wrote: { bucket }, ms: Date.now() - t0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

function http502(code: string, details: string) {
  return new Response(JSON.stringify({ error: code, details }), { status: 502, headers: { 'content-type': 'application/json' } });
}

// Deterministic UUID (v5-like) using SHA-1 over a fixed namespace and the provided name
function stableUuid(name: string) {
  const ns = crypto.createHash('sha1').update('email-metrics-orchestrator').digest();
  const hash = crypto.createHash('sha1').update(ns).update(name).digest();
  const bytes = Uint8Array.from(hash.slice(0, 16));
  // Set version 5 (SHA-1) and variant RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.substr(0,8)}-${hex.substr(8,4)}-${hex.substr(12,4)}-${hex.substr(16,4)}-${hex.substr(20,12)}`;
}
