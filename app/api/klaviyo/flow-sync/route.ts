import { NextRequest } from 'next/server';
// NOTE: This route lives at app/api/klaviyo/flow-sync/route.ts so lib is three levels up
import { fetchFlows, fetchFlowDetail, fetchMetricIds, fetchFlowReport, fetchFlowAnalytics, fetchFlowReportResults, fetchFlowMessages, fetchAccountTimezone } from '../../../../lib/klaviyo/client';
import { createServiceClient } from '../../../../lib/supabase/server';
import dayjs from '../../../../lib/dayjs';
import type { Dayjs } from 'dayjs';

export const dynamic = 'force-dynamic';

type Mode = 'dry-run' | 'live';
type Format = 'json' | 'csv';

interface Body {
  mode?: Mode;
  format?: Format; // only for dry-run
  accountId?: string;
  uploadId?: string;
  klaviyoApiKey?: string;
  days?: number;
  start?: string;
  end?: string;
  limitFlows?: number;
  limitMessages?: number;
  allowFallback?: boolean;
  aggregation?: 'per-day' | 'range' | 'auto'; // per-day = current behavior; range = single multi-day call; auto = try per-day then fallback to range if zero rows
  debug?: boolean;
  flowIds?: string[]; // optional filter list
  customTimeframe?: { start: string; end: string }; // explicit ISO timestamps
  statistics?: string[]; // override statistics list for broad report
  valueStatistics?: string[]; // override value statistics list (can be [])
  conversionMetricId?: string; // explicit override
  revision?: string; // optional Klaviyo API revision override
  groupBy?: string[]; // experimental: explicit grouping fields for flow-report
  timeframeKey?: string; // alternative timeframe shortcut (e.g., last_30_days)
  includeDrafts?: boolean; // include zero rows for draft flows (synthetic)
  enrichMessageNames?: boolean; // fetch flow-messages to map names/channels
  integrationName?: string; // prefer metrics for this integration (default Shopify)
  eventsFallback?: boolean; // if true, use Events API aggregation when flow-report returns no rows
}

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;
const FLOW_STAGING_BUCKET = process.env.FLOW_STAGING_BUCKET;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const ct = req.headers.get('content-type') || '';
    if (!/application\/json/i.test(ct)) {
      return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), { status: 415 });
    }
    const body: Body = await req.json().catch(() => ({}));
    const mode: Mode = body.mode || 'dry-run';
    const format: Format = body.format || 'json';
  // Synthetic per-message fallback now opt-in only; default is STRICT (no synthetic rows)
  const aggregationMode = body.aggregation || 'per-day';
  const debug = !!body.debug;

    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }

    // Auth gating (both modes require admin secret for consistency)
    const providedSecret = req.headers.get('x-admin-job-secret') || '';
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Live requires staging bucket and accountId
    if (mode === 'live') {
      if (!FLOW_STAGING_BUCKET) {
        return new Response(JSON.stringify({ error: 'FLOW_STAGING_BUCKET not configured' }), { status: 500 });
      }
      if (!body.accountId) {
        return new Response(JSON.stringify({ error: 'accountId required for live mode' }), { status: 400 });
      }
    }

    const apiKey = body.klaviyoApiKey || process.env.KLAVIYO_API_KEY_PRIVATE || process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });
    }

    const accountTimeZone = (await fetchAccountTimezone(apiKey).catch(() => undefined)) || 'UTC';

    // Date range resolution (supports customTimeframe with explicit ISO timestamps including times)
    let startZoned: Dayjs;
    let endZoned: Dayjs;
    if (body.customTimeframe?.start && body.customTimeframe?.end) {
      startZoned = dayjs(body.customTimeframe.start).tz(accountTimeZone).startOf('day');
      endZoned = dayjs(body.customTimeframe.end).tz(accountTimeZone).endOf('day');
    } else {
      const endCandidate = body.end ? dayjs.tz(body.end, accountTimeZone).endOf('day') : dayjs().tz(accountTimeZone).endOf('day');
      endZoned = endCandidate;
      if (body.start) {
        startZoned = dayjs.tz(body.start, accountTimeZone).startOf('day');
      } else if (body.days) {
        const d = Math.max(1, Math.min(body.days, 30));
        startZoned = endCandidate.startOf('day').subtract(d - 1, 'day');
      } else {
        startZoned = endCandidate.startOf('day').subtract(6, 'day');
      }
    }
    if (!startZoned.isValid() || !endZoned.isValid()) {
      return new Response(JSON.stringify({ error: 'Invalid timeframe dates' }), { status: 400 });
    }
    if (startZoned.isAfter(endZoned)) {
      return new Response(JSON.stringify({ error: 'start must be <= end' }), { status: 400 });
    }
    const totalDays = endZoned.startOf('day').diff(startZoned.startOf('day'), 'day') + 1;
    if (totalDays > 30) return new Response(JSON.stringify({ error: 'Range too large (max 30 days)' }), { status: 400 });
    const days: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      days.push(startZoned.startOf('day').add(i, 'day').format('YYYY-MM-DD'));
    }

    const rangeStartUtc = startZoned.startOf('day').utc();
    const rangeEndUtc = endZoned.endOf('day').utc();
    const rangeStartIso = rangeStartUtc.format('YYYY-MM-DDTHH:mm:ss[Z]');
    const rangeEndIso = rangeEndUtc.format('YYYY-MM-DDTHH:mm:ss[Z]');
    const rangeStartDate = rangeStartUtc.toDate();
    const rangeEndDate = rangeEndUtc.toDate();

    // Limits
    const limitFlows = Math.max(1, Math.min(body.limitFlows ?? 25, 100));
    const limitMessages = Math.max(1, Math.min(body.limitMessages ?? 20, 100));

    // Fetch flows (real only). Retry on 429 up to 3 times with backoff. No synthetic flows.
    let flows: any[] = [];
    {
      const attempts = 3;
      let lastErr: any;
      for (let a = 0; a < attempts; a++) {
        try {
          flows = await fetchFlows(apiKey, { pageSize: Math.min(limitFlows, 25), maxPages: 3 });
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          const msg = String(e?.message || '');
          if (/429/.test(msg) || /throttled/i.test(msg)) {
            // Parse suggested wait if present
            const waitMatch = msg.match(/available in (\d+) second/); // crude parsing
            const waitSec = waitMatch ? parseInt(waitMatch[1], 10) : 1 + a; // incremental backoff
            await sleep(waitSec * 1000);
            continue; // retry
          }
          // Non-rate limit error: abort
          break;
        }
      }
      if (!flows.length && lastErr) {
        const msg = String(lastErr?.message || lastErr);
        const rateLimited = /429/.test(msg) || /throttled/i.test(msg);
        if (body.eventsFallback === true) {
          // Proceed without flows to allow events fallback to run; record diagnostics
          if (debug) {
            (globalThis as any)._flowSyncDiag = (globalThis as any)._flowSyncDiag || {};
          }
          // No immediate return; continue so rows stay empty and events fallback runs later
          if (debug) {
            // Note: diagnostics variable not yet initialized; stash minimal message in a temp
            (globalThis as any)._flowSyncDiag.fetchFlowsError = { msg, rateLimited };
          }
        } else {
          return new Response(JSON.stringify({
            error: rateLimited ? 'KlaviyoRateLimited' : 'FetchFlowsFailed',
            details: msg,
            hint: rateLimited ? 'Reduce limitFlows or wait before retrying' : 'Check API key / Klaviyo availability',
          }), { status: rateLimited ? 429 : 502 });
        }
      }
    }
    // Optional flowIds filter
    let filteredFlows = flows;
    if (Array.isArray(body.flowIds) && body.flowIds.length > 0) {
      const set = new Set(body.flowIds.map(String));
      filteredFlows = flows.filter(f => set.has(f.id));
    }
    const liveFiltered = filteredFlows.filter(f => String(f?.attributes?.status || '').toLowerCase() === 'live');
    const selectedFlows = liveFiltered.slice(0, limitFlows);
    const selectedFlowIds = new Set(selectedFlows.map(f => f.id));
    const selectedFlowMap = new Map(selectedFlows.map(f => [f.id, f]));

    // Optional enrichment: fetch message metadata by flow
    const messageMetaById = new Map<string, { name?: string; channel?: string; flowActionId?: string; flowId?: string }>();
    const messageMetaByActionId = new Map<string, { messageId?: string; name?: string; channel?: string; flowId?: string }>();
    const messagesByFlow = new Map<string, string[]>();
    if (body.enrichMessageNames) {
      for (const flow of selectedFlows) {
        let fetchedMsgs: any[] = [];
        // Retry a few times on throttling
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            fetchedMsgs = await fetchFlowMessages(apiKey, flow.id, { pageSize: 50, maxPages: 3 });
            break;
          } catch (e: any) {
            const msg = String(e?.message || '');
            if (/429/.test(msg) || /throttled/i.test(msg)) {
              const backoff = 500 * (attempt + 1);
              await new Promise(r => setTimeout(r, backoff));
              continue;
            }
            throw e;
          }
        }
        const msgs = fetchedMsgs.slice(0, limitMessages);
        messagesByFlow.set(flow.id, msgs.map(m => String(m.id)));
        for (const m of msgs) {
          if (m?.id) {
            const flowActionId = m.flowActionId || m.relationships?.flow_action?.data?.id;
            messageMetaById.set(String(m.id), { name: m?.attributes?.name, channel: m?.attributes?.channel, flowActionId: flowActionId ? String(flowActionId) : undefined, flowId: flow.id });
            if (flowActionId) {
              messageMetaByActionId.set(String(flowActionId), {
                messageId: String(m.id),
                name: m?.attributes?.name,
                channel: m?.attributes?.channel,
                flowId: flow.id,
              });
            }
          }
          const actionId = m.flowActionId || m.relationships?.flow_action?.data?.id;
          if (actionId && !messageMetaByActionId.has(String(actionId))) {
            messageMetaByActionId.set(String(actionId), {
              messageId: m?.id ? String(m.id) : undefined,
              name: m?.attributes?.name,
              channel: m?.attributes?.channel,
              flowId: flow.id,
            });
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Discover conversion metric unless explicitly provided
    let conversionMetricId: string | undefined = body.conversionMetricId;
    if (!conversionMetricId) {
      try {
        const preferredIntegrationName = body.integrationName || 'Shopify';
        const mm = await fetchMetricIds(apiKey, ['Placed Order'], { preferredIntegrationName });
        conversionMetricId = mm['Placed Order'] || process.env.SHOPIFY_PLACED_ORDER_METRIC_ID || conversionMetricId;
      } catch {}
    }

    // Build rows
    const rows: any[] = [];

    const diagnostics: any = debug ? { flowCount: selectedFlows.length, details: [] as any[], aggregationMode } : undefined;
    if (debug && (globalThis as any)._flowSyncDiag?.fetchFlowsError) {
      diagnostics.fetchFlowsError = (globalThis as any)._flowSyncDiag.fetchFlowsError;
      delete (globalThis as any)._flowSyncDiag.fetchFlowsError;
    }

  const broadStats = Array.isArray(body.statistics) && body.statistics.length > 0 ? body.statistics : undefined;
  const broadValueStats = Array.isArray(body.valueStatistics) ? body.valueStatistics : undefined;
  const revisionOverride = body.revision;
  const groupByOverride = Array.isArray(body.groupBy) && body.groupBy.length > 0 ? body.groupBy : undefined;
  const effectiveGroupBy = groupByOverride
    ? Array.from(new Set([...groupByOverride, ...(groupByOverride.includes('flow_action_id') ? [] : ['flow_action_id'])]))
    : undefined;
  const timeframeKey = body.timeframeKey;

    function dayStartISO(day: string) { return dayjs.tz(day, accountTimeZone).startOf('day').format('YYYY-MM-DDTHH:mm:ssZ'); }
    function dayEndISO(day: string) { return dayjs.tz(day, accountTimeZone).endOf('day').format('YYYY-MM-DDTHH:mm:ssZ'); }
    const MAX_REPORT_RETRIES = 10;
    async function getFlowReportData(args: { start?: string; end?: string; key?: string }, debugLabel?: (info: any) => void, context?: string) {
      for (let attempt = 0; attempt < MAX_REPORT_RETRIES; attempt++) {
        try {
          return await fetchFlowReportResults({
            apiKey: apiKey as string,
            start: args.start,
            end: args.end,
            timeframeKey: args.key,
            conversionMetricId,
            statistics: broadStats,
            valueStatistics: broadValueStats,
            revision: revisionOverride,
            debugCallback: debugLabel,
          });
        } catch (err: any) {
          const status = err?.status || err?.response?.status;
          if (status === 429 && attempt < MAX_REPORT_RETRIES - 1) {
            const retryAfter = err?.headers?.['retry-after'];
            const baseDelay = retryAfter ? Number(retryAfter) * 1000 : 1500 * Math.pow(2, attempt);
            const delay = Math.min(baseDelay + Math.random() * 1000, 30000);
            if (diagnostics) diagnostics.details.push({ context, retryDelay: delay, attempt: attempt + 1, status: 429 });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw err;
        }
      }
      return [] as any[];
    }

    async function populatePerDay() {
      if (timeframeKey) return; // skip per-day if timeframeKey is provided

      for (const day of days) {
        const results = await getFlowReportData({ start: dayStartISO(day), end: dayEndISO(day) }, info => { if (diagnostics) diagnostics.details.push({ day, debug: info }); }, `day:${day}`);
        const perDayRows: any[] = [];
        const seenKeys = new Set<string>();
        for (const r of results) {
          if (!selectedFlowIds.has(String(r.flow_id || ''))) continue;
          if (!r.flow_id || (!r.flow_message_id && !r.flow_action_id)) continue; // require identifiers
          const flow = selectedFlowMap.get(String(r.flow_id));
          const flowName = flow?.attributes?.name || r.flow_id;
          const actionMeta = r.flow_action_id ? messageMetaByActionId.get(String(r.flow_action_id)) : undefined;
          const messageId = actionMeta?.messageId || (r.flow_message_id ? String(r.flow_message_id) : undefined);
          const messageMeta = messageId ? messageMetaById.get(messageId) : undefined;
          const resolvedMessageId = messageId || r.flow_message_id || r.flow_action_id;
          const resolvedName = actionMeta?.name || messageMeta?.name || resolvedMessageId;
          const resolvedChannel = actionMeta?.channel || messageMeta?.channel || r.send_channel || 'Email';
          if ((resolvedChannel || '').toLowerCase() !== 'email') continue;
          const key = `${day}|${r.flow_id}|${resolvedMessageId}`;
          seenKeys.add(key);
          perDayRows.push({
            Day: day,
            'Flow ID': r.flow_id,
            'Flow Name': flowName,
            'Flow Message ID': resolvedMessageId,
            'Flow Message Name': resolvedName,
            'Flow Message Channel': resolvedChannel,
            Status: 'live',
            Delivered: r.delivered || 0,
            'Unique Opens': r.opens_unique || 0,
            'Open Rate': r.open_rate || 0,
            'Unique Clicks': r.clicks_unique || 0,
            'Click Rate': r.click_rate || 0,
            'Placed Order': r.conversion_uniques || 0,
            'Placed Order Rate': r.conversion_rate || 0,
            Revenue: (r as any).conversion_value ?? r.revenue ?? 0,
            'Revenue per Recipient': r.revenue_per_recipient || 0,
            'Unsub Rate': r.unsubscribe_rate || 0,
            'Complaint Rate': r.spam_complaint_rate || 0,
            'Bounce Rate': r.bounce_rate || 0,
            Tags: ''
          });
        }
        for (const flow of selectedFlows) {
          const flowName = flow?.attributes?.name || flow.id;
          const messageIds = messagesByFlow.get(flow.id) || [];
          for (const msgId of messageIds) {
            const meta = messageMetaById.get(msgId);
            if (!meta || (meta.channel || '').toLowerCase() !== 'email') continue;
            const key = `${day}|${flow.id}|${msgId}`;
            if (seenKeys.has(key)) continue;
            perDayRows.push({
              Day: day,
              'Flow ID': flow.id,
              'Flow Name': flowName,
              'Flow Message ID': msgId,
              'Flow Message Name': meta.name || msgId,
              'Flow Message Channel': 'Email',
              Status: 'live',
              Delivered: 0,
              'Unique Opens': 0,
              'Open Rate': 0,
              'Unique Clicks': 0,
              'Click Rate': 0,
              'Placed Order': 0,
              'Placed Order Rate': 0,
              Revenue: 0,
              'Revenue per Recipient': 0,
              'Unsub Rate': 0,
              'Complaint Rate': 0,
              'Bounce Rate': 0,
              Tags: ''
            });
          }
        }
        rows.push(...perDayRows);
        if (diagnostics) diagnostics.details.push({ day, groupedResults: results.length, mode: 'per-day' });
        if (days.length > 1 && day !== days[days.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

    }

    async function populateRange() {
      const rangeStart = dayStartISO(days[0]);
      const rangeEnd = dayEndISO(days[days.length - 1]);
      const results = await getFlowReportData({ start: timeframeKey ? undefined : rangeStart, end: timeframeKey ? undefined : rangeEnd, key: timeframeKey }, info => { if (diagnostics) diagnostics.details.push({ rangeStart, rangeEnd, debug: info }); }, `range:${rangeStart}->${rangeEnd}`);
      for (const r of results) {
        if (!selectedFlowIds.has(String(r.flow_id || ''))) continue;
        if (!r.flow_id || (!r.flow_message_id && !r.flow_action_id)) continue;
        const flow = selectedFlowMap.get(String(r.flow_id));
        const flowName = flow?.attributes?.name || r.flow_id;
        const actionMeta = r.flow_action_id ? messageMetaByActionId.get(String(r.flow_action_id)) : undefined;
        const messageId = actionMeta?.messageId || (r.flow_message_id ? String(r.flow_message_id) : undefined);
        const messageMeta = messageId ? messageMetaById.get(messageId) : undefined;
        const resolvedMessageId = messageId || r.flow_message_id || r.flow_action_id;
        const resolvedName = actionMeta?.name || messageMeta?.name || resolvedMessageId;
        const resolvedChannel = actionMeta?.channel || messageMeta?.channel || r.send_channel || 'Email';
        if ((resolvedChannel || '').toLowerCase() !== 'email') continue;
        rows.push({
          Day: days[days.length - 1],
          'Flow ID': r.flow_id,
          'Flow Name': flowName,
          'Flow Message ID': resolvedMessageId,
          'Flow Message Name': resolvedName,
          'Flow Message Channel': resolvedChannel,
          Status: 'live-range',
          Delivered: r.delivered || 0,
          'Unique Opens': r.opens_unique || 0,
          'Open Rate': r.open_rate || 0,
          'Unique Clicks': r.clicks_unique || 0,
          'Click Rate': r.click_rate || 0,
          'Placed Order': r.conversion_uniques || 0,
          'Placed Order Rate': r.conversion_rate || 0,
          Revenue: (r as any).conversion_value ?? r.revenue ?? 0,
          'Revenue per Recipient': r.revenue_per_recipient || 0,
          'Unsub Rate': r.unsubscribe_rate || 0,
          'Complaint Rate': r.spam_complaint_rate || 0,
          'Bounce Rate': r.bounce_rate || 0,
          Tags: `range:${rangeStart}->${rangeEnd}`
        });
      }
      if (diagnostics) diagnostics.details.push({ rangeStart, rangeEnd, groupedResults: results.length, mode: 'range' });
    }

    if (aggregationMode === 'per-day') {
      await populatePerDay();
    } else if (aggregationMode === 'range') {
      await populateRange();
    } else { // auto
      await populatePerDay();
      if (rows.length === 0) {
        if (diagnostics) diagnostics.autoRangeTriggered = true;
        await populateRange();
      }
    }

    for (const row of rows) {
      const meta = messageMetaById.get(String(row['Flow Message ID']));
      if (meta?.name) row['Flow Message Name'] = meta.name;
      if (meta?.channel) row['Flow Message Channel'] = meta.channel;
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({
        error: 'FlowReportUnavailable',
        details: 'Klaviyo flow-report returned no data and events fallback is disabled to preserve data integrity.',
        hint: 'Verify flow analytics access for this account or export the CSV directly from Klaviyo.',
      }), { status: 502 });
    }

    // Optionally include draft flows with zero metrics (synthetic, off by default)
    if (body.includeDrafts) {
      const draftFlows = selectedFlows.filter(f => String(f?.attributes?.status || '').toLowerCase() === 'draft');
      const dayLabels = timeframeKey ? [days[days.length - 1]] : days;
      for (const d of dayLabels) {
        for (const f of draftFlows) {
          rows.push({
            Day: d,
            'Flow ID': f.id,
            'Flow Name': f?.attributes?.name || f.id,
            'Flow Message ID': 'N/A',
            'Flow Message Name': 'Draft - No Data',
            'Flow Message Channel': 'Email',
            Status: 'draft',
            Delivered: 0,
            'Unique Opens': 0,
            'Open Rate': 0,
            'Unique Clicks': 0,
            'Click Rate': 0,
            'Placed Order': 0,
            'Placed Order Rate': 0,
            Revenue: 0,
            'Revenue per Recipient': 0,
            'Unsub Rate': 0,
            'Complaint Rate': 0,
            'Bounce Rate': 0,
            Tags: ''
          });
        }
      }
    }

    // Debug probe: if no rows came back from flow-report, try analytics endpoint to verify data presence
    if (diagnostics && rows.length === 0 && selectedFlows.length > 0) {
      try {
        const probeFlow = selectedFlows[0];
        const probe = await fetchFlowAnalytics(apiKey as string, {
          pageSize: 10,
          maxPages: 1,
          startDate: rangeStartDate.toISOString(),
          endDate: rangeEndDate.toISOString(),
          flowId: probeFlow.id,
        });
        (diagnostics as any).analyticsProbe = { flowId: probeFlow.id, flowName: probeFlow?.attributes?.name, count: probe.length, sample: probe.slice(0, 2) };
      } catch (e: any) {
        (diagnostics as any).analyticsProbe = { error: String(e?.message || e) };
      }
    }

    if (diagnostics) {
      const revision = revisionOverride || process.env.KLAVIYO_API_REVISION || '2024-06-15';
      // Klaviyo documentation: Private keys have the prefix 'pk_'
      const apiKeyType = typeof apiKey === 'string' && apiKey.startsWith('pk_') ? 'private' : 'unknown';
      diagnostics.summary = { 
        totalRows: rows.length, 
        detailEntries: diagnostics.details.length,
        timeframe: timeframeKey ? { key: timeframeKey } : { start: rangeStartDate.toISOString(), end: rangeEndDate.toISOString(), days: totalDays },
        statistics: broadStats || 'default',
        valueStatistics: broadValueStats || 'default',
        conversionMetricId: conversionMetricId || null,
        revision,
        groupBy: effectiveGroupBy || ['flow_id','flow_action_id','send_channel'],
        flowReportHttpMethod: 'POST',
        apiKeyType,
        timeZone: accountTimeZone
      };
    }

    // Row budget enforcement
    const maxRows = 50000;
    if (rows.length > maxRows) {
      return new Response(JSON.stringify({ error: 'Row budget exceeded', rows: rows.length, max: maxRows }), { status: 400 });
    }

    const headers = ['Day','Flow ID','Flow Name','Flow Message ID','Flow Message Name','Flow Message Channel','Status','Delivered','Unique Opens','Open Rate','Unique Clicks','Click Rate','Placed Order','Placed Order Rate','Revenue','Revenue per Recipient','Unsub Rate','Complaint Rate','Bounce Rate','Tags'];
    const csv = toCsv(rows, headers);

    if (mode === 'live') {
      const accountId = body.accountId!;
      const uploadId = body.uploadId || new Date().toISOString().replace(/[:.]/g, '-');
      const objectPath = `flow-staging/${accountId}/${uploadId}/flows.csv`;
      const supabase = createServiceClient();
      const { error: upErr } = await supabase.storage
        .from(FLOW_STAGING_BUCKET!)
        .upload(objectPath, new Blob([csv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });
      if (upErr) {
        return new Response(JSON.stringify({ error: 'Failed to write CSV', details: upErr.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ mode, wrote: { bucket: FLOW_STAGING_BUCKET, path: objectPath }, rows: rows.length, fallback: false, aggregation: aggregationMode, diagnostics, ms: Date.now() - t0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (format === 'csv') {
      return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }

  return new Response(JSON.stringify({ mode: 'dry-run', rows: rows.length, days: totalDays, flows: selectedFlows.length, aggregation: aggregationMode, fallback: false, sample: rows.slice(0, 3), csvPreview: csv.split('\n').slice(0, 4), diagnostics, ms: Date.now() - t0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

function baseRow(p: { day: string; flow: any; flowName: string; msg: { id: string; name: string }; delivered: number; uniqueOpens: number; uniqueClicks: number; placedOrders: number; revenue: number; unsubRate: number; complaintRate: number; bounceRate: number; }) {
  const { day, flow, flowName, msg, delivered, uniqueOpens, uniqueClicks, placedOrders, revenue, unsubRate, complaintRate, bounceRate } = p;
  return {
    Day: day,
    'Flow ID': flow.id,
    'Flow Name': flowName,
    'Flow Message ID': msg.id,
    'Flow Message Name': msg.name,
    'Flow Message Channel': 'Email',
    Status: 'live',
    Delivered: delivered,
    'Unique Opens': uniqueOpens,
    'Open Rate': delivered ? uniqueOpens / delivered : 0,
    'Unique Clicks': uniqueClicks,
    'Click Rate': delivered ? uniqueClicks / delivered : 0,
    'Placed Order': placedOrders,
    'Placed Order Rate': delivered ? placedOrders / delivered : 0,
    Revenue: revenue,
    'Revenue per Recipient': delivered ? revenue / delivered : 0,
    'Unsub Rate': unsubRate,
    'Complaint Rate': complaintRate,
    'Bounce Rate': bounceRate,
    Tags: ''
  };
}

function toCsv(rows: any[], headers: string[]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(',')].concat(rows.map(r => headers.map(h => escape(r[h])).join(','))).join('\n');
}

function hashString(str: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pseudo(seed: number): () => number { let s = seed >>> 0; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
