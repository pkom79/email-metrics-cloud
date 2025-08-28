import { supabaseAdmin, CSV_BUCKETS } from './supabaseAdmin';

const CANONICAL_FILES = ['campaigns.csv', 'flows.csv', 'subscribers.csv'] as const;
type CanonicalFile = typeof CANONICAL_FILES[number];

interface DownloadedSet { campaigns?: string; flows?: string; subscribers?: string; }

interface ParsedCampaign { name: string; sentAt: Date | null; recipients: number; revenue: number; uniqueOpens: number; uniqueClicks: number; totalOrders: number; unsubscribes: number; spamComplaints: number; bounces: number; }
interface ParsedFlow { name: string; sentAt: Date | null; delivered: number; revenue: number; uniqueOpens: number; uniqueClicks: number; totalOrders: number; unsubscribes: number; spamComplaints: number; bounces: number; }
interface ParsedSubscriber { email: string; consent: string; createdAt?: Date | null; }

export interface SnapshotJSON {
  meta: {
    snapshotId: string;
    generatedAt: string;
    accountId: string;
    uploadId: string;
    dateRange: { start: string; end: string };
    granularity: 'daily';
    compareRange?: { start: string; end: string } | null;
    sections: string[];
  };
  audienceOverview?: { totalSubscribers: number; subscribedCount: number; unsubscribedCount: number; percentSubscribed: number; };
  emailPerformance?: { totals: { revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribes: number; spamComplaints: number; bounces: number; }; derived: { openRate: number; clickRate: number; clickToOpenRate: number; conversionRate: number; revenuePerEmail: number; avgOrderValue: number; unsubscribeRate: number; spamRate: number; bounceRate: number; } };
  flows?: { totalFlowEmails: number; flowNames: Array<{ name: string; emails: number; revenue: number }>; };
  campaigns?: { totalCampaigns: number; topByRevenue: Array<{ name: string; revenue: number; emailsSent: number }>; };
  dow?: Array<{ dow: number; revenue: number; emailsSent: number; orders: number }>;
  hour?: Array<{ hour: number; revenue: number; emailsSent: number; orders: number }>;
}

async function downloadIfExists(accountId: string, uploadId: string, filename: CanonicalFile): Promise<{ bucket: string; text: string } | null> {
  const rel = `${accountId}/${uploadId}/${filename}`;
  for (const bucket of CSV_BUCKETS) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(rel);
    if (data && !error) {
      // Supabase returns Blob; convert directly to text
      const text = await (data as Blob).text();
      return { bucket, text };
    }
  }
  return null;
}

async function downloadAll(accountId: string, uploadId: string): Promise<DownloadedSet> {
  const result: DownloadedSet = {};
  for (const f of CANONICAL_FILES) {
    const hit = await downloadIfExists(accountId, uploadId, f);
    if (hit?.text?.trim()) (result as any)[f.replace('.csv', '')] = hit.text;
  }
  return result;
}

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = cols[i] ?? ''; });
    return rec;
  });
}

function toNumber(v: any): number { const s = String(v ?? '').replace(/[$,%]/g, '').trim(); const n = Number(s); return Number.isFinite(n) ? n : 0; }
function parseDateFlexible(raw: string): Date | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Remove common timezone / label suffixes
  s = s.replace(/\b(UTC|GMT|EST|EDT|CST|CDT|PST|PDT)\b/i, '').trim();
  // If looks like MM/DD/YYYY or MM/DD/YY
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(:\d{2})?)?$/ .test(s)) {
    const [datePart, timePart] = s.split(/\s+/);
    const [mm, dd, yyyy] = datePart.split('/');
    const year = Number(yyyy.length === 2 ? (Number(yyyy) > 70 ? '19' + yyyy : '20' + yyyy) : yyyy);
    const month = Number(mm) - 1;
    const day = Number(dd);
    let hours = 0, mins = 0, secs = 0;
    if (timePart) {
      const tParts = timePart.split(':');
      hours = Number(tParts[0] || 0);
      mins = Number(tParts[1] || 0);
      secs = Number(tParts[2] || 0);
    }
    const d = new Date(Date.UTC(year, month, day, hours, mins, secs));
    if (!isNaN(d.getTime())) return d;
  }
  // Fallback: native Date parse
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2;
  return null;
}

