import { readFileSync } from 'fs';
import { resolve } from 'path';
import dayjs from '../lib/dayjs';
import { fetchCampaigns, fetchCampaignValues, fetchMetricIds, fetchCampaignMessages, fetchCampaignTags, fetchListDetails, fetchAccountTimezone } from '../lib/klaviyo/client';

function loadEnvFile(path: string) {
  try {
    const content = readFileSync(resolve(path), 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.warn('Could not load env file', path, err);
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  loadEnvFile('.env.local');
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) {
    console.error('KLAVIYO_API_KEY not set');
    process.exit(1);
  }
  const timezone = (await fetchAccountTimezone(apiKey)) || 'UTC';
  const campaigns = await fetchCampaigns(apiKey, { channel: 'email', pageSize: 50, maxPages: 5 });
  const limited = campaigns.slice(0, 20);
  const metricIds = await fetchMetricIds(apiKey, ['Placed Order']);
  const conversionMetricId = metricIds['Placed Order'];
  const listCache = new Map<string, string>();
  const rows: any[] = [];
  for (const campaign of limited) {
    const id = campaign.id;
    const attributes = campaign?.attributes || {};
    const name = attributes.name || id;
    const sendTimeRaw = attributes.send_time || attributes.scheduled_at;
    const sendTime = sendTimeRaw ? dayjs(sendTimeRaw).tz(timezone) : null;
    const sendWeekday = sendTime ? sendTime.format('dddd') : '';
    const tags = await fetchCampaignTags(apiKey, id).catch(() => [] as string[]);
    const messages = await fetchCampaignMessages(apiKey, id).catch(() => [] as any[]);
    const emailMessage = messages.find(m => (m?.attributes?.channel || m?.attributes?.definition?.channel || '').toLowerCase() === 'email') || messages[0];
    const subject = emailMessage?.attributes?.definition?.content?.subject || '';
    const listNames: string[] = [];
    const audienceRefs = (campaign?.relationships?.audiences?.data || []).filter((item: any) => item?.type === 'list');
    for (const ref of audienceRefs) {
      const listId = ref?.id;
      if (!listId) continue;
      if (!listCache.has(listId)) {
        try {
          const details = await fetchListDetails(apiKey, listId);
          listCache.set(listId, details.name || listId);
        } catch {
          listCache.set(listId, listId);
        }
      }
      listNames.push(listCache.get(listId)!);
    }
    const metrics = await fetchCampaignValues({ apiKey, campaignIds: [id], conversionMetricId, timeframeKey: 'last_30_days' });
    const stats = metrics[0]?.statistics || {};
    rows.push({
      campaign_name: name,
      tags: tags.join('|'),
      subject,
      list: listNames.join('|'),
      send_time: sendTime ? sendTime.format('YYYY-MM-DDTHH:mm:ssZ') : '',
      send_weekday: sendWeekday,
      total_recipients: stats.recipients ?? 0,
      unique_placed_order: stats.conversion_uniques ?? 0,
      placed_order_rate: stats.conversion_rate ?? 0,
      revenue: stats.conversion_value ?? 0,
      unique_opens: stats.opens_unique ?? 0,
      open_rate: stats.open_rate ?? 0,
      total_opens: stats.opens_unique ?? 0,
      unique_clicks: stats.clicks_unique ?? 0,
      click_rate: stats.click_rate ?? 0,
      total_clicks: stats.clicks_unique ?? 0,
      unsubscribes: stats.unsubscribes ?? 0,
      spam_complaints: stats.spam_complaints ?? 0,
      spam_complaints_rate: stats.spam_complaint_rate ?? 0,
      successful_deliveries: stats.delivered ?? 0,
      bounce_rate: stats.bounce_rate ?? 0,
      campaign_id: id,
      campaign_channel: 'Email',
    });
    await sleep(1500);
  }
  console.log('Fetched rows:', rows.length);
  console.table(rows.slice(0, 5));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
