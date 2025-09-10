// LLM-friendly JSON export builder that mirrors dashboard processed metrics
// No raw CSVs; uses DataManager processed data and analytics helpers.

import { DataManager } from "../data/dataManager";
import type { AggregatedMetrics, ProcessedCampaign, ProcessedFlowEmail } from "../data/dataTypes";
import { computeCampaignGapsAndLosses } from "../analytics/campaignGapsLosses";

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
    steps: Array<{ sequencePosition: number; emailName: string; messageId: string; metrics: AggregatedMetrics; compare: AggregatedMetrics | null }>;
  }>;
  audience: {
    insights: ReturnType<DataManager["getAudienceInsights"]>;
    growth: {
      buckets: Array<{ date: string; created: number; firstActive: number; subscribed: number }>;
      compare: Array<{ date: string; created: number; firstActive: number; subscribed: number }> | null;
    };
    inactivity: {
      // Keep concise flags/counters; omit PII lists
      deadWeightEstimate?: { monthlySavings: number | null; annualSavings: number | null } | null;
    };
  };
  deliverabilityRisk?: {
    weekly: Array<{ weekStartISO: string; emailsSent: number; revenue: number; bounces: number; spam: number; unsubs: number }>;
    last8?: { prev: any; curr: any; deltas: any };
    elasticity?: { revenuePer1k: number; unsubsPer1k: number; spamPer1k: number; bouncesPer1k: number; r2Revenue: number; unstable: boolean };
    classification?: string;
    score?: number;
  };
  reliability?: {
    coverageDenom?: number;
    sentWeeksAll?: number;
    insufficientWeeklyData?: boolean;
    zeroRevenueCampaignDetails?: Array<{ date: string; title: string }>;
    notes?: string;
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
  const tsFor = (subset: { c: ProcessedCampaign[]; f: ProcessedFlowEmail[] }) => {
    const rev = dm.getMetricTimeSeriesWithCompare(subset.c, subset.f, 'totalRevenue', dateRange, granularity, compareMode, customFrom, customTo);
    const eml = dm.getMetricTimeSeriesWithCompare(subset.c, subset.f, 'emailsSent', dateRange, granularity, compareMode, customFrom, customTo);
    return { rev, eml };
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
      return { sequencePosition: pos, emailName: seq.emailNames[idx] || `Email ${pos}`, messageId: mid, metrics, compare };
    });
    return { flowId: seq.flowId, flowName: name, status, sequence: seq, steps };
  });

  // Audience insights (processed) and growth series (mirror AudienceGrowth buckets)
  const insights = dm.getAudienceInsights();
  const subs = dm.getSubscribers();
  const activeSubs = subs.filter(s => (s.emailConsent || s.canReceiveEmail !== false));
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
    const change = (a:number,b:number) => (a===0 && b===0) ? 0 : (b - a) / (a || 1e-9);
    const deltas = { emails: change(prev.emailsSent, curr.emailsSent), revenue: change(prev.revenue, curr.revenue), rpe: change(prev.revenuePerEmail, curr.revenuePerEmail), unsubRate: change(prev.unsubRate, curr.unsubRate), spamRate: change(prev.spamRate, curr.spamRate), bounceRate: change(prev.bounceRate, curr.bounceRate) };

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

  const json: LlmExportJson = {
    meta: {
      version: "1.0.0",
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
      revenue: merge(campSeries.rev, flowSeries.rev),
      emailsSent: merge(campSeries.eml, flowSeries.eml),
    },
    campaigns: campaignsList,
    flows: flowsBlocks,
    audience: {
      insights,
      growth: { buckets: growthBuckets, compare: growthCompare },
      inactivity: { deadWeightEstimate: null },
    },
    deliverabilityRisk: {
      weekly: weeklyAgg,
      last8: last8.length >= 8 ? { prev: undefined, curr: undefined, deltas: undefined } : undefined,
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
  };

  return json;
}