function extractFirstDate(record: Record<string,string>, preferred: string[]): Date | null {
  for (const key of preferred) {
    if (record[key]) { const d = parseDateFlexible(record[key]); if (d) return d; }
  }
  // Fallback: scan for any key containing 'send' or 'date' or exactly 'Day'
  for (const k of Object.keys(record)) {
    if (/day$/i.test(k) || /send|date/i.test(k)) {
      const d = parseDateFlexible(record[k]);
      if (d) return d;
    }
  }
  return null;
}

function parseCampaigns(text?: string): ParsedCampaign[] {
  if (!text) return [];
  return parseCSV(text).map(r => ({
    name: r['Campaign Name'] || r['Name'] || 'Untitled',
    sentAt: extractFirstDate(r, ['Send Time','Send Date','Sent At','Send Date (UTC)','Send Date (GMT)','Date']),
    recipients: toNumber(r['Total Recipients'] || r['Recipients']),
    revenue: toNumber(r['Revenue']),
    uniqueOpens: toNumber(r['Unique Opens']),
    uniqueClicks: toNumber(r['Unique Clicks']),
    totalOrders: toNumber(r['Total Placed Orders'] || r['Placed Orders']),
    unsubscribes: toNumber(r['Unsubscribes']),
    spamComplaints: toNumber(r['Spam Complaints']),
    bounces: toNumber(r['Bounces']),
  }));
}

