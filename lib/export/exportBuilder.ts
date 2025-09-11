// LLM-friendly JSON export builder that mirrors dashboard processed metrics
// No raw CSVs; uses DataManager processed data and analytics helpers.

import { DataManager } from "../data/dataManager";
import type { AggregatedMetrics, ProcessedCampaign, ProcessedFlowEmail } from "../data/dataTypes";
import { computeCampaignGapsAndLosses } from "../analytics/campaignGapsLosses";
import { computeAudienceSizeBuckets } from "../analytics/audienceSizePerformance";
import { computeSubjectAnalysis, type SubjectMetricKey } from "../analytics/subjectAnalysis";
import { computeDeadWeightSavings } from "../analytics/deadWeightSavings";
import { computeCampaignSendFrequency } from "../analytics/campaignSendFrequency";

// Minimal shape exported; kept in its own module so UI can call it safely client-side.
export interface LlmExportJson {
  meta: {
    version: string;
    generatedAt: string; // ISO
    currency: string;
    accountTimezone: string | null; // currently unknown; follows UI/reporting timezone
    weekStart: "Monday";
    appVersion?: string;
  };
  selection: {
    dateRange: string;
    granularity: "daily" | "weekly" | "monthly";
    compareMode: "prev-period" | "prev-year";
    fromISO: string;
    toISO: string;
  };
  aggregates: {
    overall: AggregatedMetrics;
    campaignsOnly: AggregatedMetrics;
    flowsOnly: AggregatedMetrics;
  };
  timeSeries: {
  revenue: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  emailsSent: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  // Expand to cover ALL dashboard metrics
  avgOrderValue: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  revenuePerEmail: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  openRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  clickRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  clickToOpenRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  totalOrders: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  conversionRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  unsubscribeRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  spamRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  bounceRate: { primary: Array<{ date: string; campaigns: number; flows: number; total: number }>; compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null };
  };
  campaigns: Array<{
    id: number;
    name: string;
    subject: string;
    sentDate: string; // ISO
    emailsSent: number;
    revenue: number;
    totalOrders: number;
    uniqueOpens: number;
    uniqueClicks: number;
    unsubscribesCount: number;
    spamComplaintsCount: number;
    bouncesCount: number;
    openRate: number; clickRate: number; clickToOpenRate: number; conversionRate: number; revenuePerEmail: number; unsubscribeRate: number; spamRate: number; bounceRate: number; avgOrderValue: number;
  }>;
  flows: Array<{
    flowId: string;
    flowName: string;
    status: string | undefined; // majority status across steps
    sequence: { messageIds: string[]; emailNames: string[]; sequenceLength: number };
    steps: Array<{
      sequencePosition: number;
      emailName: string;
      messageId: string;
      metrics: AggregatedMetrics;
      compare: AggregatedMetrics | null;
      // time series per metric for this step
      series: Record<string, { primary: Array<{ date: string; value: number }>; compare: Array<{ date: string; value: number }> | null }>;
    }>;
  }>;
  audience: {
    insights: ReturnType<DataManager["getAudienceInsights"]>;
    growth: {
      buckets: Array<{ date: string; created: number; firstActive: number; subscribed: number }>;
      compare: Array<{ date: string; created: number; firstActive: number; subscribed: number }> | null;
    };
    inactivity: {
      // Keep concise flags/counters; omit PII lists
      deadWeightEstimate?: {
        currentSubscribers: number;
        deadWeightCount: number;
        projectedSubscribers: number;
        currentMonthlyPrice: number | null;
        projectedMonthlyPrice: number | null;
        monthlySavings: number | null;
        annualSavings: number | null;
      } | null;
      inactivityRevenueDrain?: {
        buckets: Array<{ key: '30+' | '60+' | '90+' | '120+'; count: number; totalClv: number; predictedClv: number }>;
        currency: string;
      } | null;
    };
  };
  audienceSizePerformance?: {
    buckets: Array<{
      key: string;
      rangeLabel: string;
      rangeMin: number;
      rangeMax: number;
      campaignCount: number;
      sumRevenue: number;
      sumEmails: number;
      sumOrders: number;
      sumOpens: number;
      sumClicks: number;
      sumUnsubs: number;
      sumSpam: number;
      sumBounces: number;
      avgCampaignRevenue: number;
      avgCampaignEmails: number;
      aov: number;
      revenuePerEmail: number;
      openRate: number;
      clickRate: number;
      clickToOpenRate: number;
      conversionRate: number;
      unsubscribeRate: number;
      spamRate: number;
      bounceRate: number;
    }>;
    limited: boolean;
  };
  subjectLineAnalysis?: {
    metrics: Record<SubjectMetricKey, import("../analytics/subjectAnalysis").SubjectAnalysisResult>;
    compare?: Record<SubjectMetricKey, import("../analytics/subjectAnalysis").SubjectAnalysisResult> | null;
  };
  deliverabilityRisk?: {
    weekly: Array<{ weekStartISO: string; emailsSent: number; revenue: number; bounces: number; spam: number; unsubs: number }>;
    last8?: { prev: { emailsSent: number; revenue: number; revenuePerEmail: number; unsubRate: number; spamRate: number; bounceRate: number };
             curr: { emailsSent: number; revenue: number; revenuePerEmail: number; unsubRate: number; spamRate: number; bounceRate: number };
             deltas: { emails: number; revenue: number; rpe: number; unsubRate: number; spamRate: number; bounceRate: number } };
    elasticity?: { revenuePer1k: number; unsubsPer1k: number; spamPer1k: number; bouncesPer1k: number; r2Revenue: number; unstable: boolean };
    classification?: string;
    score?: number;
  };
  // Additional dashboard blocks
  dayOfWeekPerformance?: {
  metrics: Record<'revenue' | 'avgOrderValue' | 'revenuePerEmail' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'emailsSent' | 'totalOrders' | 'conversionRate' | 'unsubscribeRate' | 'spamRate' | 'bounceRate', Array<{ day: string; dayIndex: number; value: number; campaignCount: number }>>
  };
  hourOfDayPerformance?: {
  metrics: Record<'revenue' | 'avgOrderValue' | 'revenuePerEmail' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'emailsSent' | 'totalOrders' | 'conversionRate' | 'unsubscribeRate' | 'spamRate' | 'bounceRate', Array<{ hour: number; hourLabel: string; value: number; campaignCount: number; percentageOfTotal: number }>>
  };
  campaignSendFrequency?: {
    buckets: import('../analytics/campaignSendFrequency').FrequencyBucketAggregate[];
  };
  // Send Volume Impact module parity: buckets + correlations + headline averages
  sendVolumeImpact?: {
    buckets: Array<{
      date: string; // label used in chart
      emails: number;
      revenue: number;
      revenuePerEmail: number | null;
      unsubsPer1k: number | null;
      spamPer1k: number | null;
      bouncesPer1k: number | null;
    }>;
    correlation: {
      totalRevenue: { r: number | null; n: number };
      revenuePerEmail: { r: number | null; n: number };
      unsubsPer1k: { r: number | null; n: number };
      spamPer1k: { r: number | null; n: number };
      bouncesPer1k: { r: number | null; n: number };
    };
    averages: { avgEmails: number; revenuePer1k: number; medianUnsubPer1k: number };
  };
  reliability?: {
    coverageDenom?: number;
    sentWeeksAll?: number;
  zeroCampaignSendWeeks?: number;
  longestZeroSendGap?: number;
  zeroSendWeekStarts?: string[];
  longestGapWeekStarts?: string[];
  avgCampaignsPerWeek?: number;
  totalCampaignsInFullWeeks?: number;
    insufficientWeeklyData?: boolean;
  estimatedLostRevenue?: number;
    zeroRevenueCampaignDetails?: Array<{ date: string; title: string }>;
  suspectedCsvCoverageGap?: { weeks: number; start: string; end: string } | null;
    notes?: string;
  };
  insights?: {
    deadWeightSavings?: {
      monthly: number | null;
      annual: number | null;
      currentSubscribers?: number;
      deadWeightCount?: number;
      projectedSubscribers?: number;
      currentMonthlyPrice?: number | null;
      projectedMonthlyPrice?: number | null;
    } | null;
    lostRevenueZeroCampaigns?: { amount?: number; weeks?: number; longestGapWeeks?: number };
    sendVolumeImpact?: { emailsDeltaPct?: number; revenueDeltaPct?: number; rpeDeltaPct?: number; classification?: string; score?: number };
    subjectLineFindings?: { topLengthBins?: string[]; topKeywords?: string[] };
    audienceSizeFindings?: { bestBucketByRPE?: string | null };
  inactivityRevenueDrain?: { clv90Plus?: number; clv120Plus?: number; count90Plus?: number; count120Plus?: number };
  };
}

