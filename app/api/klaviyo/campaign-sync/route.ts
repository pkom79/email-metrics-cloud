import { NextRequest } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { fetchAccountTimezone, fetchCampaigns, fetchCampaignValues, fetchMetricIds, fetchCampaignMessages, fetchCampaignTags, fetchListDetails, aggregateCampaignMetricsViaEvents } from '../../../../lib/klaviyo/client';
import dayjs from '../../../../lib/dayjs';

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;
const CAMPAIGN_STAGING_BUCKET = process.env.CAMPAIGN_STAGING_BUCKET;

export async function POST(req: NextRequest) {
  try {
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }
    const providedSecret = req.headers.get('x-admin-job-secret') || '';
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'dry-run';
    const format = (body.format || 'json').toLowerCase();
    const accountId = body.accountId || 'acc_canary_1';
    const apiKey = body.klaviyoApiKey || process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing Klaviyo API key' }), { status: 400 });
    }
    const timezone = (await fetchAccountTimezone(apiKey)) || 'UTC';
    // Resolve timeframe (default last 3 days) in account timezone
    const days = Math.max(1, Math.min(body.days ?? 3, 30));
    const endZoned = body.end ? dayjs.tz(body.end, timezone).endOf('day') : dayjs().tz(timezone).endOf('day');
    const startZoned = body.start ? dayjs.tz(body.start, timezone).startOf('day') : endZoned.startOf('day').subtract(days - 1, 'day');
    const startISO = startZoned.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
    const endISO = endZoned.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');

    // Fetch campaigns and prefer those whose send_time falls within the timeframe
    const campaigns = await fetchCampaigns(apiKey, { channel: 'email', pageSize: 50, maxPages: 3 });
    const inWindow = campaigns.filter(c => {
      const st = c?.attributes?.send_time || c?.attributes?.scheduled_at;
      if (!st) return false;
      const d = dayjs(st).tz(timezone);
      return (d.isAfter(startZoned) || d.isSame(startZoned)) && (d.isBefore(endZoned) || d.isSame(endZoned));
    });
    const limited = (inWindow.length > 0 ? inWindow : campaigns).slice(0, 20);
    const campaignIds = limited.map(c => c.id);
    let conversionMetricId = body.conversionMetricId || process.env.SHOPIFY_PLACED_ORDER_METRIC_ID;
    if (!conversionMetricId) {
      const metricIds = await fetchMetricIds(apiKey, ['Placed Order']);
      conversionMetricId = metricIds['Placed Order'];
    }
    if (!conversionMetricId) {
      return new Response(JSON.stringify({ error: 'Missing conversion metric id' }), { status: 400 });
    }
    // Prefer explicit start/end for a tight window; allow timeframeKey override when provided
    const timeframeKey = body.timeframeKey as string | undefined;
    let metrics: Array<{ campaign_id?: string; statistics: Record<string, number> }> = [];
    try {
      metrics = await fetchCampaignValues({ apiKey, campaignIds, conversionMetricId, timeframeKey, startISO: timeframeKey ? undefined : startISO, endISO: timeframeKey ? undefined : endISO });
    } catch (err: any) {
      // Fallback: aggregate via Events API per campaign for short windows when campaign-values is throttled
      const msg = String(err?.message || err || '');
      const tooLongRetry = /\[limiter\].*campaign-values.*retry-after/i.test(msg) || /status\":429/.test(msg);
      if (!tooLongRetry) {
        throw err;
      }
      const results: Array<{ campaign_id?: string; statistics: Record<string, number> }> = [];
      for (const cid of campaignIds) {
        try {
          // Optionally pass an email message id to help filter events precisely
          let emailMsgId: string | undefined;
          try {
            const msgs = await fetchCampaignMessages(apiKey, cid, { pageSize: 10 });
            const emailMsg = msgs.find((m: any) => (m?.attributes?.channel || m?.attributes?.definition?.channel || '').toLowerCase() === 'email') || msgs[0];
            emailMsgId = String(emailMsg?.id || '');
          } catch {}
          const agg = await aggregateCampaignMetricsViaEvents({ apiKey, startISO, endISO, campaignId: cid, campaignMessageId: emailMsgId });
          results.push({ campaign_id: cid, statistics: agg.statistics || {} });
          // Small delay to be polite across categories
          await new Promise(r => setTimeout(r, 250));
        } catch {}
      }
      metrics = results;
    }
    const metricsById = new Map<string, Record<string, number>>();
    for (const entry of metrics) {
      metricsById.set(entry.campaign_id || '', entry.statistics || {});
    }
    const listCache = new Map<string, string>();
    const rows: any[] = [];
    for (const campaign of limited) {
      const id = campaign.id;
      const attributes = campaign?.attributes || {};
      const campaignName = attributes.name || id;
      const sendTimeRaw = attributes.send_time || attributes.scheduled_at;
      const sendTime = sendTimeRaw ? dayjs(sendTimeRaw).tz(timezone) : null;
      const sendWeekday = sendTime ? sendTime.format('dddd') : '';
      const messages = await fetchCampaignMessages(apiKey, id, { pageSize: 10 });
      const emailMessage = messages.find(m => (m?.attributes?.channel || m?.attributes?.definition?.channel || '').toLowerCase() === 'email') || messages[0];
      const subject = emailMessage?.attributes?.definition?.content?.subject || '';
      const tags = await fetchCampaignTags(apiKey, id).catch(() => [] as string[]);
      const audienceRefs = (campaign?.relationships?.audiences?.data || []).filter((item: any) => item?.type === 'list');
      const listNames: string[] = [];
      for (const ref of audienceRefs) {
        const listId = ref?.id;
        if (!listId) continue;
        if (!listCache.has(listId)) {
          try {
            const details = await fetchListDetails(apiKey, listId);
            listCache.set(listId, details?.name || listId);
          } catch {
            listCache.set(listId, listId);
          }
        }
        listNames.push(listCache.get(listId)!);
      }
      const stats = metricsById.get(id) || {};
      rows.push({
        campaignName,
        tags: tags.join('|'),
        subject,
        list: listNames.join('|'),
        sendTime: sendTime ? sendTime.format('YYYY-MM-DDTHH:mm:ssZ') : '',
        sendWeekday,
        totalRecipients: stats.recipients ?? 0,
        uniquePlacedOrder: stats.conversion_uniques ?? 0,
        placedOrderRate: stats.conversion_rate ?? 0,
        revenue: stats.conversion_value ?? 0,
        uniqueOpens: stats.opens_unique ?? 0,
        openRate: stats.open_rate ?? 0,
        totalOpens: stats.opens_unique ?? 0,
        uniqueClicks: stats.clicks_unique ?? 0,
        clickRate: stats.click_rate ?? 0,
        totalClicks: stats.clicks_unique ?? 0,
        unsubscribes: stats.unsubscribes ?? 0,
        spamComplaints: stats.spam_complaints ?? 0,
        spamComplaintsRate: stats.spam_complaint_rate ?? 0,
        successfulDeliveries: stats.delivered ?? 0,
        bounces: 0,
        bounceRate: stats.bounce_rate ?? 0,
        campaignId: id,
        campaignChannel: 'Email',
      });
    }

    const header = ['Campaign Name','Tags','Subject','List','Send Time','Send Weekday','Total Recipients','Unique Placed Order','Placed Order Rate','Revenue','Unique Opens','Open Rate','Total Opens','Unique Clicks','Click Rate','Total Clicks','Unsubscribes','Spam Complaints','Spam Complaints Rate','Successful Deliveries','Bounces','Bounce Rate','Campaign ID','Campaign Channel'];
    const csvLines = [header.join(',')];
    for (const row of rows) {
      csvLines.push([
        row.campaignName,
        row.tags,
        row.subject,
        row.list,
        row.sendTime,
        row.sendWeekday,
        row.totalRecipients,
        row.uniquePlacedOrder,
        row.placedOrderRate,
        row.revenue,
        row.uniqueOpens,
        row.openRate,
        row.totalOpens,
        row.uniqueClicks,
        row.clickRate,
        row.totalClicks,
        row.unsubscribes,
        row.spamComplaints,
        row.spamComplaintsRate,
        row.successfulDeliveries,
        row.bounces,
        row.bounceRate,
        row.campaignId,
        row.campaignChannel,
      ].join(','));
    }
    const csvContent = csvLines.join('\n');
    if (mode === 'live') {
      if (!CAMPAIGN_STAGING_BUCKET) {
        return new Response(JSON.stringify({ error: 'CAMPAIGN_STAGING_BUCKET not configured' }), { status: 500 });
      }
      const supabase = createServiceClient();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `${accountId}/${timestamp}/campaigns.csv`;
      const buffer = Buffer.from(csvContent, 'utf-8');
      const { error } = await supabase.storage.from(CAMPAIGN_STAGING_BUCKET).upload(path, buffer, {
        contentType: 'text/csv',
        upsert: true,
      });
      if (error) {
        return new Response(JSON.stringify({ error: 'UploadFailed', details: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ mode: 'live', wrote: { bucket: CAMPAIGN_STAGING_BUCKET, path }, rows: rows.length }), { status: 200 });
    }
    if (format === 'csv') {
      return new Response(csvContent, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }
    return new Response(JSON.stringify({ mode: 'dry-run', rows: rows.length, preview: csvLines.slice(0, 4) }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
