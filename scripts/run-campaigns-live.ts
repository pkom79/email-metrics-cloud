import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import crypto from 'crypto';
import dayjs from '../lib/dayjs';
import { createServiceClient } from '../lib/supabase/server';
import {
  fetchAccountTimezone,
  fetchCampaigns,
  fetchCampaignMessages,
  fetchCampaignMessageDetail,
  fetchCampaignAudiences,
  fetchCampaignTags,
  fetchCampaignValues,
  fetchListDetails,
  fetchCampaignAudienceNamesViaCampaignDetail,
  fetchCampaignMessageAudienceNames,
  fetchSegmentDetails,
  fetchMetricIds,
  fetchAllLists,
  fetchAllSegments,
  aggregateCampaignMetricsViaEvents,
} from '../lib/klaviyo/client';

type Row = {
  campaign_name: string;
  subject: string;
  send_time: string;
  send_weekday: string;
  total_recipients: number;
  unique_placed_order: number;
  placed_order_rate: number;
  revenue: number;
  unique_opens: number;
  open_rate: number;
  total_opens: number;
  unique_clicks: number;
  click_rate: number;
  total_clicks: number;
  unsubscribes: number;
  spam_complaints: number;
  spam_complaints_rate: number;
  successful_deliveries: number;
  bounces: number;
  bounce_rate: number;
  campaign_id: string;
  campaign_channel: string;
};