export async function buildLlmExportJson(params: {
  dateRange: string;
  granularity: "daily" | "weekly" | "monthly";
  compareMode: "prev-period" | "prev-year";
  customFrom?: string;
  customTo?: string;
}): Promise<LlmExportJson> {
  const dm = DataManager.getInstance();
  const { dateRange, granularity, compareMode, customFrom, customTo } = params;

  // Resolve current window
  const range = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  const last = dm.getLastEmailDate();
  // Fallback: if no range (e.g., empty dataset), default to last day
  const startDate = range?.startDate ?? new Date(last);
  const endDate = range?.endDate ?? new Date(last);

  const campaignsAll = dm.getCampaigns();
  const flowsAll = dm.getFlowEmails();

  // Filter to period
  const inRange = <T extends { sentDate: Date }>(arr: T[]) => arr.filter(e => e.sentDate >= startDate && e.sentDate <= endDate);
  const campaigns = inRange(campaignsAll);
  const flows = inRange(flowsAll);

  // Aggregates
  const overall = dm.getAggregatedMetricsForPeriod(campaignsAll, flowsAll, startDate, endDate);
  const campaignsOnly = dm.getAggregatedMetricsForPeriod(campaignsAll, [], startDate, endDate);
  const flowsOnly = dm.getAggregatedMetricsForPeriod([], flowsAll, startDate, endDate);

  // Time series per segment (campaigns-only, flows-only) then merge
  const metricsKeys = ['totalRevenue','emailsSent','avgOrderValue','revenuePerEmail','openRate','clickRate','clickToOpenRate','totalOrders','conversionRate','unsubscribeRate','spamRate','bounceRate'] as const;
  type MetricKeyTS = typeof metricsKeys[number];
  const mapMetricKey = (k: MetricKeyTS) => (k === 'totalRevenue' ? 'revenue' : k);
  const tsFor = (subset: { c: ProcessedCampaign[]; f: ProcessedFlowEmail[] }) => {
    const series: Record<MetricKeyTS, { primary: any[]; compare: any[] | null }> = {} as any;
    for (const mk of metricsKeys) {
      series[mk] = dm.getMetricTimeSeriesWithCompare(subset.c, subset.f, mk, dateRange, granularity, compareMode, customFrom, customTo);
    }
    return series;
  };
  const campSeries = tsFor({ c: campaignsAll, f: [] });
  const flowSeries = tsFor({ c: [], f: flowsAll });
  const merge = (camp: { primary: any[]; compare: any[] | null }, flow: { primary: any[]; compare: any[] | null }) => {
    const primary = (camp.primary || []).map((c, i) => {
      const f = flow.primary[i]?.value ?? 0;
      const cc = c?.value ?? 0;
      return { date: c?.date ?? flow.primary[i]?.date ?? '', campaigns: cc, flows: f, total: cc + f };
    });
    let compare: Array<{ date: string; campaigns: number; flows: number; total: number }> | null = null;
    if (camp.compare && flow.compare) {
      compare = camp.compare.map((c, i) => {
        const f = flow.compare![i]?.value ?? 0; const cc = c?.value ?? 0;
        return { date: c?.date ?? flow.compare![i]?.date ?? '', campaigns: cc, flows: f, total: cc + f };
      });
    }
    return { primary, compare };
  };

  // Campaigns and flows lists (processed, per item in range)
  const campaignsList = campaigns.map(c => ({
    id: c.id,
    name: c.campaignName,
    subject: c.subject,
    sentDate: c.sentDate.toISOString(),
  segmentsUsed: Array.isArray((c as any).segmentsUsed) ? (c as any).segmentsUsed : [],
    emailsSent: c.emailsSent,
    revenue: c.revenue,
    totalOrders: c.totalOrders,
    uniqueOpens: c.uniqueOpens,
    uniqueClicks: c.uniqueClicks,
    unsubscribesCount: c.unsubscribesCount,
    spamComplaintsCount: c.spamComplaintsCount,
    bouncesCount: c.bouncesCount,
    openRate: c.openRate, clickRate: c.clickRate, clickToOpenRate: c.clickToOpenRate, conversionRate: c.conversionRate, revenuePerEmail: c.revenuePerEmail, unsubscribeRate: c.unsubscribeRate, spamRate: c.spamRate, bounceRate: c.bounceRate, avgOrderValue: c.avgOrderValue,
  })).sort((a, b) => new Date(a.sentDate).getTime() - new Date(b.sentDate).getTime());

  // Flow sequences and steps (live steps preferred by status="live" if available)
  const flowsByName = Array.from(new Set(flowsAll.map(f => f.flowName)));
  const flowsBlocks = flowsByName.map(name => {
    const emails = flowsAll.filter(f => f.flowName === name);
    const status = (() => {
      const map = new Map<string, number>();
      for (const e of emails) { const s = (e.status || 'unknown').toLowerCase(); map.set(s, (map.get(s) || 0) + 1); }
      let best: string | undefined = undefined; let max = -1;
      for (const [k, v] of map.entries()) { if (v > max) { max = v; best = k; } }
      return best;
    })();
    const seq = dm.getFlowSequenceInfo(name);
    // For each sequence position, aggregate metrics over window
  const steps = seq.messageIds.map((mid, idx) => {
      const pos = idx + 1;
      const stepEmails = emails.filter(e => e.sequencePosition === pos);
      const metrics = dm.getAggregatedMetricsForPeriod([], stepEmails, startDate, endDate);
      // Compare window
      let compare: AggregatedMetrics | null = null;
      if (dateRange !== 'all') {
        const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
        if (resolved) {
          const { startDate: s, endDate: e } = resolved;
          let prevS = new Date(s); let prevE = new Date(e);
          if (compareMode === 'prev-year') { prevS.setFullYear(prevS.getFullYear() - 1); prevE.setFullYear(prevE.getFullYear() - 1); }
          else { prevE = new Date(s.getTime() - 1); prevS = new Date(prevE.getTime() - (e.getTime() - s.getTime())); prevS.setHours(0,0,0,0); prevE.setHours(23,59,59,999); }
          compare = dm.getAggregatedMetricsForPeriod([], stepEmails, prevS, prevE);
        }
      }
  return { sequencePosition: pos, emailName: seq.emailNames[idx] || `Email ${pos}`, messageId: mid, metrics, compare, series: {} as Record<string, { primary: Array<{ date: string; value: number }>; compare: Array<{ date: string; value: number }> | null }> };
    });
    return { flowId: seq.flowId, flowName: name, status, sequence: seq, steps };
  });

  // Audience insights (processed) and growth series (mirror AudienceGrowth buckets)
  const insights = dm.getAudienceInsights();
  const subs = dm.getSubscribers();
  const activeSubs = subs.filter(s => (s.emailConsent || s.canReceiveEmail !== false));
  // Inactivity Revenue Drain (CLV-based) — derive buckets by days since last active
  const inactivityDrain = (() => {
    if (!subs.length) return null as null | { buckets: Array<{ key: '30+' | '60+' | '90+' | '120+'; count: number; totalClv: number; predictedClv: number }>; currency: string };
    const now = dm.getLastEmailDate();
    const daysSince = (d?: Date | null) => (d instanceof Date && !isNaN(d.getTime())) ? Math.floor((now.getTime() - d.getTime()) / (1000*60*60*24)) : Infinity;
    const buckets: Record<'30+'|'60+'|'90+'|'120+', { count: number; totalClv: number; predictedClv: number }> = {
      '30+': { count: 0, totalClv: 0, predictedClv: 0 },
      '60+': { count: 0, totalClv: 0, predictedClv: 0 },
      '90+': { count: 0, totalClv: 0, predictedClv: 0 },
      '120+': { count: 0, totalClv: 0, predictedClv: 0 },
    };
    for (const s of subs) {
      const last = s.lastActive instanceof Date ? s.lastActive : (s.lastClick instanceof Date ? s.lastClick : (s.lastOpen instanceof Date ? s.lastOpen : null));
      const age = daysSince(last);
      const totalClv = (s as any).totalClv || 0;
      const predictedClv = (s as any).predictedClv || 0;
      if (age >= 120) { buckets['120+'].count++; buckets['120+'].totalClv += totalClv; buckets['120+'].predictedClv += predictedClv; }
      else if (age >= 90) { buckets['90+'].count++; buckets['90+'].totalClv += totalClv; buckets['90+'].predictedClv += predictedClv; }
      else if (age >= 60) { buckets['60+'].count++; buckets['60+'].totalClv += totalClv; buckets['60+'].predictedClv += predictedClv; }
      else if (age >= 30) { buckets['30+'].count++; buckets['30+'].totalClv += totalClv; buckets['30+'].predictedClv += predictedClv; }
    }
    return { buckets: (['30+','60+','90+','120+'] as const).map(k => ({ key: k, ...buckets[k] })), currency: 'USD' };
  })();
  const buildBuckets = (start: Date, end: Date) => {
    // Buckets align with granularity
    const buckets: Array<{ date: string; created: number; firstActive: number; subscribed: number }> = [];
    const push = (d: Date) => buckets.push({ date: new Date(d).toISOString().slice(0,10), created: 0, firstActive: 0, subscribed: 0 });
    if (granularity === 'daily') {
      const cursor = new Date(start); cursor.setHours(0,0,0,0); const endD = new Date(end); endD.setHours(0,0,0,0);
      let guard = 0; while (cursor <= endD && guard < 8000) { push(cursor); cursor.setDate(cursor.getDate()+1); guard++; }
    } else if (granularity === 'weekly') {
      const mondayOf = (d: Date) => { const n = new Date(d); const day = n.getDay(); const diff = n.getDate() - day + (day === 0 ? -6 : 1); n.setDate(diff); n.setHours(0,0,0,0); return n; };
      const startW = mondayOf(start); const endW = mondayOf(end);
      const cursor = new Date(startW); let guard = 0; while (cursor <= endW && guard < 8000) { push(cursor); cursor.setDate(cursor.getDate() + 7); guard++; }
    } else {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1); const endM = new Date(end.getFullYear(), end.getMonth(), 1);
      let guard = 0; while (cursor <= endM && guard < 8000) { push(cursor); cursor.setMonth(cursor.getMonth() + 1); guard++; }
    }
    const idxFor = (d: Date) => {
      if (granularity === 'daily') { const key = d.toISOString().slice(0,10); return buckets.findIndex(b => b.date === key); }
      if (granularity === 'weekly') { const mondayOf = (x: Date) => { const n = new Date(x); const day = n.getDay(); const diff = n.getDate() - day + (day === 0 ? -6 : 1); n.setDate(diff); n.setHours(0,0,0,0); return n; }; const key = mondayOf(d).toISOString().slice(0,10); return buckets.findIndex(b => b.date === key); }
      const key = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,7) + '-01'; return buckets.findIndex(b => b.date.startsWith(key.slice(0,7)));
    };
    for (const s of activeSubs) {
      const created = s.profileCreated; if (created >= start && created <= end) { const i = idxFor(created); if (i>=0) buckets[i].created++; }
      const first = (s.firstActiveRaw || s.firstActive); if (first && first >= start && first <= end) { const i = idxFor(first); if (i>=0) buckets[i].firstActive++; }
      // Subscribed: use consent timestamp if available, else created if consent true
      const subTs = s.emailConsentTimestamp || (s.emailConsent ? s.profileCreated : null);
      if (subTs && subTs >= start && subTs <= end) { const i = idxFor(subTs); if (i>=0) buckets[i].subscribed++; }
    }
    return buckets;
  };
  const growthBuckets = buildBuckets(startDate, endDate);
  let growthCompare: typeof growthBuckets | null = null;
  if (dateRange !== 'all') {
    let prevStart = new Date(startDate); let prevEnd = new Date(endDate);
    if (compareMode === 'prev-year') { prevStart.setFullYear(prevStart.getFullYear() - 1); prevEnd.setFullYear(prevEnd.getFullYear() - 1); }
    else { prevEnd = new Date(startDate.getTime() - 1); prevStart = new Date(prevEnd.getTime() - (endDate.getTime() - startDate.getTime())); prevStart.setHours(0,0,0,0); prevEnd.setHours(23,59,59,999); }
    growthCompare = buildBuckets(prevStart, prevEnd);
  }

  // Deliverability risk (weekly last 8 and regression-based slopes) — reuse panel logic inline to avoid heavy coupling
  const weeklyAgg = (() => {
    const source: (ProcessedCampaign | ProcessedFlowEmail)[] = [...campaignsAll, ...flowsAll].filter(e => e.sentDate >= startDate && e.sentDate <= endDate);
    const mondayOf = (d: Date) => { const n = new Date(d); n.setHours(0,0,0,0); const day = n.getDay(); const diff = n.getDate() - day + (day === 0 ? -6 : 1); n.setDate(diff); return n; };
    const map = new Map<string, { start: Date; emails: number; rev: number; b: number; s: number; u: number }>();
    for (const e of source) {
      const wk = mondayOf(e.sentDate); const key = `${wk.getFullYear()}-${String(wk.getMonth()+1).padStart(2,'0')}-${String(wk.getDate()).padStart(2,'0')}`;
      let rec = map.get(key); if (!rec) { rec = { start: wk, emails: 0, rev: 0, b: 0, s: 0, u: 0 }; map.set(key, rec); }
      rec.emails += (e as any).emailsSent || 0; rec.rev += (e as any).revenue || 0; rec.b += (e as any).bouncesCount || 0; rec.s += (e as any).spamComplaintsCount || 0; rec.u += (e as any).unsubscribesCount || 0;
    }
    return Array.from(map.values()).sort((a,b)=> a.start.getTime() - b.start.getTime()).map(w => ({ weekStartISO: w.start.toISOString().slice(0,10), emailsSent: w.emails, revenue: w.rev, bounces: w.b, spam: w.s, unsubs: w.u }));
  })();

  const last8 = weeklyAgg.slice(-8);
  let elasticity: LlmExportJson["deliverabilityRisk"] extends { elasticity: infer T } ? T : any = undefined;
  let classification: string | undefined = undefined; let score: number | undefined = undefined;
  let last8Prev: { emailsSent: number; revenue: number; revenuePerEmail: number; unsubRate: number; spamRate: number; bounceRate: number } | undefined;
  let last8Curr: { emailsSent: number; revenue: number; revenuePerEmail: number; unsubRate: number; spamRate: number; bounceRate: number } | undefined;
  let last8Deltas: { emails: number; revenue: number; rpe: number; unsubRate: number; spamRate: number; bounceRate: number } | undefined;
  if (last8.length >= 8) {
    const agg = (arr: typeof last8) => {
      const emailsSent = arr.reduce((s,w)=> s + w.emailsSent, 0);
      const revenue = arr.reduce((s,w)=> s + w.revenue, 0);
      const bounces = arr.reduce((s,w)=> s + w.bounces, 0);
      const spam = arr.reduce((s,w)=> s + w.spam, 0);
      const unsubs = arr.reduce((s,w)=> s + w.unsubs, 0);
      return { emailsSent, revenue, bounces, spam, unsubs, bounceRate: emailsSent ? bounces/emailsSent : 0, spamRate: emailsSent ? spam/emailsSent : 0, unsubRate: emailsSent ? unsubs/emailsSent : 0, revenuePerEmail: emailsSent ? revenue/emailsSent : 0 };
    };
  const prev = agg(last8.slice(0,4)); const curr = agg(last8.slice(4));
  last8Prev = prev; last8Curr = curr;
  const change = (a:number,b:number) => (a===0 && b===0) ? 0 : (b - a) / (a || 1e-9);
  last8Deltas = { emails: change(prev.emailsSent, curr.emailsSent), revenue: change(prev.revenue, curr.revenue), rpe: change(prev.revenuePerEmail, curr.revenuePerEmail), unsubRate: change(prev.unsubRate, curr.unsubRate), spamRate: change(prev.spamRate, curr.spamRate), bounceRate: change(prev.bounceRate, curr.bounceRate) };

    // Regression slopes over last up to 12 weeks
    const reg = weeklyAgg.slice(-12);
    const xs = reg.map(w => w.emailsSent);
    const slopeInfo = (ys: number[]) => {
      const n = Math.min(xs.length, ys.length);
      if (n < 4) return { slope: 0, r2: 0, unstable: true };
      const mean = (arr:number[]) => arr.reduce((s,v)=> s+v,0) / arr.length;
      const mx = mean(xs); const my = mean(ys);
      let num = 0, den = 0, ssTot = 0; for (let i=0;i<n;i++){ const dx = xs[i]-mx; const dy = ys[i]-my; num += dx*dy; den += dx*dx; ssTot += dy*dy; }
      const slope = den === 0 ? 0 : (num / den);
      const b = my - slope * mx; let ssRes = 0; for (let i=0;i<n;i++){ const pred = slope * xs[i] + b; const err = ys[i] - pred; ssRes += err*err; }
      const r2 = ssTot === 0 ? 0 : 1 - ssRes/ssTot; const coefVar = Math.sqrt(den / n) / (mx || 1);
      const unstable = coefVar < 0.05; return { slope, r2, unstable };
    };
    const revSlope = slopeInfo(reg.map(w => w.revenue));
    const unsubSlope = slopeInfo(reg.map(w => w.unsubs));
    const spamSlope = slopeInfo(reg.map(w => w.spam));
    const bounceSlope = slopeInfo(reg.map(w => w.bounces));
    const emailsSlope = slopeInfo(reg.map(w => w.emailsSent));

    elasticity = { revenuePer1k: revSlope.slope * 1000, unsubsPer1k: unsubSlope.slope * 1000, spamPer1k: spamSlope.slope * 1000, bouncesPer1k: bounceSlope.slope * 1000, r2Revenue: revSlope.r2, unstable: (revSlope.unstable || unsubSlope.unstable || emailsSlope.unstable) } as any;
    const clamp = (v:number, cap:number) => Math.abs(v) > cap ? (v>0?cap:-cap) : v;
    elasticity.revenuePer1k = clamp(elasticity.revenuePer1k, 1000);
    elasticity.unsubsPer1k = clamp(elasticity.unsubsPer1k, 50);
    elasticity.spamPer1k = clamp(elasticity.spamPer1k, 10);
    elasticity.bouncesPer1k = clamp(elasticity.bouncesPer1k, 50);

    classification = (() => {
      if (elasticity.unstable) return 'Low Signal';
      if (elasticity.revenuePer1k <= 0 && (elasticity.unsubsPer1k > 0 || elasticity.spamPer1k > 0)) return 'Harmful';
      if (elasticity.revenuePer1k > 0 && elasticity.unsubsPer1k <= 3 && elasticity.spamPer1k <= 0.2) return 'Healthy Expansion';
      if (elasticity.revenuePer1k > 0 && (elasticity.unsubsPer1k > 3 || elasticity.spamPer1k > 0.2)) return 'Mixed Efficiency';
      if (elasticity.revenuePer1k > 0) return 'Marginal Gain';
      return 'Neutral';
    })();
    const base = Math.max(0, Math.min(100, (elasticity.revenuePer1k / 1000) * 90));
    const penalty = (elasticity.unsubsPer1k * 1.5) + (elasticity.spamPer1k * 20) + (elasticity.bouncesPer1k * 0.5);
    score = Math.max(0, Math.min(100, Math.round(base - penalty)));
  }

  // Reliability diagnostics via campaignGapsLosses (weekly coverage)
  const gaps = computeCampaignGapsAndLosses({ campaigns: campaignsAll, flows: flowsAll, rangeStart: startDate, rangeEnd: endDate });

  // Audience size performance (campaigns in range only)
  const asp = computeAudienceSizeBuckets(campaigns);

  // Subject line analysis for all 4 metrics; compare window mirrors flows compare logic
  const subjectMetrics: SubjectMetricKey[] = ['openRate', 'clickToOpenRate', 'clickRate', 'revenuePerEmail'];
  const subjectPrimary: Record<SubjectMetricKey, ReturnType<typeof computeSubjectAnalysis>> = {
    openRate: computeSubjectAnalysis(campaigns, 'openRate', 'ALL_SEGMENTS'),
    clickToOpenRate: computeSubjectAnalysis(campaigns, 'clickToOpenRate', 'ALL_SEGMENTS'),
    clickRate: computeSubjectAnalysis(campaigns, 'clickRate', 'ALL_SEGMENTS'),
    revenuePerEmail: computeSubjectAnalysis(campaigns, 'revenuePerEmail', 'ALL_SEGMENTS'),
  };
  let subjectCompare: Record<SubjectMetricKey, ReturnType<typeof computeSubjectAnalysis>> | null = null;
  if (dateRange !== 'all') {
    const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
    if (resolved) {
      const { startDate: s, endDate: e } = resolved;
      let prevS = new Date(s); let prevE = new Date(e);
      if (compareMode === 'prev-year') { prevS.setFullYear(prevS.getFullYear() - 1); prevE.setFullYear(prevE.getFullYear() - 1); }
      else { prevE = new Date(s.getTime() - 1); prevS = new Date(prevE.getTime() - (e.getTime() - s.getTime())); prevS.setHours(0,0,0,0); prevE.setHours(23,59,59,999); }
      const prevCampaigns = campaignsAll.filter(c => c.sentDate >= prevS && c.sentDate <= prevE);
      subjectCompare = {
        openRate: computeSubjectAnalysis(prevCampaigns, 'openRate', 'ALL_SEGMENTS'),
        clickToOpenRate: computeSubjectAnalysis(prevCampaigns, 'clickToOpenRate', 'ALL_SEGMENTS'),
        clickRate: computeSubjectAnalysis(prevCampaigns, 'clickRate', 'ALL_SEGMENTS'),
        revenuePerEmail: computeSubjectAnalysis(prevCampaigns, 'revenuePerEmail', 'ALL_SEGMENTS'),
      };
    }
  }

  // Dead weight savings (Klaviyo pricing model) — omit PII
  const dws = computeDeadWeightSavings();

  const json: LlmExportJson = {
    meta: {
      version: "1.3.1",
      generatedAt: new Date().toISOString(),
      currency: "USD",
      accountTimezone: null, // TODO: surface from account/report settings if available
      weekStart: "Monday",
    },
    selection: {
      dateRange,
      granularity,
      compareMode,
      fromISO: startDate.toISOString(),
      toISO: endDate.toISOString(),
    },
    aggregates: { overall, campaignsOnly, flowsOnly },
    timeSeries: {
      revenue: merge(campSeries.totalRevenue, flowSeries.totalRevenue),
      emailsSent: merge(campSeries.emailsSent, flowSeries.emailsSent),
      avgOrderValue: merge(campSeries.avgOrderValue, flowSeries.avgOrderValue),
      revenuePerEmail: merge(campSeries.revenuePerEmail, flowSeries.revenuePerEmail),
      openRate: merge(campSeries.openRate, flowSeries.openRate),
      clickRate: merge(campSeries.clickRate, flowSeries.clickRate),
      clickToOpenRate: merge(campSeries.clickToOpenRate, flowSeries.clickToOpenRate),
      totalOrders: merge(campSeries.totalOrders, flowSeries.totalOrders),
      conversionRate: merge(campSeries.conversionRate, flowSeries.conversionRate),
      unsubscribeRate: merge(campSeries.unsubscribeRate, flowSeries.unsubscribeRate),
      spamRate: merge(campSeries.spamRate, flowSeries.spamRate),
      bounceRate: merge(campSeries.bounceRate, flowSeries.bounceRate),
    },
    campaigns: campaignsList,
    flows: flowsBlocks,
    audience: {
      insights,
      growth: { buckets: growthBuckets, compare: growthCompare },
      inactivity: { deadWeightEstimate: dws ? {
        currentSubscribers: dws.currentSubscribers,
        deadWeightCount: dws.deadWeightCount,
        projectedSubscribers: dws.projectedSubscribers,
        currentMonthlyPrice: dws.currentMonthlyPrice,
        projectedMonthlyPrice: dws.projectedMonthlyPrice,
        monthlySavings: dws.monthlySavings,
        annualSavings: dws.annualSavings,
      } : null, inactivityRevenueDrain: inactivityDrain },
    },
    audienceSizePerformance: { buckets: asp.buckets, limited: asp.limited },
    subjectLineAnalysis: { metrics: subjectPrimary, compare: subjectCompare },
    deliverabilityRisk: {
      weekly: weeklyAgg,
  last8: last8Prev && last8Curr && last8Deltas ? { prev: last8Prev, curr: last8Curr, deltas: last8Deltas } : undefined,
      elasticity: elasticity as any,
      classification,
      score,
    },
    reliability: {
      coverageDenom: (gaps as any).weeksInRangeFull,
      sentWeeksAll: (gaps as any).weeksWithCampaignsSent,
      insufficientWeeklyData: (gaps as any).insufficientWeeklyData,
      zeroRevenueCampaignDetails: (gaps as any).zeroRevenueCampaignDetails,
      notes: gaps.insufficientWeeklyData ? 'Less than ~66% of full weeks have campaign sends; treat weekly comparisons cautiously.' : undefined,
    },
    insights: {
      deadWeightSavings: dws ? {
        monthly: dws.monthlySavings,
        annual: dws.annualSavings,
        currentSubscribers: dws.currentSubscribers,
        deadWeightCount: dws.deadWeightCount,
        projectedSubscribers: dws.projectedSubscribers,
        currentMonthlyPrice: dws.currentMonthlyPrice,
        projectedMonthlyPrice: dws.projectedMonthlyPrice,
      } : null,
      lostRevenueZeroCampaigns: { amount: (gaps as any).estimatedLostRevenue, weeks: (gaps as any).zeroCampaignSendWeeks, longestGapWeeks: (gaps as any).longestZeroSendGap },
  sendVolumeImpact: last8Prev && last8Curr ? { emailsDeltaPct: (last8Prev.emailsSent===0&&last8Curr.emailsSent===0?0: (last8Curr.emailsSent - last8Prev.emailsSent)/(last8Prev.emailsSent||1e-9)), revenueDeltaPct: (last8Prev.revenue===0&&last8Curr.revenue===0?0: (last8Curr.revenue - last8Prev.revenue)/(last8Prev.revenue||1e-9)), rpeDeltaPct: (last8Prev.revenuePerEmail===0&&last8Curr.revenuePerEmail===0?0: (last8Curr.revenuePerEmail - last8Prev.revenuePerEmail)/(last8Prev.revenuePerEmail||1e-9)), classification, score } : undefined,
      subjectLineFindings: {
        topLengthBins: subjectPrimary.openRate.lengthBins
          .slice()
          .sort((a,b)=> b.liftVsBaseline - a.liftVsBaseline)
          .slice(0,2)
          .map(b=> b.label),
        topKeywords: subjectPrimary.openRate.keywordEmojis
          .slice()
          .sort((a,b)=> b.liftVsBaseline - a.liftVsBaseline)
          .slice(0,3)
          .map(f=> f.label),
      },
  audienceSizeFindings: { bestBucketByRPE: asp.buckets.length ? asp.buckets.slice().sort((a,b)=> (b.revenuePerEmail - a.revenuePerEmail))[0].rangeLabel : null },
  inactivityRevenueDrain: inactivityDrain ? { clv90Plus: inactivityDrain.buckets.find(b=>b.key==='90+')!.totalClv, clv120Plus: inactivityDrain.buckets.find(b=>b.key==='120+')!.totalClv, count90Plus: inactivityDrain.buckets.find(b=>b.key==='90+')!.count, count120Plus: inactivityDrain.buckets.find(b=>b.key==='120+')!.count } : undefined,
    },
  };

  // Day of Week and Hour of Day performance (for campaigns in range) — all metrics
  try {
    const metricKeys = ['revenue','avgOrderValue','revenuePerEmail','openRate','clickRate','clickToOpenRate','emailsSent','totalOrders','conversionRate','unsubscribeRate','spamRate','bounceRate'] as const;
    const dayMetrics: any = {};
    for (const mk of metricKeys) {
      dayMetrics[mk] = dm.getCampaignPerformanceByDayOfWeek(campaigns, mk);
    }
    (json as any).dayOfWeekPerformance = { metrics: dayMetrics };
  } catch {}
  try {
    const metricKeys = ['revenue','avgOrderValue','revenuePerEmail','openRate','clickRate','clickToOpenRate','emailsSent','totalOrders','conversionRate','unsubscribeRate','spamRate','bounceRate'] as const;
    const hourMetrics: any = {};
    for (const mk of metricKeys) {
      hourMetrics[mk] = dm.getCampaignPerformanceByHourOfDay(campaigns, mk);
    }
    (json as any).hourOfDayPerformance = { metrics: hourMetrics };
  } catch {}

  // Campaign Send Frequency buckets for campaigns in range
  try {
    const freq = computeCampaignSendFrequency(campaigns);
    (json as any).campaignSendFrequency = { buckets: freq };
  } catch {}

  // Enrich flows.steps with per-metric time series + compare for parity with FlowStepAnalysis sparklines
  try {
    for (const f of json.flows) {
      for (const step of f.steps) {
        const flowsForSeries = flowsAll.filter(e => e.flowName === f.flowName);
        const mkList = ['revenue','emailsSent','openRate','clickRate','clickToOpenRate','conversionRate','unsubscribeRate','bounceRate','spamRate','avgOrderValue','revenuePerEmail','totalOrders'] as const;
        const series: any = {};
        for (const mk of mkList) {
          // DataManager expects keys: totalRevenue vs revenue
          const dmKey = mk === 'revenue' ? 'totalRevenue' : mk as any;
          series[mk] = dm.getMetricTimeSeriesWithCompare([], flowsForSeries.filter(e => e.sequencePosition === step.sequencePosition), dmKey, dateRange, granularity, compareMode, customFrom, customTo);
          // Re-map to simple {date,value}
          const toPairs = (arr: any[]) => (arr || []).map(p => ({ date: p.date, value: p.value }));
          series[mk] = { primary: toPairs(series[mk].primary), compare: series[mk].compare ? toPairs(series[mk].compare) : null };
        }
        (step as any).series = series;
      }
    }
  } catch {}

  // Enrich reliability block with more details from gaps analysis
  try {
    const r = (json as any).reliability || {};
    (json as any).reliability = {
      ...r,
      zeroCampaignSendWeeks: (gaps as any).zeroCampaignSendWeeks,
      longestZeroSendGap: (gaps as any).longestZeroSendGap,
      zeroSendWeekStarts: (gaps as any).zeroSendWeekStarts,
      longestGapWeekStarts: (gaps as any).longestGapWeekStarts,
      avgCampaignsPerWeek: (gaps as any).avgCampaignsPerWeek,
      totalCampaignsInFullWeeks: (gaps as any).totalCampaignsInFullWeeks,
      estimatedLostRevenue: (gaps as any).estimatedLostRevenue,
      suspectedCsvCoverageGap: (gaps as any).suspectedCsvCoverageGap,
    };
  } catch {}

  // Send Volume Impact export block (chronological, all emails)
  try {
    // Build base series for revenue/emails and per-1k negative metrics
    const revenueSeries = dm.getMetricTimeSeries(campaigns, flows, 'revenue', dateRange, granularity, customFrom, customTo);
    const emailsSeries = dm.getMetricTimeSeries(campaigns, flows, 'emailsSent', dateRange, granularity, customFrom, customTo);
    const unsubRateSeries = dm.getMetricTimeSeries(campaigns, flows, 'unsubscribeRate', dateRange, granularity, customFrom, customTo); // percent
    const spamRateSeries = dm.getMetricTimeSeries(campaigns, flows, 'spamRate', dateRange, granularity, customFrom, customTo); // percent
    const bounceRateSeries = dm.getMetricTimeSeries(campaigns, flows, 'bounceRate', dateRange, granularity, customFrom, customTo); // percent

    let buckets = revenueSeries.map((r, i) => {
      const emails = emailsSeries[i]?.value || 0;
      // percent -> per 1k (e.g., 0.5% => 5 per 1k)
      const unsubsPer1k = (unsubRateSeries[i]?.value || 0) * 10 * (emails > 0 ? 1 : 0);
      const spamPer1k = (spamRateSeries[i]?.value || 0) * 10 * (emails > 0 ? 1 : 0);
      const bouncesPer1k = (bounceRateSeries[i]?.value || 0) * 10 * (emails > 0 ? 1 : 0);
      return {
        date: r.date,
        emails,
        revenue: r.value || 0,
        revenuePerEmail: emails > 0 ? (r.value || 0) / emails : null,
        unsubsPer1k: emails > 0 ? unsubsPer1k : null,
        spamPer1k: emails > 0 ? spamPer1k : null,
        bouncesPer1k: emails > 0 ? bouncesPer1k : null,
      };
    });
    // Trim first partial boundary for weekly/monthly if anomalously small vs median (mirror UI)
    if ((granularity === 'weekly' || granularity === 'monthly') && buckets.length > 2) {
      const internal = buckets.slice(1, -1);
      const arr = internal.map(b => b.emails).filter(n => n > 0).sort((a, b) => a - b);
      const medianEmails = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
      if (medianEmails > 0 && buckets[0].emails > 0 && buckets[0].emails < medianEmails * 0.4) buckets = buckets.slice(1);
    }

    // Correlation helper (Pearson r)
    const corr = (ys: (number | null)[]) => {
      const pairs: { x: number; y: number }[] = [];
      for (let i = 0; i < buckets.length; i++) {
        const x = buckets[i].emails;
        const y = ys[i];
        if (x > 0 && y != null && Number.isFinite(y)) pairs.push({ x, y });
      }
      const n = pairs.length;
      if (n < 3) return { r: null as number | null, n };
      const xs = pairs.map(p => p.x); const ys2 = pairs.map(p => p.y as number);
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      const mx = mean(xs); const my = mean(ys2);
      let num = 0, dxs = 0, dys = 0;
      for (let i = 0; i < n; i++) { const dx = xs[i] - mx; const dy = ys2[i] - my; num += dx * dy; dxs += dx * dx; dys += dy * dy; }
      if (dxs === 0 || dys === 0) return { r: null as number | null, n };
      return { r: num / Math.sqrt(dxs * dys), n };
    };

    const correlation = {
      totalRevenue: corr(buckets.map(b => b.revenue)),
      revenuePerEmail: corr(buckets.map(b => b.revenuePerEmail)),
      unsubsPer1k: corr(buckets.map(b => b.unsubsPer1k)),
      spamPer1k: corr(buckets.map(b => b.spamPer1k)),
      bouncesPer1k: corr(buckets.map(b => b.bouncesPer1k)),
    };

    const totals = buckets.reduce((acc, b) => { acc.rev += b.revenue; acc.em += b.emails; return acc; }, { rev: 0, em: 0 });
    const rpmE = totals.em > 0 ? (totals.rev / totals.em) * 1000 : 0;
    const unsubVals = buckets.filter(b => b.emails > 0 && b.unsubsPer1k != null).map(b => b.unsubsPer1k as number).sort((a, b) => a - b);
    const medianUnsubPer1k = unsubVals.length ? unsubVals[Math.floor(unsubVals.length / 2)] : 0;
    (json as any).sendVolumeImpact = {
      buckets,
      correlation,
      averages: { avgEmails: buckets.length ? Math.round(totals.em / buckets.length) : 0, revenuePer1k: Number(rpmE.toFixed(2)), medianUnsubPer1k: Number(medianUnsubPer1k.toFixed(2)) },
    };
  } catch {}

  return json;
}
