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
    const logs: any[] = [];
    const log = (step: string, info?: any) => logs.push({ at: new Date().toISOString(), step, info });
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled', logs }), { status: 501 });
    }
    const user = await getServerUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const body: Body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1' || (body as any).debug === true;
    log('start', { mode: body.mode, debug, vercelEnv: process.env.VERCEL_ENV || null });
    const mode: Mode = body.mode || 'dry-run';
    const days = Math.max(1, Math.min(body.days ?? 7, 30));

    const base = new URL(req.url); base.pathname = ''; base.search = '';
    // Robust origin resolution for internal forwarding on Vercel/Prod
    const host = process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
      : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : base.origin);
    const origin = host;
    const supabase = createServiceClient();

    // Resolve user's account
    const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    if (!acct?.id) return new Response(JSON.stringify({ error: 'NoAccount' }), { status: 404 });
    const accountId = acct.id as string;
    log('account_resolved', { accountId });

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
        log('staleness_check', { last_email_date: latest.last_email_date, diffDays });
        if (diffDays > 7) {
          return new Response(JSON.stringify({
            error: 'ApiUpdateDisabled',
            reason: 'stale_data',
            lastUpdateDays: diffDays,
            message: `API updates are disabled because your data is ${diffDays} days old. Please upload fresh CSV reports to re-enable API updates.`,
            logs
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
      } catch {}
    }

    // Resolve per-account Klaviyo key (self-serve uses owner account)
    const klaviyoApiKey = (await getAccountKlaviyoApiKey(accountId)) || process.env.KLAVIYO_API_KEY || '';
    log('key_resolved', { hasKey: !!klaviyoApiKey, keySource: (await getAccountKlaviyoApiKey(accountId)) ? 'account' : (process.env.KLAVIYO_API_KEY ? 'env' : 'none') });

    // Forward to orchestrator to avoid inconsistencies and ensure full CSVs
    try {
      const fwd = await fetch(`${origin}/api/dashboard/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-job-secret': process.env.ADMIN_JOB_SECRET || '' },
        body: JSON.stringify({
          mode: 'live',
          accountId,
          days,
          klaviyoApiKey,
          flow: { enrichMessageNames: true },
          audience: { schema: 'required' }
        })
      });
      const text = await fwd.text().catch(() => '');
      let json: any = null; try { json = JSON.parse(text); } catch {}
      log('forwarded_to_orchestrator', { status: fwd.status });
      if (!fwd.ok) {
        return new Response(JSON.stringify({ error: 'OrchestratorFailed', status: fwd.status, details: text, logs }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ...json, logs, forwarded: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e: any) {
      log('forward_error', { message: String(e?.message || e), origin });
      return new Response(JSON.stringify({ error: 'ForwardFetchFailed', details: String(e?.message || e), origin, logs }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
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