function loadEnvFile(path: string) {
  try {
    const content = readFileSync(resolve(path), 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      // Allow overriding existing envs for this script (default true)
      const override = (process.env.CAMPAIGN_ENV_OVERRIDE || 'true').toLowerCase() !== 'false';
      if (override || !process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function toCsv(rows: Row[]): string {
  const headers = [
    'Campaign Name','Subject','Send Time','Send Weekday','Total Recipients','Unique Placed Order','Placed Order Rate','Revenue','Unique Opens','Open Rate','Total Opens','Unique Clicks','Click Rate','Total Clicks','Unsubscribes','Spam Complaints','Spam Complaints Rate','Successful Deliveries','Bounces','Bounce Rate','Campaign ID','Campaign Channel'
  ];
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.campaign_name,r.subject,r.send_time,r.send_weekday,r.total_recipients,r.unique_placed_order,r.placed_order_rate,r.revenue,r.unique_opens,r.open_rate,r.total_opens,r.unique_clicks,r.click_rate,r.total_clicks,r.unsubscribes,r.spam_complaints,r.spam_complaints_rate,r.successful_deliveries,r.bounces,r.bounce_rate,r.campaign_id,r.campaign_channel
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

async function uploadToSupabase(filePath: string, bucket = 'campaign-staging', objectKey = process.env.CAMPAIGN_UPLOAD_PREFIX || 'acc_canary_1'): Promise<void> {
  const supabase = createServiceClient();
  const content = readFileSync(filePath);
  const fileName = filePath.split('/').pop()!;
  const key = `${objectKey}/${fileName}`;
  const isCsv = fileName.endsWith('.csv');
  const primaryType = isCsv ? 'text/csv' : 'application/json';
  if (!isCsv && (process.env.CAMPAIGN_UPLOAD_JSON || 'false').toLowerCase() !== 'true') {
    // Skip JSON uploads unless explicitly enabled
    console.log(`Skipping JSON upload for ${fileName} (CAMPAIGN_UPLOAD_JSON != true)`);
    return;
  }
  let { error } = await (supabase as any).storage.from(bucket).upload(key, content, { upsert: true, contentType: primaryType });
  if (error && !isCsv) {
    const msg = String(error?.message || error || '');
    if (/mime type|content[- ]type/i.test(msg)) {
      // retry with a more permissive content type
      const fallbackType = 'text/plain';
      const retry = await (supabase as any).storage.from(bucket).upload(key, content, { upsert: true, contentType: fallbackType });
      error = retry.error;
    }
  }
  if (error) throw new Error(`Supabase upload failed: ${error.message || String(error)}`);
  console.log(`Uploaded to supabase://${bucket}/${key}`);
}

async function main() {
  loadEnvFile('.env.local');
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) throw new Error('KLAVIYO_API_KEY not set');
  const outDir = resolve('email-metrics-cloud-tmp');
  mkdirSync(outDir, { recursive: true });
  const cacheDir = resolve(outDir, 'caches');
  mkdirSync(cacheDir, { recursive: true });
  const stateKey = (process.env.CAMPAIGN_STATE_KEY || '').trim() || crypto.createHash('sha1').update(apiKey).digest('hex').slice(0, 8);
  const statePath = resolve(outDir, `campaigns-live.${stateKey}.state.json`);
  const jsonPath = resolve(outDir, 'campaigns-live.json');
  const csvPath = resolve(outDir, 'campaigns-live.csv');
  const campaignsListCachePath = resolve(cacheDir, `campaigns.list.${stateKey}.json`);
  const audienceCachePath = resolve(cacheDir, `audiences.map.${stateKey}.json`);

  let state: { done: string[] } = { done: [] };
  const resetState = (process.env.CAMPAIGN_RESET_STATE || 'false').toLowerCase() === 'true';
  const ignoreState = (process.env.CAMPAIGN_IGNORE_STATE || 'false').toLowerCase() === 'true';
    const uploadOnlyOnFinal = (process.env.CAMPAIGN_UPLOAD_ONLY_ON_FINAL || '').toLowerCase() === 'true';
    const chunkSize = Math.max(1, Number(process.env.CAMPAIGN_CHUNK_SIZE || 10));
    const delayBetweenChunksMs = Math.max(0, Number(process.env.CAMPAIGN_DELAY_BETWEEN_CHUNKS_MS || 500));
    const parallelMetadata = (process.env.CAMPAIGN_PARALLEL_METADATA || 'true').toLowerCase() !== 'false';
    const skipTags = (process.env.CAMPAIGN_SKIP_TAGS || 'false').toLowerCase() === 'true';
    const perCampaignSleepMs = Math.max(0, Number(process.env.CAMPAIGN_PER_CAMPAIGN_SLEEP_MS || 0));
    const perChunkTimeBudgetMs = Math.max(30_000, Number(process.env.CAMPAIGN_CHUNK_TIME_BUDGET_MS || 90_000));
  try { if (!resetState) state = JSON.parse(readFileSync(statePath, 'utf-8')); } catch {}

  const logTiming = (process.env.CAMPAIGN_LOG_TIMING || 'true').toLowerCase() !== 'false';
  const debugAud = (process.env.CAMPAIGN_DEBUG_AUDIENCES || 'false').toLowerCase() === 'true';
  const skipAudience = (process.env.CAMPAIGN_SKIP_AUDIENCE_NAMES || 'false').toLowerCase() === 'true';
  const skipValues = (process.env.CAMPAIGN_SKIP_VALUES || 'false').toLowerCase() === 'true';
  const valuesConcurrency = Math.max(1, Number(process.env.CAMPAIGN_VALUES_CONCURRENCY || 1));
  const useCampaignListCache = (process.env.CAMPAIGN_USE_CAMPAIGN_LIST_CACHE || 'true').toLowerCase() !== 'false';
  const campaignListCacheTtlMs = Math.max(60_000, Number(process.env.CAMPAIGN_CAMPAIGN_LIST_CACHE_TTL_MS || (24 * 60 * 60 * 1000)));
  const primeAudienceCache = (process.env.CAMPAIGN_PRIME_AUDIENCE_CACHE || 'false').toLowerCase() === 'true';
  const audienceCacheTtlMs = Math.max(60_000, Number(process.env.CAMPAIGN_AUDIENCE_CACHE_TTL_MS || (24 * 60 * 60 * 1000)));
  if (logTiming) {
    console.log('[config] STATE_FILE=', statePath);
    console.log('[config] STATE_ENTRIES=', state.done.length);
    console.log('[config] CAMPAIGN_LIMIT=', process.env.CAMPAIGN_LIMIT || 20);
    console.log('[config] CAMPAIGN_CHUNK_SIZE=', process.env.CAMPAIGN_CHUNK_SIZE || 10);
    console.log('[config] CAMPAIGN_SKIP_TAGS=', process.env.CAMPAIGN_SKIP_TAGS || 'false');
    console.log('[config] CAMPAIGN_IGNORE_STATE=', process.env.CAMPAIGN_IGNORE_STATE || 'false');
    console.log('[config] CAMPAIGN_UPLOAD_ONLY_ON_FINAL=', process.env.CAMPAIGN_UPLOAD_ONLY_ON_FINAL || 'true');
    console.log('[config] CAMPAIGN_UPLOAD_PREFIX=', process.env.CAMPAIGN_UPLOAD_PREFIX || 'acc_canary_1');
    console.log('[config] CAMPAIGN_TARGET_CAMPAIGN_ID=', process.env.CAMPAIGN_TARGET_CAMPAIGN_ID || '');
    console.log('[config] CAMPAIGN_TARGET_CAMPAIGN_IDS=', process.env.CAMPAIGN_TARGET_CAMPAIGN_IDS || '');
    console.log('[config] CAMPAIGN_SKIP_AUDIENCE_NAMES=', process.env.CAMPAIGN_SKIP_AUDIENCE_NAMES || 'false');
    console.log('[config] CAMPAIGN_SKIP_VALUES=', process.env.CAMPAIGN_SKIP_VALUES || 'false');
    console.log('[config] CAMPAIGN_VALUES_CONCURRENCY=', process.env.CAMPAIGN_VALUES_CONCURRENCY || '1');
    console.log('[config] CAMPAIGN_USE_CAMPAIGN_LIST_CACHE=', process.env.CAMPAIGN_USE_CAMPAIGN_LIST_CACHE || 'true');
    console.log('[config] CAMPAIGN_CAMPAIGN_LIST_CACHE_TTL_MS=', String(campaignListCacheTtlMs));
    console.log('[config] CAMPAIGN_PRIME_AUDIENCE_CACHE=', process.env.CAMPAIGN_PRIME_AUDIENCE_CACHE || 'false');
    console.log('[config] CAMPAIGN_AUDIENCE_CACHE_TTL_MS=', String(audienceCacheTtlMs));
    console.log('[config] KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE=', process.env.KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE || 6);
    console.log('[config] KLAVIYO_LIMIT_GLOBAL_PER_MINUTE=', process.env.KLAVIYO_LIMIT_GLOBAL_PER_MINUTE || 60);
  }
  const tzStart = Date.now();
  const timezone = (await fetchAccountTimezone(apiKey)) || 'UTC';
  if (logTiming) console.log(`[timing] account timezone ${Date.now() - tzStart}ms`);
  const maxCampaigns = Math.max(1, Number(process.env.CAMPAIGN_LIMIT || 20));
  const targetId = (process.env.CAMPAIGN_TARGET_CAMPAIGN_ID || '').trim();
  const targetIdsCsv = (process.env.CAMPAIGN_TARGET_CAMPAIGN_IDS || '').trim();
  const targetIds: string[] = [];
  if (targetId) targetIds.push(targetId);
  if (targetIdsCsv) targetIds.push(...targetIdsCsv.split(',').map(s => s.trim()).filter(Boolean));
  let campaigns: any[] = [];
  // Helper: read/write TTL cache
  const readTtlCache = (path: string, ttlMs: number): any | null => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as { ts: number; data: any };
      if (Date.now() - (raw?.ts || 0) <= ttlMs) return raw.data;
    } catch {}
    return null;
  };
  const writeTtlCache = (path: string, data: any) => {
    try { writeFileSync(path, JSON.stringify({ ts: Date.now(), data }, null, 2)); } catch {}
  };
  // Path 1: direct campaign IDs (fastest)
  if (targetIds.length > 0) {
    if (logTiming) console.log(`[sync] Direct fetch ${targetIds.length} campaign(s)`);
    const ids = maxCampaigns ? targetIds.slice(0, maxCampaigns) : targetIds;
    const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> => {
      const res: R[] = new Array(items.length) as any;
      let next = 0;
      let active = 0;
      return await new Promise((resolveAll, rejectAll) => {
        const pump = () => {
          if (next >= items.length && active === 0) return resolveAll(res);
          while (active < limit && next < items.length) {
            const idx = next++;
            active++;
            fn(items[idx], idx).then((r) => {
              res[idx] = r;
              active--; pump();
            }, (e) => rejectAll(e));
          }
        };
        pump();
      });
    };
    const fetched = await mapLimit(ids, 3, async (cid) => {
      const start = Date.now();
      const one = await (await import('../lib/klaviyo/client')).fetchCampaignById(apiKey, cid);
      if (logTiming) console.log(`[timing] fetchCampaignById(${cid}) ${Date.now() - start}ms`);
      return one as any;
    });
    campaigns = fetched.filter(Boolean) as any[];
  }
  // Path 2: cached list
  if (campaigns.length === 0 && useCampaignListCache) {
    const cached = readTtlCache(campaignsListCachePath, campaignListCacheTtlMs);
    if (cached && Array.isArray(cached)) {
      if (logTiming) console.log(`[cache] Using cached campaign list (${cached.length})`);
      campaigns = cached as any[];
    }
  }
  // Path 3: fresh fetch and cache
  if (campaigns.length === 0) {
    const campFetchStart = Date.now();
    campaigns = await fetchCampaigns(apiKey, { channel: 'email' });
    if (logTiming) console.log(`[timing] fetchCampaigns ${Date.now() - campFetchStart}ms (count=${campaigns.length})`);
    if (useCampaignListCache) writeTtlCache(campaignsListCachePath, campaigns);
  }
  // Optionally filter to sent campaigns within a recent window to avoid empty metrics on aged/unsent items
  const onlySent = (process.env.CAMPAIGN_ONLY_SENT || 'true').toLowerCase() === 'true';
  const minDays = Math.max(0, Number(process.env.CAMPAIGN_MIN_SEND_WITHIN_DAYS || 120));
  if (onlySent || minDays > 0) {
    const cutoff = dayjs().subtract(minDays, 'day');
    campaigns = campaigns.filter((c: any) => {
      const st = (c?.attributes?.status || '').toLowerCase();
      const ts = c?.attributes?.send_time || c?.attributes?.scheduled_at;
      const hasSent = !!c?.attributes?.send_time;
      const within = ts ? dayjs(ts).isAfter(cutoff) : true;
      return (!onlySent || st === 'sent') && within;
    });
  }
  // Optional: target a date range by send date (local account timezone). Format: YYYY-MM-DD
  // Range takes precedence over single date if provided.
  const targetStartDate = (process.env.CAMPAIGN_TARGET_START_SEND_DATE || '').trim();
  const targetEndDate = (process.env.CAMPAIGN_TARGET_END_SEND_DATE || '').trim();
  if (targetStartDate || targetEndDate) {
    const beforeCount = campaigns.length;
    const startS = targetStartDate || targetEndDate; // if only one provided, use that as both bounds
    const endS = targetEndDate || targetStartDate;
    campaigns = campaigns.filter((c: any) => {
      const ts = c?.attributes?.send_time || c?.attributes?.scheduled_at;
      if (!ts) return false;
      const localDay = dayjs(ts).tz(timezone).format('YYYY-MM-DD');
      if (startS && localDay < startS) return false;
      if (endS && localDay > endS) return false;
      return true;
    });
    if (logTiming) console.log(`[filter] CAMPAIGN_TARGET_START_SEND_DATE=${targetStartDate || '-'} CAMPAIGN_TARGET_END_SEND_DATE=${targetEndDate || '-'} matched ${campaigns.length}/${beforeCount}`);
  } else {
    // Optional: target a specific send date (local account timezone). Format: YYYY-MM-DD
    const targetSendDate = (process.env.CAMPAIGN_TARGET_SEND_DATE || '').trim();
    if (targetSendDate) {
      const beforeCount = campaigns.length;
      campaigns = campaigns.filter((c: any) => {
        const ts = c?.attributes?.send_time || c?.attributes?.scheduled_at;
        if (!ts) return false;
        const localDay = dayjs(ts).tz(timezone).format('YYYY-MM-DD');
        return localDay === targetSendDate;
      });
      if (logTiming) console.log(`[filter] CAMPAIGN_TARGET_SEND_DATE=${targetSendDate} matched ${campaigns.length}/${beforeCount}`);
    }
  }
  // Exclude campaigns already present in state before selecting limited set (unless ignoring state)
  if (!ignoreState && Array.isArray(state.done) && state.done.length > 0) {
    const doneSet = new Set(state.done);
    campaigns = campaigns.filter((c: any) => c?.id && !doneSet.has(c.id));
  }
  // Sort campaigns by send_time/scheduled_at descending and then limit
  const sortKey = (c: any) => (c?.attributes?.send_time || c?.attributes?.scheduled_at || '') as string;
  campaigns.sort((a: any, b: any) => {
    const av = sortKey(a) || '';
    const bv = sortKey(b) || '';
    if (!av && !bv) return 0;
    if (!av) return 1; // push empties to bottom
    if (!bv) return -1;
    return av > bv ? -1 : av < bv ? 1 : 0;
  });
  const limited = campaigns.slice(0, maxCampaigns);
  const metricIds = await fetchMetricIds(apiKey, ['Placed Order']);
  const conversionMetricId = metricIds['Placed Order'];
  // Audience cache: id -> { name, type }
  const audienceCache: Map<string, { name: string; type: 'list' | 'segment' } > = new Map();
  // load existing audience cache
  const bootAud = readTtlCache(audienceCachePath, audienceCacheTtlMs);
  if (bootAud && Array.isArray(bootAud)) {
    for (const [id, val] of bootAud as Array<[string, { name: string; type: 'list' | 'segment' }]>) {
      if (id && val?.name && (val.type === 'list' || val.type === 'segment')) audienceCache.set(id, val);
    }
  }
  // Prime audience cache if requested
  if (primeAudienceCache && !skipAudience) {
    const primeStart = Date.now();
    try {
      const [lists, segments] = await Promise.all([
        fetchAllLists(apiKey),
        fetchAllSegments(apiKey),
      ]);
      for (const l of lists) audienceCache.set(l.id, { name: l.name, type: 'list' });
      for (const s of segments) audienceCache.set(s.id, { name: s.name, type: 'segment' });
      writeTtlCache(audienceCachePath, [...audienceCache.entries()]);
      if (logTiming) console.log(`[timing] prime audiences ${Date.now() - primeStart}ms (lists=${lists.length}, segments=${segments.length})`);
    } catch (e) {
      console.warn('[warn] Audience prime failed:', String(e));
    }
  }
  const saveAudienceCacheThrottled = (() => {
    let last = 0;
    return () => {
      const now = Date.now();
      if (now - last > 2000) { // at most once every 2s
        writeTtlCache(audienceCachePath, [...audienceCache.entries()]);
        last = now;
      }
    };
  })();
  const listCache = new Map<string, string>();
  // Simple concurrency limiter for values calls (avoid 429 long retry-afters)
  const createConcurrency = (limit: number) => {
    let active = 0;
    const q: Array<() => void> = [];
    return async function run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) await new Promise<void>(resolve => q.push(resolve));
      active++;
      try { return await fn(); } finally { active--; const next = q.shift(); if (next) next(); }
    };
  };
  const withValuesConcurrency = createConcurrency(valuesConcurrency);
  const rows: Row[] = [];

  // simple concurrency control for within-chunk processing
  const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> => {
    const res: R[] = new Array(items.length) as any;
    let next = 0;
    let active = 0;
    return await new Promise((resolveAll, rejectAll) => {
      const pump = () => {
        if (next >= items.length && active === 0) return resolveAll(res);
        while (active < limit && next < items.length) {
          const idx = next++;
          active++;
          fn(items[idx], idx).then((r) => {
            res[idx] = r;
            active--;
            pump();
          }, (e) => rejectAll(e));
        }
      };
      pump();
    });
  };

  for (let i = 0; i < limited.length; i += chunkSize) {
    const startTick = Date.now();
    const chunk = limited.slice(i, i + chunkSize);
    const results = await mapLimit(chunk, 3, async (campaign) => {
        const campaignStart = Date.now();
        const id = (campaign as any)?.id as string;
        if (!id) return null;
        if (!ignoreState && state.done.includes(id)) {
          if (logTiming) console.log(`[timing] ${id} skipped (already in state)`);
          return null;
        }
        const attributes = (campaign as any)?.attributes || {};
        const name = attributes.name || id;
        const sendTimeRaw = attributes.send_time || attributes.scheduled_at;
        const sendTime = sendTimeRaw ? dayjs(sendTimeRaw).tz(timezone) : null;
        const sendWeekday = sendTime ? sendTime.format('dddd') : '';

        // fetch metadata concurrently if enabled
        // Tags/List dropped to optimize speed
        const audStart = Date.now();
        const audiencesPromise = skipAudience
          ? Promise.resolve([] as any[])
          : Promise.resolve(fetchCampaignAudiences(apiKey, id).catch(() => [])).then((r) => { if (logTiming) console.log(`[timing] ${id} fetchCampaignAudiences ${Date.now() - audStart}ms`); return r; });
        const msgStart = Date.now();
        const messagesPromise = Promise.resolve(fetchCampaignMessages(apiKey, id).catch(() => [] as any[])).then((r) => { if (logTiming) console.log(`[timing] ${id} fetchCampaignMessages ${Date.now() - msgStart}ms`); return r; });
        // Use per-campaign timeframe: from send_time (or scheduled_at) to now, unless CAMPAIGN_VALUES_TIMEFRAME_KEY provided
        const valStart = Date.now();
        const valuesPromise = skipValues
          ? Promise.resolve([] as any)
          : (async () => {
              const tfKey = (process.env.CAMPAIGN_VALUES_TIMEFRAME_KEY || '').trim();
              let result: any[] = [];
              let tried: string[] = [];
              const call = async (label: string, args: { timeframeKey?: string; startISO?: string; endISO?: string }) => {
                tried.push(label);
                try {
                  return await withValuesConcurrency(() => fetchCampaignValues({ apiKey, campaignIds: [id], conversionMetricId, ...args }));
                } catch (e: any) {
                  const msg = String(e?.message || e || '');
                  if (msg.includes('retry-after=') && msg.includes('exceeds threshold')) {
                    console.warn(`[skip] ${id} campaign-values skipped due to long retry-after (${msg})`);
                    return [] as any[];
                  }
                  throw e;
                }
              };
              if (tfKey) {
                result = await call(`key:${tfKey}`, { timeframeKey: tfKey });
              } else {
                // Under strict steady limits, use a focused window around send_time to increase hit probability
                // while keeping the window modest (some APIs reject very large windows).
                const single = (process.env.CAMPAIGN_VALUES_SINGLE_CALL || 'true').toLowerCase() === 'true';
                const strictSendDay = (process.env.CAMPAIGN_VALUES_STRICT_SEND_DAY || 'false').toLowerCase() === 'true';
                const leadDays = Math.max(0, Number(process.env.CAMPAIGN_VALUES_LEAD_DAYS || 1));
                const tailDays = Math.max(1, Number(process.env.CAMPAIGN_VALUES_TAIL_DAYS || 30));
                const fbLeadDays = Math.max(leadDays, Number(process.env.CAMPAIGN_VALUES_FALLBACK_LEAD_DAYS || 3));
                const fbTailDays = Math.max(tailDays, Number(process.env.CAMPAIGN_VALUES_FALLBACK_TAIL_DAYS || 60));
                const nowIso = dayjs().toISOString();
                if (!sendTime) {
                  // No send time; fall back to last_30_days key
                  result = await call('key:last_30_days(no-send)', { timeframeKey: 'last_30_days' });
                } else if (strictSendDay) {
                  // Force the timeframe to the send day only (account timezone), capped at now
                  const startISO = sendTime.startOf('day').toISOString();
                  const endISO = (sendTime.endOf('day').isAfter(dayjs()) ? dayjs() : sendTime.endOf('day')).toISOString();
                  result = await call('send-day-only', { startISO, endISO });
                  // Optional: If nothing returned, do not widen when strict mode is on
                } else if (single) {
                  const startISO = dayjs(sendTime).subtract(leadDays, 'day').toISOString();
                  const endISO = (dayjs(sendTime).add(tailDays, 'day').isAfter(dayjs()) ? dayjs() : dayjs(sendTime).add(tailDays, 'day')).toISOString();
                  result = await call(`send-${leadDays}d→+${tailDays}d(single)`, { startISO, endISO });
                  if (!Array.isArray(result) || result.length === 0) {
                    const fbStart = dayjs(sendTime).subtract(fbLeadDays, 'day').toISOString();
                    const fbEnd = (dayjs(sendTime).add(fbTailDays, 'day').isAfter(dayjs()) ? dayjs() : dayjs(sendTime).add(fbTailDays, 'day')).toISOString();
                    result = await call(`send-${fbLeadDays}d→+${fbTailDays}d(fallback)`, { startISO: fbStart, endISO: fbEnd });
                  }
                } else {
                  // Legacy progressive widening toward now
                  const baseStart = dayjs(sendTime);
                  const windows = [
                    { label: `send-${leadDays}d→+${tailDays}d`, startISO: baseStart.subtract(leadDays, 'day').toISOString(), endISO: (baseStart.add(tailDays, 'day').isAfter(dayjs()) ? dayjs() : baseStart.add(tailDays, 'day')).toISOString() },
                    { label: `send-${fbLeadDays}d→+${fbTailDays}d`, startISO: baseStart.subtract(fbLeadDays, 'day').toISOString(), endISO: (baseStart.add(fbTailDays, 'day').isAfter(dayjs()) ? dayjs() : baseStart.add(fbTailDays, 'day')).toISOString() },
                    { label: 'send→now', startISO: baseStart.toISOString(), endISO: nowIso },
                  ];
                  for (const w of windows) {
                    result = await call(w.label, { startISO: w.startISO, endISO: w.endISO });
                    if (Array.isArray(result) && result.length > 0) break;
                  }
                }
              }
              if (logTiming) console.log(`[timing] ${id} fetchCampaignValues ${Date.now() - valStart}ms via ${tried.join(' > ')}`);
              return result;
            })();

        const [audiences, messages, values] = await Promise.all([
          audiencesPromise,
          messagesPromise,
          valuesPromise
        ]);
        if (debugAud) {
          try {
            console.log(`[debug] ${id} raw audiences:`, JSON.stringify(audiences).slice(0, 5000));
          } catch {}
        }

        // Determine email message and fetch its detail for subject
        const emailMessage = (messages as any[]).find(m => (m?.attributes?.channel || m?.attributes?.definition?.channel || '').toLowerCase() === 'email') || (messages as any[])[0];
        let subject = '';
        if (emailMessage?.id) {
          try {
            const detStart = Date.now();
            const msgDetail = await fetchCampaignMessageDetail(apiKey, emailMessage.id);
            if (logTiming) console.log(`[timing] ${id} fetchCampaignMessageDetail ${Date.now() - detStart}ms`);
            subject = (msgDetail as any)?.definition?.content?.subject || (msgDetail as any)?.content?.subject || '';
          } catch {}
        }
  const listNames: string[] = [];
  const segmentNames: string[] = [];
        if (!skipAudience) for (const a of (audiences as any[])) {
          const aid = a?.id;
          const atype = (a?.kind || '').toLowerCase();
          const aname = a?.name;
          if (!aid) continue;
          if (atype === 'list') {
            if (a?.name) {
              listNames.push(a.name);
            } else {
              // Check audience cache first
              const cached = audienceCache.get(aid);
              if (cached?.name) {
                listNames.push(cached.name);
              } else {
                if (!listCache.has(aid)) {
                  try {
                    const listStart = Date.now();
                    const details = await fetchListDetails(apiKey, aid);
                    if (logTiming) console.log(`[timing] ${id} fetchListDetails(${aid}) ${Date.now() - listStart}ms`);
                    const nm = (details as any).name || aid;
                    listCache.set(aid, nm);
                    audienceCache.set(aid, { name: nm, type: 'list' });
                    saveAudienceCacheThrottled();
                  } catch { listCache.set(aid, aid); }
                }
                listNames.push(listCache.get(aid)!);
              }
            }
          } else if (atype === 'segment') {
            const cached = audienceCache.get(aid);
            if (cached?.name) {
              segmentNames.push(cached.name);
            } else {
              try {
                const segStart = Date.now();
                const details = await fetchSegmentDetails(apiKey, aid);
                if (logTiming) console.log(`[timing] ${id} fetchSegmentDetails(${aid}) ${Date.now() - segStart}ms`);
                const n = (details as any).name || aid;
                audienceCache.set(aid, { name: n, type: 'segment' });
                saveAudienceCacheThrottled();
                segmentNames.push(n);
              } catch {
                segmentNames.push(a?.name || aid);
              }
            }
          } else if (aname) {
            // Unknown kind: treat as list-like for display purposes
            listNames.push(aname);
          } else {
            // Unknown kind and no name: resolve by probing list then segment
            let resolved = false;
            try {
              const listStart = Date.now();
              const details = await fetchListDetails(apiKey, aid);
              if (logTiming) console.log(`[timing] ${id} resolveUnknown(list ${aid}) ${Date.now() - listStart}ms`);
              const n = (details as any).name || aid;
              listNames.push(n);
              audienceCache.set(aid, { name: n, type: 'list' });
              saveAudienceCacheThrottled();
              resolved = true;
            } catch {}
            if (!resolved) {
              try {
                const segStart = Date.now();
                const details = await fetchSegmentDetails(apiKey, aid);
                if (logTiming) console.log(`[timing] ${id} resolveUnknown(segment ${aid}) ${Date.now() - segStart}ms`);
                const n = (details as any).name || aid;
                segmentNames.push(n);
                audienceCache.set(aid, { name: n, type: 'segment' });
                saveAudienceCacheThrottled();
                resolved = true;
              } catch {}
            }
            if (!resolved) {
              // As a last resort, include the id so the column isn't empty
              listNames.push(aid);
            }
          }
        }

        // Fallback if both lists and segments are empty: try campaign detail include=audiences
        if (!skipAudience && listNames.length === 0 && segmentNames.length === 0) {
          try {
            const fbStart = Date.now();
            const names = await fetchCampaignAudienceNamesViaCampaignDetail(apiKey, id);
            if (logTiming) console.log(`[timing] ${id} campaign include=audiences fallback ${Date.now() - fbStart}ms`);
            for (const n of names) {
              if (n.kind === 'list' && n.name) listNames.push(n.name);
              if (n.kind === 'segment' && n.name) segmentNames.push(n.name);
            }
          } catch {}
        }
        // Fallback via campaign-message include=audience
        if (!skipAudience && listNames.length === 0 && segmentNames.length === 0 && emailMessage?.id) {
          try {
            const fb2Start = Date.now();
            const names = await fetchCampaignMessageAudienceNames(apiKey, emailMessage.id);
            if (logTiming) console.log(`[timing] ${id} message include=audience fallback ${Date.now() - fb2Start}ms`);
            for (const n of names) {
              if (n.kind === 'list' && n.name) listNames.push(n.name);
              if (n.kind === 'segment' && n.name) segmentNames.push(n.name);
            }
          } catch {}
        }

        // Aggregate statistics across all returned rows (some accounts return multiple rows)
        let arr = Array.isArray(values) ? (values as any[]) : [];
        if (arr.length === 0) {
          if (logTiming) console.log(`[warn] ${id} campaign-values returned no rows`);
          // Optional fallback: aggregate via Events API within the same focused window
          const enableFallback = (process.env.CAMPAIGN_VALUES_EVENTS_FALLBACK || 'true').toLowerCase() === 'true';
          if (enableFallback) {
            try {
              const leadDays = Math.max(0, Number(process.env.CAMPAIGN_VALUES_LEAD_DAYS || 1));
              const tailDays = Math.max(1, Number(process.env.CAMPAIGN_VALUES_TAIL_DAYS || 30));
              const fbLeadDays = Math.max(leadDays, Number(process.env.CAMPAIGN_VALUES_FALLBACK_LEAD_DAYS || 3));
              const fbTailDays = Math.max(tailDays, Number(process.env.CAMPAIGN_VALUES_FALLBACK_TAIL_DAYS || 60));
              if (sendTime) {
                const startISO = dayjs(sendTime).subtract(leadDays, 'day').toISOString();
                const endISO = (dayjs(sendTime).add(tailDays, 'day').isAfter(dayjs()) ? dayjs() : dayjs(sendTime).add(tailDays, 'day')).toISOString();
                const fbStart = dayjs(sendTime).subtract(fbLeadDays, 'day').toISOString();
                const fbEnd = (dayjs(sendTime).add(fbTailDays, 'day').isAfter(dayjs()) ? dayjs() : dayjs(sendTime).add(fbTailDays, 'day')).toISOString();
                // Try focused then fallback window
                const msgId = (emailMessage as any)?.id as string | undefined;
                let ev = await aggregateCampaignMetricsViaEvents({ apiKey, startISO, endISO, campaignId: id, campaignMessageId: msgId, maxPagesPerMetric: 3 });
                if (!ev || !ev.statistics || Object.keys(ev.statistics).length === 0) {
                  ev = await aggregateCampaignMetricsViaEvents({ apiKey, startISO: fbStart, endISO: fbEnd, campaignId: id, campaignMessageId: msgId, maxPagesPerMetric: 3 });
                }
                if (ev && ev.statistics && Object.keys(ev.statistics).length > 0) {
                  if (logTiming) console.log(`[info] ${id} filled via Events fallback`);
                  arr = [{ campaign_id: id, statistics: ev.statistics }];
                } else {
                  if (logTiming) console.log(`[info] ${id} Events fallback produced no stats`);
                }
              }
            } catch (e) {
              console.warn(`[warn] ${id} Events fallback failed:`, String(e));
            }
          } else if (logTiming) {
            console.log(`[info] ${id} Events fallback disabled`);
          }
        }
        const agg: Record<string, number> = {};
        for (const r of arr) {
          const st = (r?.statistics || {}) as Record<string, any>;
          for (const [k, v] of Object.entries(st)) {
            if (typeof v === 'number' && Number.isFinite(v)) agg[k] = (agg[k] || 0) + v;
          }
        }
        // Pull common fields with fallbacks
        const total_recipients = agg.recipients ?? 0;
        const successful_deliveries = agg.delivered ?? 0;
        const bounces = agg.bounced ?? agg.bounces ?? agg.bounce_count ?? 0;
        const unique_opens_val = agg.opens_unique ?? 0;
        const total_opens = agg.opens ?? unique_opens_val;
        const unique_clicks_val = agg.clicks_unique ?? 0;
        const total_clicks = agg.clicks ?? unique_clicks_val;
        const orders_unique = agg.conversion_uniques ?? 0;
        const revenue_val = agg.conversion_value ?? 0;
        const unsubscribes_val = agg.unsubscribes ?? 0;
        const spam_comp_val = agg.spam_complaints ?? 0;
        // Derive rates if missing
        const denomDelivered = successful_deliveries > 0 ? successful_deliveries : (total_recipients > 0 ? total_recipients : 0);
        const placed_order_rate_val = agg.conversion_rate ?? (denomDelivered ? orders_unique / denomDelivered : 0);
        const open_rate_val = agg.open_rate ?? (denomDelivered ? unique_opens_val / denomDelivered : 0);
        const click_rate_val = agg.click_rate ?? (denomDelivered ? unique_clicks_val / denomDelivered : 0);
        const bounce_rate_val = agg.bounce_rate ?? ((bounces + successful_deliveries) > 0 ? bounces / (bounces + successful_deliveries) : 0);
        const spam_rate_val = agg.spam_complaint_rate ?? (denomDelivered ? spam_comp_val / denomDelivered : 0);

        const row: Row = {
          campaign_name: name,
          subject,
          send_time: sendTime ? sendTime.format('YYYY-MM-DDTHH:mm:ssZ') : '',
          send_weekday: sendWeekday,
          total_recipients,
          unique_placed_order: orders_unique,
          placed_order_rate: placed_order_rate_val,
          revenue: revenue_val,
          unique_opens: unique_opens_val,
          open_rate: open_rate_val,
          total_opens,
          unique_clicks: unique_clicks_val,
          click_rate: click_rate_val,
          total_clicks,
          unsubscribes: unsubscribes_val,
          spam_complaints: spam_comp_val,
          spam_complaints_rate: spam_rate_val,
          successful_deliveries,
          bounces,
          bounce_rate: bounce_rate_val,
          campaign_id: id,
          campaign_channel: 'Email',
        };
        if (perCampaignSleepMs) await sleep(perCampaignSleepMs);
        if (logTiming) console.log(`[timing] ${id} total ${Date.now() - campaignStart}ms`);
        return { id, row };
      });

    const completed = (results.filter(Boolean) as Array<{ id: string; row: Row }>);
    for (const r of completed) {
      state.done.push(r.id);
      rows.push(r.row);
    }
    // Persist state and (optionally) outputs after each chunk
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    if (!uploadOnlyOnFinal) {
      writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
      writeFileSync(csvPath, toCsv(rows));
      try { await uploadToSupabase(jsonPath); } catch (e) { console.warn(String(e)); }
      try { await uploadToSupabase(csvPath); } catch (e) { console.warn(String(e)); }
    }

    // Time budget and pacing
    const elapsed = Date.now() - startTick;
    if (logTiming) console.log(`[timing] chunk processed in ${elapsed}ms (size=${chunk.length})`);
    if (elapsed > perChunkTimeBudgetMs) {
      console.log('Time budget nearly reached; exiting to resume later.');
      break;
    }
    if (delayBetweenChunksMs) await sleep(delayBetweenChunksMs);
  }
  // Finalize outputs if configured to upload only at the end
  if (uploadOnlyOnFinal) {
    writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
    writeFileSync(csvPath, toCsv(rows));
    try { await uploadToSupabase(jsonPath); } catch (e) { console.warn(String(e)); }
    try { await uploadToSupabase(csvPath); } catch (e) { console.warn(String(e)); }
  }

  console.log(`Processed ${state.done.length} campaigns; rows: ${rows.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