function parseFlows(text?: string): ParsedFlow[] {
  if (!text) return [];
  return parseCSV(text).map(r => ({
    name: r['Flow Message Name'] || r['Flow Name'] || 'Flow Email',
    sentAt: extractFirstDate(r, ['Day','Send Time','Send Date','Send Date (UTC)']),
    delivered: toNumber(r['Delivered']),
    revenue: toNumber(r['Revenue']),
    uniqueOpens: toNumber(r['Unique Opens']),
    uniqueClicks: toNumber(r['Unique Clicks']),
    totalOrders: toNumber(r['Total Placed Orders'] || r['Placed Orders']),
    unsubscribes: toNumber(r['Unsubscribes']),
    spamComplaints: toNumber(r['Spam Complaints']),
    bounces: toNumber(r['Bounces']),
  }));
}
function parseSubscribers(text?: string): ParsedSubscriber[] { if (!text) return []; return parseCSV(text).map(r => ({ email: r['Email'] || r['email'] || '', consent: r['Email Marketing Consent'] || r['Consent'] || '', createdAt: parseDateFlexible(r['Created At'] || r['Signup Date']), })).filter(r => r.email); }

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function aggregate(snapshotId: string, accountId: string, uploadId: string, campaigns: ParsedCampaign[], flows: ParsedFlow[], subscribers: ParsedSubscriber[]): SnapshotJSON {
  const allEmails = [
    ...campaigns.map(c => ({ category: 'campaign' as const, sentAt: c.sentAt, revenue: c.revenue, emailsSent: c.recipients, uniqueOpens: c.uniqueOpens, uniqueClicks: c.uniqueClicks, totalOrders: c.totalOrders, unsubscribes: c.unsubscribes, spam: c.spamComplaints, bounces: c.bounces, name: c.name })),
    ...flows.map(f => ({ category: 'flow' as const, sentAt: f.sentAt, revenue: f.revenue, emailsSent: f.delivered, uniqueOpens: f.uniqueOpens, uniqueClicks: f.uniqueClicks, totalOrders: f.totalOrders, unsubscribes: f.unsubscribes, spam: f.spamComplaints, bounces: f.bounces, name: f.name })),
  ].filter(e => e.sentAt && !isNaN(e.sentAt.getTime()));

  let minDate = new Date(); let maxDate = new Date(0);
  for (const e of allEmails) { if (e.sentAt! < minDate) minDate = e.sentAt!; if (e.sentAt! > maxDate) maxDate = e.sentAt!; }
  if (!allEmails.length) { const now = new Date(); minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); maxDate = minDate; }

  const totals = allEmails.reduce((acc, e) => { acc.revenue += e.revenue; acc.emailsSent += e.emailsSent; acc.totalOrders += e.totalOrders; acc.uniqueOpens += e.uniqueOpens; acc.uniqueClicks += e.uniqueClicks; acc.unsubscribes += e.unsubscribes; acc.spamComplaints += e.spam; acc.bounces += e.bounces; return acc; }, { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribes: 0, spamComplaints: 0, bounces: 0 });

  const derived = { openRate: totals.emailsSent ? (totals.uniqueOpens / totals.emailsSent) * 100 : 0, clickRate: totals.emailsSent ? (totals.uniqueClicks / totals.emailsSent) * 100 : 0, clickToOpenRate: totals.uniqueOpens ? (totals.uniqueClicks / totals.uniqueOpens) * 100 : 0, conversionRate: totals.uniqueClicks ? (totals.totalOrders / totals.uniqueClicks) * 100 : 0, revenuePerEmail: totals.emailsSent ? totals.revenue / totals.emailsSent : 0, avgOrderValue: totals.totalOrders ? totals.revenue / totals.totalOrders : 0, unsubscribeRate: totals.emailsSent ? (totals.unsubscribes / totals.emailsSent) * 100 : 0, spamRate: totals.emailsSent ? (totals.spamComplaints / totals.emailsSent) * 100 : 0, bounceRate: totals.emailsSent ? (totals.bounces / totals.emailsSent) * 100 : 0 };

  const subscribed = subscribers.filter(s => /subscribed/i.test(s.consent)).length;
  const audienceOverview = subscribers.length ? { totalSubscribers: subscribers.length, subscribedCount: subscribed, unsubscribedCount: subscribers.length - subscribed, percentSubscribed: subscribers.length ? (subscribed / subscribers.length) * 100 : 0 } : undefined;

  const flowsByName = new Map<string, { emails: number; revenue: number }>();
  for (const f of flows) { const rec = flowsByName.get(f.name) || { emails: 0, revenue: 0 }; rec.emails += f.delivered; rec.revenue += f.revenue; flowsByName.set(f.name, rec); }
  const topCampaigns = campaigns.map(c => ({ name: c.name, revenue: c.revenue, emailsSent: c.recipients })).sort((a, b) => b.revenue - a.revenue).slice(0, 25);

  const dowMap = new Array(7).fill(0).map((_, i) => ({ dow: i, revenue: 0, emailsSent: 0, orders: 0 }));
  for (const e of allEmails) { const d = e.sentAt!.getDay(); const row = dowMap[d]; row.revenue += e.revenue; row.emailsSent += e.emailsSent; row.orders += e.totalOrders; }
  const hourMap = new Array(24).fill(0).map((_, i) => ({ hour: i, revenue: 0, emailsSent: 0, orders: 0 }));
  for (const e of allEmails) { const h = e.sentAt!.getHours(); const row = hourMap[h]; row.revenue += e.revenue; row.emailsSent += e.emailsSent; row.orders += e.totalOrders; }

  const sections: string[] = [];
  if (audienceOverview) sections.push('audienceOverview');
  if (allEmails.length) sections.push('emailPerformance');
  if (flows.length) sections.push('flows');
  if (campaigns.length) sections.push('campaigns');
  if (allEmails.length) sections.push('dow', 'hour');

  return { meta: { snapshotId, generatedAt: new Date().toISOString(), accountId, uploadId, dateRange: { start: isoDate(minDate), end: isoDate(maxDate) }, granularity: 'daily', compareRange: null, sections }, audienceOverview, emailPerformance: allEmails.length ? { totals, derived } : undefined, flows: flows.length ? { totalFlowEmails: flows.length, flowNames: [...flowsByName.entries()].map(([name, v]) => ({ name, emails: v.emails, revenue: v.revenue })).sort((a, b) => b.revenue - a.revenue) } : undefined, campaigns: campaigns.length ? { totalCampaigns: campaigns.length, topByRevenue: topCampaigns } : undefined, dow: allEmails.length ? dowMap : undefined, hour: allEmails.length ? hourMap : undefined };
}

export async function buildSnapshotJSON(opts: { snapshotId: string; accountId: string; uploadId: string; }): Promise<SnapshotJSON> {
  const raw = await downloadAll(opts.accountId, opts.uploadId);
  const campaigns = parseCampaigns(raw.campaigns);
  const flows = parseFlows(raw.flows);
  const subscribers = parseSubscribers(raw.subscribers);
  return aggregate(opts.snapshotId, opts.accountId, opts.uploadId, campaigns, flows, subscribers);
}