// LLM-friendly JSON export builder with a strict minimal schema.
// Uses DataManager processed data; outputs only the requested metrics and splits.

import { DataManager } from "../data/dataManager";
import { computeCampaignSendFrequency } from "../analytics/campaignSendFrequency";
import { computeSubjectAnalysis } from "../analytics/subjectAnalysis";
import { computeCampaignGapsAndLosses } from "../analytics/campaignGapsLosses";
import type { AggregatedMetrics } from "../data/dataTypes";

export interface LlmExportJson {
  // Metadata about this export and helpful descriptions
  meta?: {
    account?: { name: string; url?: string };
    moduleDescriptions?: Record<string, string>;
    kpiDescriptions?: Record<string, string>;
    conversionRateDefinition?: string; // placed orders divided by clicks
    generatedAt?: string; // ISO timestamp
  };
  // Audience Overview snapshot at export time (only profiles that can receive emails, i.e., not suppressed)
  audienceOverview?: {
    totalActiveAudience: number;
    buyers: number;
    buyersPctOfAudience: number; // 0-100
    avgClvAll: number;
    avgClvBuyers: number;
  };
  // ISO YYYY-MM range of full months included
  period: { fromMonth: string | null; toMonth: string | null; months: number };
  // Aggregated values for the full-month window
  metrics: {
    overall: ExportMetricValues;
    campaignsOnly: ExportMetricValues;
    flowsOnly: ExportMetricValues;
  };
  // Monthly Campaign vs Flow split for revenue and emails, plus period totals
  campaignFlowSplit: {
    revenue: {
      monthly: Array<{ month: string; campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number }>;
      period: { campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number };
    };
    emailsSent: {
      monthly: Array<{ month: string; campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number }>;
      period: { campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number };
    };
  };
  // Send Volume Impact: total correlation across selected time period buckets (not per-bucket breakdown)
  sendVolumeImpact?: {
    correlationBySegment: {
      campaigns: CorrelationSet;
      flows: CorrelationSet;
    };
  };
  // Campaign Performance by Send Frequency over the selected lookback period (not trimmed to full months)
  campaignSendFrequency?: {
    buckets: Array<{
      key: '1' | '2' | '3' | '4+';
      weeksCount: number;
      totalCampaigns: number; // number of campaigns in this bucket during lookback
      perWeek: { avgWeeklyRevenue: number; avgWeeklyOrders: number; avgWeeklyEmails: number };
      perCampaign: { avgCampaignRevenue: number; avgCampaignOrders: number; avgCampaignEmails: number };
      rates: {
        avgOrderValue: number; // AOV
        conversionRate: number;
        openRate: number;
        clickRate: number;
        clickToOpenRate: number;
        revenuePerEmail: number;
        unsubscribeRate: number;
        spamRate: number;
        bounceRate: number;
      };
    }>;
  };
  // Campaign Performance by Audience Size (lookback period)
  audienceSizePerformance?: {
    lookbackWeeks: number;
    limited: boolean;
    buckets: Array<{
      rangeLabel: string;
      rangeMin: number;
      rangeMax: number;
      totalCampaigns: number;
      totalEmailsSent: number;
      avgCampaignEmails: number;
      // requested metrics
      avgCampaignRevenue: number;
      totalRevenue: number;
      avgOrderValue: number;
      revenuePerEmail: number;
      conversionRate: number;
      openRate: number;
      clickRate: number;
      clickToOpenRate: number;
      avgWeeklyEmailsSent: number;
      unsubscribeRate: number;
      spamRate: number;
      bounceRate: number;
    }>;
  };
  // Campaign Gaps & Losses (weekly-only analysis over lookback period)
  campaignGapsAndLosses?: {
    zeroCampaignSendWeeks: number;
    longestGapWithoutCampaign: number;
    pctWeeksWithCampaignSent: number;
    estimatedLostRevenue: number | null;
    zeroRevenueCampaigns: number;
    averageCampaignsPerWeek: number;
  };
  // Campaign Performance by Day of Week (lookback period)
  campaignPerformanceByDayOfWeek?: Array<{
    day: string; // Sun..Sat
    dayIndex: number; // 0..6
    campaignsCount: number;
    totalRevenue: number;
    avgOrderValue: number;
    totalOrders: number;
    conversionRate: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    revenuePerEmail: number;
    emailsSent: number;
    unsubscribeRate: number;
    spamRate: number;
    bounceRate: number;
  }>;
  // Subject Line Analysis (All Segments): provide only lifts vs account-average for the selected time period
  subjectLineAnalysis?: {
    openRate: SubjectMetricLiftSet;
    clickToOpenRate: SubjectMetricLiftSet;
    clickRate: SubjectMetricLiftSet;
    revenuePerEmail: SubjectMetricLiftSet;
  };
  // Flow Step Analysis (lookback totals + time series per selected granularity)
  flowStepAnalysis?: {
    granularity: 'daily' | 'weekly' | 'monthly';
    disclaimer: string;
    flows: Array<{
      flowName: string;
      total: FlowMetricTotals;
      series: FlowMetricSeries;
      steps: Array<{
        stepNumber: number;
        emailName?: string;
        total: FlowMetricTotals;
        series: FlowMetricSeries;
      }>;
    }>;
  };
  // Audience Growth series over selected lookback and granularity
  audienceGrowth?: {
    granularity: 'daily' | 'weekly' | 'monthly';
    series: Array<{ date: string; created: number; firstActive: number; subscribed: number }>;
    totals: { created: number; firstActive: number; subscribed: number };
  };
  // Snapshots: Purchase Frequency Distribution (count + percentage of total audience)
  purchaseFrequencyDistribution?: Array<{ label: 'Never' | '1 Order' | '2 Orders' | '3-5 Orders' | '6+ Orders'; count: number; percentage: number }>;
  // Snapshots: Audience Lifetime (count + percentage of total audience)
  audienceLifetime?: Array<{ label: '0-3 months' | '3-6 months' | '6-12 months' | '1-2 years' | '2+ years'; count: number; percentage: number }>;
  // Snapshots: High-Value Customer Segments (AOV multipliers)
  highValueCustomerSegments?: Array<{ label: '2x AOV' | '3x AOV' | '6x AOV'; multiplier: 2 | 3 | 6; customers: number; revenue: number }>;
  // Snapshots: Last Active Segments (count + percentage of total audience)
  lastActiveSegments?: Array<{ label: 'Never Active' | 'Inactive for 90+ days' | 'Inactive for 120+ days' | 'Inactive for 180+ days' | 'Inactive for 365+ days'; count: number; percentage: number }>;
}

type CorrelationValue = { r: number | null; n: number };
type CorrelationSet = {
  averageRevenue: CorrelationValue; // per-bucket revenue vs emails
  revenuePerEmail: CorrelationValue;
  unsubsPer1k: CorrelationValue;
  bouncesPer1k: CorrelationValue;
  spamPer1k: CorrelationValue;
};

export type ExportMetricValues = {
  totalRevenue: number;
  avgOrderValue: number;
  totalOrders: number;
  conversionRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  revenuePerEmail: number;
  emailsSent: number;
  unsubscribeRate: number;
  spamRate: number;
  bounceRate: number;
};

// Lifts set for one metric across requested feature groups
type SubjectMetricLiftSet = {
  lengthBins: { '0-30': number; '31-50': number; '51-70': number };
  keywordEmoji: {
    exclusive: number; sale: number; emojiPresent: number; limited: number; save: number; off: number; discount: number; percentOff: number;
  };
  // Number of campaigns where each keyword/emoji feature was present (for significance)
  keywordEmojiCounts: {
    exclusive: number; sale: number; emojiPresent: number; limited: number; save: number; off: number; discount: number; percentOff: number;
  };
  punctuationCasing: {
    brackets: number; exclamation: number; percent: number; allCaps: number; questionMark: number; number: number;
  };
  urgency: { tonight: number; now: number; hours: number; midnight: number; final: number; today: number; ends: number; ending: number };
  personalization: { youYour: number };
  priceAnchoring: { currency: number; percentDiscount: number; dollarDiscount: number };
  imperativeStart: { startsWithVerb: number };
  reuseFatigue: { averageChange: number; subjectsCount: number };
};

type FlowMetricTotals = {
  totalRevenue: number;
  avgOrderValue: number;
  totalOrders: number;
  conversionRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  revenuePerEmail: number;
  emailsSent: number;
  unsubscribeRate: number;
  spamRate: number;
  bounceRate: number;
};

type FlowMetricSeries = {
  revenue: Array<{ date: string; value: number }>;
  avgOrderValue: Array<{ date: string; value: number }>;
  totalOrders: Array<{ date: string; value: number }>;
  conversionRate: Array<{ date: string; value: number }>;
  openRate: Array<{ date: string; value: number }>;
  clickRate: Array<{ date: string; value: number }>;
  clickToOpenRate: Array<{ date: string; value: number }>;
  revenuePerEmail: Array<{ date: string; value: number }>;
  emailsSent: Array<{ date: string; value: number }>;
  unsubscribeRate: Array<{ date: string; value: number }>;
  spamRate: Array<{ date: string; value: number }>;
  bounceRate: Array<{ date: string; value: number }>;
};

export async function buildLlmExportJson(params: {
  dateRange: string;
  granularity: "daily" | "weekly" | "monthly";
  compareMode: "prev-period" | "prev-year";
  customFrom?: string;
  customTo?: string;
}): Promise<LlmExportJson> {
  const dm = DataManager.getInstance();
  const { dateRange, customFrom, customTo, granularity } = params as any;

  // Resolve window then trim to full months
  const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  const last = dm.getLastEmailDate();
  const rawStart = resolved?.startDate ?? new Date(last);
  const rawEnd = resolved?.endDate ?? new Date(last);
  const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const lastOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  let start = firstOfMonth(rawStart);
  if (rawStart.getDate() !== 1 || rawStart.getHours() !== 0) {
    // next month if not starting at first day
    start = new Date(rawStart.getFullYear(), rawStart.getMonth() + 1, 1, 0, 0, 0, 0);
  }
  let end = lastOfMonth(rawEnd);
  const isLastDay = rawEnd.getDate() === lastOfMonth(rawEnd).getDate();
  if (!isLastDay) {
    // previous month's last day
    end = new Date(rawEnd.getFullYear(), rawEnd.getMonth(), 0, 23, 59, 59, 999);
  }

  // If no full months in range
  if (start > end) {
    return {
      period: { fromMonth: null, toMonth: null, months: 0 },
      metrics: {
        overall: zeroMetrics(),
        campaignsOnly: zeroMetrics(),
        flowsOnly: zeroMetrics(),
      },
      campaignFlowSplit: {
        revenue: { monthly: [], period: { campaigns: 0, flows: 0, total: 0, campaignPct: 0, flowPct: 0 } },
        emailsSent: { monthly: [], period: { campaigns: 0, flows: 0, total: 0, campaignPct: 0, flowPct: 0 } },
      },
    };
  }

  const fromMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const toMonth = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;

  // Aggregates for full-month window
  const overallAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), dm.getFlowEmails(), start, end);
  const campAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), [], start, end);
  const flowAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), start, end);

  const pick = (a: AggregatedMetrics): ExportMetricValues => ({
    totalRevenue: a.totalRevenue,
    avgOrderValue: a.avgOrderValue,
    totalOrders: a.totalOrders,
    conversionRate: a.conversionRate,
    openRate: a.openRate,
    clickRate: a.clickRate,
    clickToOpenRate: a.clickToOpenRate,
    revenuePerEmail: a.revenuePerEmail,
    emailsSent: a.emailsSent,
    unsubscribeRate: a.unsubscribeRate,
    spamRate: a.spamRate,
    bounceRate: a.bounceRate,
  });

  // Monthly Campaign vs Flow split for revenue and emailsSent over the full-month window
  const mkSplit = (metric: 'revenue' | 'emailsSent') => {
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const fromDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2,'0')}-01`;
    const toDay = fmt(end);
    const camp = dm.getMetricTimeSeries(dm.getCampaigns(), [], metric, 'custom', 'monthly', fromDay, toDay) as Array<{ date: string; iso?: string; value: number }>;
    const flow = dm.getMetricTimeSeries([], dm.getFlowEmails(), metric, 'custom', 'monthly', fromDay, toDay) as Array<{ date: string; iso?: string; value: number }>;
    // Group strictly by YYYY-MM using the iso field returned by DataManager
    const monthly: Array<{ month: string; campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number }> = [];
    const byMonth = new Map<string, { c: number; f: number }>();
    for (const p of camp) { const m = ((p.iso || p.date) || '').slice(0,7); if (m) { const r = byMonth.get(m) || { c: 0, f: 0 }; r.c += p.value || 0; byMonth.set(m, r); } }
    for (const p of flow) { const m = ((p.iso || p.date) || '').slice(0,7); if (m) { const r = byMonth.get(m) || { c: 0, f: 0 }; r.f += p.value || 0; byMonth.set(m, r); } }
    const monthsKeys: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) { monthsKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`); cursor.setMonth(cursor.getMonth() + 1); }
    for (const m of monthsKeys) {
      const rec = byMonth.get(m) || { c: 0, f: 0 };
      const total = rec.c + rec.f;
      const campaignPct = total > 0 ? (rec.c / total) * 100 : 0;
      const flowPct = total > 0 ? (rec.f / total) * 100 : 0;
      monthly.push({ month: m, campaigns: rec.c, flows: rec.f, total, campaignPct, flowPct });
    }
    const cAgg = metric === 'revenue' ? campAgg.totalRevenue : campAgg.emailsSent;
    const fAgg = metric === 'revenue' ? flowAgg.totalRevenue : flowAgg.emailsSent;
    const tAgg = cAgg + fAgg;
    const period = { campaigns: cAgg, flows: fAgg, total: tAgg, campaignPct: tAgg ? (cAgg / tAgg) * 100 : 0, flowPct: tAgg ? (fAgg / tAgg) * 100 : 0 };
    return { monthly, period };
  };

  // Build base JSON
  const json: LlmExportJson = {
    meta: {
      account: { name: 'Trail Grid Pro', url: 'https://www.trailgridpro.com' },
      conversionRateDefinition: 'Conversion Rate (%) = placed orders divided by clicks',
      generatedAt: new Date().toISOString(),
      moduleDescriptions: {
        period: 'Full-month window used for full-period metrics and monthly splits (fromMonth–toMonth inclusive).',
        metrics: 'Full-month aggregated KPIs for the window; split into overall, campaigns-only, and flows-only.',
        audienceOverview: 'Snapshot from Audience Overview at export time: only profiles that can receive email (not suppressed). Includes Total Active Audience, Buyers, % of audience, Avg CLV (All), Avg CLV (Buyers).',
        audienceGrowth: 'Daily/Weekly/Monthly counts for Created, First Active, and Subscribed over the selected lookback period; includes period totals.',
        purchaseFrequencyDistribution: 'How many profiles have never purchased, purchased once, twice, 3–5 times, or 6+ times; includes counts and percent of audience.',
        audienceLifetime: 'How long profiles have been on your list (0–3m, 3–6m, 6–12m, 1–2y, 2+y); includes counts and percent of audience.',
        highValueCustomerSegments: 'Buyer cohorts whose lifetime value is at least 2x, 3x, or 6x the buyer AOV; includes customer counts and their cumulative revenue.',
        lastActiveSegments: 'Recency of engagement: Never Active, and inactive for 90+/120+/180+/365+ days based on Last Active; includes counts and percent of audience.',
        campaignFlowSplit: 'Monthly split of revenue and emails between Campaigns vs Flows over the full-month window, plus period totals.',
        sendVolumeImpact: 'Correlation between emails sent and performance metrics across the selected lookback buckets, by segment (Campaigns/Flows).',
        campaignSendFrequency: 'KPIs by weekly send frequency buckets (1, 2, 3, 4+) over the selected lookback period; includes campaign counts.',
        subjectLineAnalysis: 'Lifts vs account average for subject features (All Segments) over the selected lookback period; includes counts where available.',
        audienceSizePerformance: 'KPIs by audience size (emails sent) buckets over the selected lookback period; includes campaign counts and audience size totals.',
        campaignGapsAndLosses: 'Weekly-only analysis identifying zero-send weeks, longest gaps, coverage, estimated lost revenue, and zero-revenue campaigns over the lookback period.',
        campaignPerformanceByDayOfWeek: 'KPIs by weekday over the selected lookback period; includes how many campaigns were sent on each day.',
        flowStepAnalysis: 'KPIs for every step in every active flow and roll-ups per flow over the selected lookback period, including time series by selected granularity. Disclaimer: step order may be imperfect due to inconsistent flow email naming.'
      },
      kpiDescriptions: {
        zeroCampaignSendWeeks: 'Number of complete weeks in the selected range with no campaign sends.',
        longestGapWithoutCampaign: 'The longest consecutive run of weeks with zero campaign sends.',
        pctWeeksWithCampaignSent: 'Percentage of full weeks within the range that had at least one campaign sent.',
        estimatedLostRevenue: 'Conservative estimate of revenue missed during short gaps (1–4 weeks) using nearby typical weeks with outliers capped.',
        zeroRevenueCampaigns: 'Count of campaigns in the period with $0 revenue.',
        averageCampaignsPerWeek: 'Total campaigns divided by the number of full weeks in range.'
      }
    },
    period: { fromMonth, toMonth, months },
    metrics: {
      overall: pick(overallAgg),
      campaignsOnly: pick(campAgg),
      flowsOnly: pick(flowAgg),
    },
    campaignFlowSplit: {
      revenue: mkSplit('revenue'),
      emailsSent: mkSplit('emailsSent'),
    },
  };

  // Audience Overview snapshot (unsuppressed profiles only)
  try {
    const subs = dm.getSubscribers() as any[];
    const active = subs.filter(s => (s?.canReceiveEmail === true));
    const totalActiveAudience = active.length;
    const buyersArr = active.filter(s => s?.isBuyer);
    const buyers = buyersArr.length;
    const buyersPctOfAudience = totalActiveAudience > 0 ? (buyers / totalActiveAudience) * 100 : 0;
    const sumClvAll = active.reduce((sum, s) => sum + (s?.totalClv || 0), 0);
    const avgClvAll = totalActiveAudience > 0 ? (sumClvAll / totalActiveAudience) : 0;
    const sumClvBuyers = buyersArr.reduce((sum, s) => sum + (s?.totalClv || 0), 0);
    const avgClvBuyers = buyers > 0 ? (sumClvBuyers / buyers) : 0;
    json.audienceOverview = { totalActiveAudience, buyers, buyersPctOfAudience, avgClvAll, avgClvBuyers };
  } catch {}

  // Purchase Frequency Distribution and Audience Lifetime (based on AudienceInsights from all subscribers)
  try {
    const ai = dm.getAudienceInsights() as any;
    const total = typeof ai?.totalSubscribers === 'number' ? ai.totalSubscribers : 0;
    if (total > 0) {
      json.purchaseFrequencyDistribution = [
        { label: 'Never', count: ai.purchaseFrequency?.never || 0, percentage: total > 0 ? (ai.purchaseFrequency?.never || 0) / total * 100 : 0 },
        { label: '1 Order', count: ai.purchaseFrequency?.oneOrder || 0, percentage: total > 0 ? (ai.purchaseFrequency?.oneOrder || 0) / total * 100 : 0 },
        { label: '2 Orders', count: ai.purchaseFrequency?.twoOrders || 0, percentage: total > 0 ? (ai.purchaseFrequency?.twoOrders || 0) / total * 100 : 0 },
        { label: '3-5 Orders', count: ai.purchaseFrequency?.threeTo5 || 0, percentage: total > 0 ? (ai.purchaseFrequency?.threeTo5 || 0) / total * 100 : 0 },
        { label: '6+ Orders', count: ai.purchaseFrequency?.sixPlus || 0, percentage: total > 0 ? (ai.purchaseFrequency?.sixPlus || 0) / total * 100 : 0 },
      ];
      json.audienceLifetime = [
        { label: '0-3 months', count: ai.lifetimeDistribution?.zeroTo3Months || 0, percentage: total > 0 ? (ai.lifetimeDistribution?.zeroTo3Months || 0) / total * 100 : 0 },
        { label: '3-6 months', count: ai.lifetimeDistribution?.threeTo6Months || 0, percentage: total > 0 ? (ai.lifetimeDistribution?.threeTo6Months || 0) / total * 100 : 0 },
        { label: '6-12 months', count: ai.lifetimeDistribution?.sixTo12Months || 0, percentage: total > 0 ? (ai.lifetimeDistribution?.sixTo12Months || 0) / total * 100 : 0 },
        { label: '1-2 years', count: ai.lifetimeDistribution?.oneToTwoYears || 0, percentage: total > 0 ? (ai.lifetimeDistribution?.oneToTwoYears || 0) / total * 100 : 0 },
        { label: '2+ years', count: ai.lifetimeDistribution?.twoYearsPlus || 0, percentage: total > 0 ? (ai.lifetimeDistribution?.twoYearsPlus || 0) / total * 100 : 0 },
      ];
    } else {
      json.purchaseFrequencyDistribution = [
        { label: 'Never', count: 0, percentage: 0 },
        { label: '1 Order', count: 0, percentage: 0 },
        { label: '2 Orders', count: 0, percentage: 0 },
        { label: '3-5 Orders', count: 0, percentage: 0 },
        { label: '6+ Orders', count: 0, percentage: 0 },
      ];
      json.audienceLifetime = [
        { label: '0-3 months', count: 0, percentage: 0 },
        { label: '3-6 months', count: 0, percentage: 0 },
        { label: '6-12 months', count: 0, percentage: 0 },
        { label: '1-2 years', count: 0, percentage: 0 },
        { label: '2+ years', count: 0, percentage: 0 },
      ];
    }
  } catch {}

  // High-Value Customer Segments (2x/3x/6x AOV of buyers)
  try {
    const subs = dm.getSubscribers() as any[];
    const ai = dm.getAudienceInsights() as any;
    const aov = Number(ai?.avgClvBuyers) || 0;
    if (aov > 0 && subs.length > 0) {
      const segments = [
        { label: '2x AOV' as const, multiplier: 2 as const, customers: 0, revenue: 0 },
        { label: '3x AOV' as const, multiplier: 3 as const, customers: 0, revenue: 0 },
        { label: '6x AOV' as const, multiplier: 6 as const, customers: 0, revenue: 0 },
      ];
      subs.forEach(s => {
        if (s?.isBuyer && (s?.totalClv || 0) > 0) {
          segments.forEach(seg => {
            if ((s.totalClv || 0) >= seg.multiplier * aov) { seg.customers++; seg.revenue += s.totalClv; }
          });
        }
      });
      json.highValueCustomerSegments = segments;
    } else {
      json.highValueCustomerSegments = [
        { label: '2x AOV', multiplier: 2, customers: 0, revenue: 0 },
        { label: '3x AOV', multiplier: 3, customers: 0, revenue: 0 },
        { label: '6x AOV', multiplier: 6, customers: 0, revenue: 0 },
      ];
    }
  } catch {}

  // Last Active Segments (Never Active; Inactive 90+/120+/180+/365+ days)
  try {
    const subs = dm.getSubscribers() as any[];
    const lastEmailDate = dm.getLastEmailDate();
    const total = subs.length;
    const neverActive = subs.filter(sub => {
      const la = sub?.lastActive;
      if (!la) return true;
      if (la instanceof Date) {
        const t = la.getTime();
        return isNaN(t) || t === 0;
      }
      return true;
    }).length;
    const counters = [
      { label: 'Never Active' as const, count: neverActive },
      { label: 'Inactive for 90+ days' as const, days: 90, count: 0 },
      { label: 'Inactive for 120+ days' as const, days: 120, count: 0 },
      { label: 'Inactive for 180+ days' as const, days: 180, count: 0 },
      { label: 'Inactive for 365+ days' as const, days: 365, count: 0 },
    ] as Array<any>;
    if (lastEmailDate) {
      subs.forEach(sub => {
        const la: Date | null = sub?.lastActive instanceof Date ? sub.lastActive : null;
        if (la) {
          const diffDays = Math.floor((lastEmailDate.getTime() - la.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 90) counters[1].count++;
          if (diffDays >= 120) counters[2].count++;
          if (diffDays >= 180) counters[3].count++;
          if (diffDays >= 365) counters[4].count++;
        }
      });
    }
    json.lastActiveSegments = counters.map(c => ({ label: c.label, count: c.count, percentage: total > 0 ? (c.count / total) * 100 : 0 }));
  } catch {}

  // Send Volume Impact: correlations across selected period buckets by segment
  try {
    const buildCorr = (seg: 'campaigns' | 'flows'): CorrelationSet => {
      const c = seg === 'campaigns' ? dm.getCampaigns() : [];
      const f = seg === 'flows' ? dm.getFlowEmails() : [];
      const xs = dm.getMetricTimeSeries(c, f, 'emailsSent', dateRange, granularity, customFrom, customTo).map(p => p.value || 0);
      const series = {
        averageRevenue: dm.getMetricTimeSeries(c, f, 'revenue', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        revenuePerEmail: dm.getMetricTimeSeries(c, f, 'revenuePerEmail', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        unsubsPer1k: dm.getMetricTimeSeries(c, f, 'unsubscribeRate', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        bouncesPer1k: dm.getMetricTimeSeries(c, f, 'bounceRate', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        spamPer1k: dm.getMetricTimeSeries(c, f, 'spamRate', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
      };
      const pearson = (xsArr: number[], ysArr: number[]): CorrelationValue => {
        const n = Math.min(xsArr.length, ysArr.length);
        const pairs: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
          const x = xsArr[i]; const y = ysArr[i];
          if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
        }
        if (pairs.length < 3) return { r: null, n: pairs.length };
        const xVals = pairs.map(p => p.x); const yVals = pairs.map(p => p.y);
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        const mx = mean(xVals); const my = mean(yVals);
        let num = 0, dxs = 0, dys = 0;
        for (let i = 0; i < pairs.length; i++) { const dx = xVals[i] - mx; const dy = yVals[i] - my; num += dx * dy; dxs += dx * dx; dys += dy * dy; }
        if (dxs === 0 || dys === 0) return { r: null, n: pairs.length };
        return { r: num / Math.sqrt(dxs * dys), n: pairs.length };
      };
      return {
        averageRevenue: pearson(xs, series.averageRevenue),
        revenuePerEmail: pearson(xs, series.revenuePerEmail),
        unsubsPer1k: pearson(xs, series.unsubsPer1k),
        bouncesPer1k: pearson(xs, series.bouncesPer1k),
        spamPer1k: pearson(xs, series.spamPer1k),
      };
    };
    json.sendVolumeImpact = {
      correlationBySegment: {
        campaigns: buildCorr('campaigns'),
        flows: buildCorr('flows'),
      },
    };
  } catch (e) {
    // Non-fatal
  }

  // Campaign Performance by Send Frequency (lookback period as selected, not full-month trimmed)
  try {
    const resolvedRange = dm.getResolvedDateRange(dateRange, customFrom, customTo);
    const s = resolvedRange?.startDate;
    const e = resolvedRange?.endDate;
    if (s && e) {
      const campaigns = dm.getCampaigns().filter(c => {
        const d = (c as any).sentDate as Date | undefined;
        return d instanceof Date && !isNaN(d.getTime()) && d >= s && d <= e;
      });
      const agg = computeCampaignSendFrequency(campaigns);
      json.campaignSendFrequency = {
        buckets: agg.map(b => ({
          key: b.key,
          weeksCount: b.weeksCount,
          totalCampaigns: b.totalCampaigns,
          perWeek: {
            avgWeeklyRevenue: b.avgWeeklyRevenue,
            avgWeeklyOrders: b.avgWeeklyOrders,
            avgWeeklyEmails: b.avgWeeklyEmails,
          },
          perCampaign: {
            avgCampaignRevenue: (b as any).avgCampaignRevenue,
            avgCampaignOrders: (b as any).avgCampaignOrders,
            avgCampaignEmails: (b as any).avgCampaignEmails,
          },
          rates: {
            avgOrderValue: b.aov,
            conversionRate: b.conversionRate,
            openRate: b.openRate,
            clickRate: b.clickRate,
            clickToOpenRate: b.clickToOpenRate,
            revenuePerEmail: b.revenuePerEmail,
            unsubscribeRate: b.unsubscribeRate,
            spamRate: b.spamRate,
            bounceRate: b.bounceRate,
          },
        }))
      };

      // Subject Line Analysis (All Segments) — compute per metric and map to requested keys
      const buildSubjectSet = (metric: 'openRate' | 'clickToOpenRate' | 'clickRate' | 'revenuePerEmail'): SubjectMetricLiftSet => {
        const res = computeSubjectAnalysis(campaigns as any, metric, 'ALL_SEGMENTS');
        const getLift = (arr: Array<{ key: string; liftVsBaseline: number }>, key: string): number => {
          const f = arr.find(x => x.key === key);
          return f ? f.liftVsBaseline : 0;
        };
        const getCount = (arr: Array<{ key: string; countCampaigns?: number }>, key: string): number => {
          const f = arr.find(x => x.key === key) as any;
          return f && typeof f.countCampaigns === 'number' ? f.countCampaigns : 0;
        };
        const lb = (k: '0-30' | '31-50' | '51-70'): number => {
          const f = (res.lengthBins || []).find(x => (x as any).key === k);
          return f ? (f as any).liftVsBaseline : 0;
        };
        const avgChange = (() => {
          const list = res.reuse || [];
          if (!list.length) return 0;
          const sum = list.reduce((s, r) => s + (r.change || 0), 0);
          return sum / list.length;
        })();
        return {
          lengthBins: { '0-30': lb('0-30'), '31-50': lb('31-50'), '51-70': lb('51-70') },
          keywordEmoji: {
            exclusive: getLift(res.keywordEmojis as any, 'kw:exclusive'),
            sale: getLift(res.keywordEmojis as any, 'kw:sale'),
            emojiPresent: getLift(res.keywordEmojis as any, 'emoji'),
            limited: getLift(res.keywordEmojis as any, 'kw:limited'),
            save: getLift(res.keywordEmojis as any, 'kw:save'),
            off: getLift(res.keywordEmojis as any, 'kw:off'),
            discount: getLift(res.keywordEmojis as any, 'kw:discount'),
            percentOff: getLift(res.keywordEmojis as any, 'kw:% off'),
          },
          keywordEmojiCounts: {
            exclusive: getCount(res.keywordEmojis as any, 'kw:exclusive'),
            sale: getCount(res.keywordEmojis as any, 'kw:sale'),
            emojiPresent: getCount(res.keywordEmojis as any, 'emoji'),
            limited: getCount(res.keywordEmojis as any, 'kw:limited'),
            save: getCount(res.keywordEmojis as any, 'kw:save'),
            off: getCount(res.keywordEmojis as any, 'kw:off'),
            discount: getCount(res.keywordEmojis as any, 'kw:discount'),
            percentOff: getCount(res.keywordEmojis as any, 'kw:% off'),
          },
          punctuationCasing: {
            brackets: getLift(res.punctuationCasing as any, 'brackets'),
            exclamation: getLift(res.punctuationCasing as any, 'exclaim'),
            percent: getLift(res.punctuationCasing as any, 'percent'),
            allCaps: getLift(res.punctuationCasing as any, 'allcaps'),
            questionMark: getLift(res.punctuationCasing as any, 'qmark'),
            number: getLift(res.punctuationCasing as any, 'number'),
          },
          urgency: {
            tonight: getLift(res.deadlines as any, 'deadline:tonight'),
            now: getLift(res.deadlines as any, 'deadline:now'),
            hours: getLift(res.deadlines as any, 'deadline:hours'),
            midnight: getLift(res.deadlines as any, 'deadline:midnight'),
            final: getLift(res.deadlines as any, 'deadline:final'),
            today: getLift(res.deadlines as any, 'deadline:today'),
            ends: getLift(res.deadlines as any, 'deadline:ends'),
            ending: getLift(res.deadlines as any, 'deadline:ending'),
          },
          personalization: { youYour: getLift(res.personalization as any, 'p:you') },
          priceAnchoring: {
            currency: getLift(res.priceAnchoring as any, 'cur'),
            percentDiscount: getLift(res.priceAnchoring as any, 'pct'),
            dollarDiscount: getLift(res.priceAnchoring as any, 'price$'),
          },
          imperativeStart: { startsWithVerb: getLift(res.imperativeStart as any, 'imperative') },
          reuseFatigue: { averageChange: avgChange, subjectsCount: (res.reuse || []).length },
        };
      };
      json.subjectLineAnalysis = {
        openRate: buildSubjectSet('openRate'),
        clickToOpenRate: buildSubjectSet('clickToOpenRate'),
        clickRate: buildSubjectSet('clickRate'),
        revenuePerEmail: buildSubjectSet('revenuePerEmail'),
      };

      // Campaign Performance by Audience Size — compute buckets like the dashboard component
      const computeAudienceBuckets = () => {
        const campaignsValid = campaigns.filter(c => typeof (c as any).emailsSent === 'number' && (c as any).emailsSent >= 0);
        const total = campaignsValid.length;
        let filtered = campaignsValid as any[];
        if (total >= 12) {
          const sortedForP = [...campaignsValid].sort((a: any, b: any) => a.emailsSent - b.emailsSent);
          const p5Index = Math.max(0, Math.floor(0.05 * (sortedForP.length - 1)));
          const p5 = sortedForP[p5Index]?.emailsSent ?? 0;
          const threshold = Math.max(100, Math.min(1000, p5));
          filtered = sortedForP.filter((c: any) => c.emailsSent >= threshold);
        }
        const sample = filtered.length;
        const limited = sample < 12;
        if (sample === 0) return { buckets: [] as any[], limited };
        const sorted = [...filtered].sort((a: any, b: any) => a.emailsSent - b.emailsSent);
        const min = sorted[0].emailsSent;
        const max = sorted[sorted.length - 1].emailsSent;
        const boundaries: number[] = [min];
        if (sample >= 12 && min !== max) {
          const q = (p: number) => {
            const idx = (sorted.length - 1) * p;
            const lo = Math.floor(idx);
            const hi = Math.ceil(idx);
            const val = lo === hi ? sorted[lo].emailsSent : (sorted[lo].emailsSent * (hi - idx) + sorted[hi].emailsSent * (idx - lo));
            return Math.round(val);
          };
          boundaries.push(q(0.25), q(0.50), q(0.75), max);
        } else {
          if (min === max) {
            boundaries.push(max, max, max, max);
          } else {
            for (let i = 1; i <= 4; i++) boundaries.push(Math.round(min + (i * (max - min)) / 4));
          }
        }
        const bRanges = [
          [boundaries[0], boundaries[1]],
          [boundaries[1], boundaries[2]],
          [boundaries[2], boundaries[3]],
          [boundaries[3], boundaries[4]],
        ] as const;
        const niceRangeLabel = (lo: number, hi: number) => {
          const formatEmailsShort = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k` : `${n}`;
          const roundTo = (x: number) => x >= 1_000_000 ? Math.round(x / 100_000) * 100_000 : x >= 100_000 ? Math.round(x / 10_000) * 10_000 : x >= 10_000 ? Math.round(x / 1_000) * 1_000 : x >= 1_000 ? Math.round(x / 100) * 100 : Math.round(x);
          const a = roundTo(lo); const b = roundTo(hi);
          return `${formatEmailsShort(a)}–${formatEmailsShort(b)}`;
        };
        const msPerDay = 24 * 60 * 60 * 1000;
        const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / msPerDay));
        const lookbackWeeks = Math.max(1, Math.round(days / 7));
        const buckets = bRanges.map(([lo, hi], idx) => {
          const bucketCampaigns = sorted.filter((c: any) => idx === 0 ? (c.emailsSent >= lo && c.emailsSent <= hi) : (c.emailsSent > lo && c.emailsSent <= hi));
          let sumRevenue = 0, sumEmails = 0, sumOrders = 0, sumOpens = 0, sumClicks = 0, sumUnsubs = 0, sumSpam = 0, sumBounces = 0;
          for (const c of bucketCampaigns) {
            sumRevenue += (c.revenue || 0);
            sumEmails += (c.emailsSent || 0);
            sumOrders += (c.totalOrders || 0);
            sumOpens += (c.uniqueOpens || 0);
            sumClicks += (c.uniqueClicks || 0);
            sumUnsubs += (c.unsubscribesCount || 0);
            sumSpam += (c.spamComplaintsCount || 0);
            sumBounces += (c.bouncesCount || 0);
          }
          const totalCampaigns = bucketCampaigns.length;
          const avgCampaignRevenue = totalCampaigns > 0 ? sumRevenue / totalCampaigns : 0;
          const aov = sumOrders > 0 ? sumRevenue / sumOrders : 0;
          const revenuePerEmail = sumEmails > 0 ? sumRevenue / sumEmails : 0;
          const openRate = sumEmails > 0 ? (sumOpens / sumEmails) * 100 : 0;
          const clickRate = sumEmails > 0 ? (sumClicks / sumEmails) * 100 : 0;
          const clickToOpenRate = sumOpens > 0 ? (sumClicks / sumOpens) * 100 : 0;
          const conversionRate = sumClicks > 0 ? (sumOrders / sumClicks) * 100 : 0;
          const unsubscribeRate = sumEmails > 0 ? (sumUnsubs / sumEmails) * 100 : 0;
          const spamRate = sumEmails > 0 ? (sumSpam / sumEmails) * 100 : 0;
          const bounceRate = sumEmails > 0 ? (sumBounces / sumEmails) * 100 : 0;
          const avgWeeklyEmailsSent = lookbackWeeks > 0 ? (sumEmails / lookbackWeeks) : 0;
          return {
            rangeLabel: niceRangeLabel(lo, hi),
            rangeMin: lo,
            rangeMax: hi,
            totalCampaigns,
            totalEmailsSent: sumEmails,
            avgCampaignEmails: totalCampaigns > 0 ? (sumEmails / totalCampaigns) : 0,
            avgCampaignRevenue,
            totalRevenue: sumRevenue,
            avgOrderValue: aov,
            revenuePerEmail,
            conversionRate,
            openRate,
            clickRate,
            clickToOpenRate,
            avgWeeklyEmailsSent,
            unsubscribeRate,
            spamRate,
            bounceRate,
          };
        }).filter(b => b.totalCampaigns > 0);
        return { buckets, limited, lookbackWeeks };
      };
      const asp = computeAudienceBuckets();
      if (asp.buckets.length) {
        json.audienceSizePerformance = asp as any;
      }

      // Campaign Gaps & Losses — weekly-only analysis over lookback
      try {
        const gaps = computeCampaignGapsAndLosses({ campaigns: campaigns as any, flows: [], rangeStart: s, rangeEnd: e });
        json.campaignGapsAndLosses = {
          zeroCampaignSendWeeks: gaps.zeroCampaignSendWeeks,
          longestGapWithoutCampaign: gaps.longestZeroSendGap,
          pctWeeksWithCampaignSent: gaps.pctWeeksWithCampaignsSent,
          estimatedLostRevenue: typeof gaps.estimatedLostRevenue === 'number' ? gaps.estimatedLostRevenue : null,
          zeroRevenueCampaigns: gaps.zeroRevenueCampaigns ?? gaps.lowEffectivenessCampaigns,
          averageCampaignsPerWeek: gaps.avgCampaignsPerWeek,
        };
      } catch {}

      // Campaign Performance by Day of Week — aggregate over lookback
      try {
        // We need all metrics, not one at a time. We'll aggregate raw sums per day and derive KPIs.
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const byDay = dayNames.map((d, i) => ({ day: d, dayIndex: i, campaignsCount: 0, totalRevenue: 0, emailsSent: 0, totalOrders: 0, totalOpens: 0, totalClicks: 0, totalUnsubs: 0, totalSpam: 0, totalBounces: 0 }));
        for (const c of campaigns as any[]) {
          const idx = (c.dayOfWeek ?? (c.sentDate instanceof Date ? c.sentDate.getDay() : 0)) as number;
          const d = byDay[idx];
          d.campaignsCount += 1;
          d.totalRevenue += (c.revenue || 0);
          d.emailsSent += (c.emailsSent || 0);
          d.totalOrders += (c.totalOrders || 0);
          d.totalOpens += (c.uniqueOpens || 0);
          d.totalClicks += (c.uniqueClicks || 0);
          d.totalUnsubs += (c.unsubscribesCount || 0);
          d.totalSpam += (c.spamComplaintsCount || 0);
          d.totalBounces += (c.bouncesCount || 0);
        }
        json.campaignPerformanceByDayOfWeek = byDay.map(d => ({
          day: d.day,
          dayIndex: d.dayIndex,
          campaignsCount: d.campaignsCount,
          totalRevenue: d.totalRevenue,
          avgOrderValue: d.totalOrders > 0 ? d.totalRevenue / d.totalOrders : 0,
          totalOrders: d.totalOrders,
          conversionRate: d.totalClicks > 0 ? (d.totalOrders / d.totalClicks) * 100 : 0,
          openRate: d.emailsSent > 0 ? (d.totalOpens / d.emailsSent) * 100 : 0,
          clickRate: d.emailsSent > 0 ? (d.totalClicks / d.emailsSent) * 100 : 0,
          clickToOpenRate: d.totalOpens > 0 ? (d.totalClicks / d.totalOpens) * 100 : 0,
          revenuePerEmail: d.emailsSent > 0 ? d.totalRevenue / d.emailsSent : 0,
          emailsSent: d.emailsSent,
          unsubscribeRate: d.emailsSent > 0 ? (d.totalUnsubs / d.emailsSent) * 100 : 0,
          spamRate: d.emailsSent > 0 ? (d.totalSpam / d.emailsSent) * 100 : 0,
          bounceRate: d.emailsSent > 0 ? (d.totalBounces / d.emailsSent) * 100 : 0,
        }));
      } catch {}

      // Flow Step Analysis — totals for lookback and series by selected granularity
      try {
        // Only include LIVE flows (exclude draft/manual) per requirement
        const flowsAll = dm.getFlowEmails().filter(f => {
          const status = (f as any).status;
          return typeof status === 'string' && status.toLowerCase() === 'live';
        });
        const flowsInRange = flowsAll.filter(f => {
          const d = (f as any).sentDate as Date | undefined;
          return d instanceof Date && !isNaN(d.getTime()) && d >= s && d <= e;
        });
        const uniqueFlowNames = Array.from(new Set(flowsInRange.map(f => f.flowName))).sort((a, b) => a.localeCompare(b));
        const disclaimer = 'Step order might not be perfectly accurate due to inconsistent naming of flow emails.';
        const metricKeys = ['revenue','avgOrderValue','totalOrders','conversionRate','openRate','clickRate','clickToOpenRate','revenuePerEmail','emailsSent','unsubscribeRate','spamRate','bounceRate'] as const;
        const toTotals = (list: any[]): FlowMetricTotals => {
          const sums = {
            revenue: 0, emailsSent: 0, totalOrders: 0, opens: 0, clicks: 0, unsubs: 0, spam: 0, bounces: 0
          };
          for (const f of list) {
            sums.revenue += (f.revenue || 0);
            sums.emailsSent += (f.emailsSent || 0);
            sums.totalOrders += (f.totalOrders || 0);
            sums.opens += (f.uniqueOpens || 0);
            sums.clicks += (f.uniqueClicks || 0);
            sums.unsubs += (f.unsubscribesCount || 0);
            sums.spam += (f.spamComplaintsCount || 0);
            sums.bounces += (f.bouncesCount || 0);
          }
          const avgOrderValue = sums.totalOrders > 0 ? sums.revenue / sums.totalOrders : 0;
          const conversionRate = sums.clicks > 0 ? (sums.totalOrders / sums.clicks) * 100 : 0;
          const openRate = sums.emailsSent > 0 ? (sums.opens / sums.emailsSent) * 100 : 0;
          const clickRate = sums.emailsSent > 0 ? (sums.clicks / sums.emailsSent) * 100 : 0;
          const clickToOpenRate = sums.opens > 0 ? (sums.clicks / sums.opens) * 100 : 0;
          const revenuePerEmail = sums.emailsSent > 0 ? sums.revenue / sums.emailsSent : 0;
          const unsubscribeRate = sums.emailsSent > 0 ? (sums.unsubs / sums.emailsSent) * 100 : 0;
          const spamRate = sums.emailsSent > 0 ? (sums.spam / sums.emailsSent) * 100 : 0;
          const bounceRate = sums.emailsSent > 0 ? (sums.bounces / sums.emailsSent) * 100 : 0;
          return {
            totalRevenue: sums.revenue,
            avgOrderValue,
            totalOrders: sums.totalOrders,
            conversionRate,
            openRate,
            clickRate,
            clickToOpenRate,
            revenuePerEmail,
            emailsSent: sums.emailsSent,
            unsubscribeRate,
            spamRate,
            bounceRate,
          };
        };
        const buildSeries = (c: any[], f: any[], g: 'daily'|'weekly'|'monthly'): FlowMetricSeries => {
          const get = (key: string) => dm.getMetricTimeSeries(c, f, key, dateRange, g, customFrom, customTo).map(p => ({ date: (p as any).iso || p.date, value: p.value || 0 }));
          return {
            revenue: get('revenue'),
            avgOrderValue: get('avgOrderValue'),
            totalOrders: get('totalOrders'),
            conversionRate: get('conversionRate'),
            openRate: get('openRate'),
            clickRate: get('clickRate'),
            clickToOpenRate: get('clickToOpenRate'),
            revenuePerEmail: get('revenuePerEmail'),
            emailsSent: get('emailsSent'),
            unsubscribeRate: get('unsubscribeRate'),
            spamRate: get('spamRate'),
            bounceRate: get('bounceRate'),
          };
        };
        const flowObjs = uniqueFlowNames.map(flowName => {
          const flowItems = flowsInRange.filter(f => f.flowName === flowName);
          const stepMap = new Map<number, any[]>();
          for (const f of flowItems) {
            const k = Number.isFinite(f.sequencePosition) ? f.sequencePosition : 0;
            stepMap.set(k, [...(stepMap.get(k) || []), f]);
          }
          const steps = Array.from(stepMap.entries()).sort((a,b)=>a[0]-b[0]).map(([seq, list]) => ({
            stepNumber: seq,
            emailName: list[0]?.emailName,
            total: toTotals(list),
            series: buildSeries([], list as any[], granularity),
          }));
          return {
            flowName,
            total: toTotals(flowItems),
            series: buildSeries([], flowItems as any[], granularity),
            steps,
          };
        }).filter(f => (f.steps?.length || 0) > 0);
        if (flowObjs.length) {
          json.flowStepAnalysis = { granularity, disclaimer, flows: flowObjs };
        }
      } catch {}

      // Audience Growth — series by granularity for created, firstActive, subscribed
      try {
        const subs = dm.getSubscribers() as any[];
        // Filter to active audience, mirroring component logic
        const activeSubs = subs.filter(s => (s?.emailConsent === true || s?.canReceiveEmail === true));

        // Resolve range per component rules
        let rangeStart: Date | null = null;
        let rangeEnd: Date | null = null;
        if (dateRange === 'custom' && customFrom && customTo) {
          rangeStart = new Date(customFrom + 'T00:00:00');
          rangeEnd = new Date(customTo + 'T23:59:59');
        } else if (dateRange === 'all') {
          const times = activeSubs.map(s => (s?.profileCreated instanceof Date ? s.profileCreated.getTime() : NaN)).filter((t: number) => Number.isFinite(t));
          if (times.length) {
            rangeStart = new Date(Math.min(...times));
            rangeEnd = new Date(Math.max(...times));
            rangeStart.setHours(0,0,0,0);
            rangeEnd.setHours(23,59,59,999);
          }
        } else {
          const days = parseInt(String(dateRange).replace('d','')) || 30;
          const end = dm.getLastEmailDate() || new Date(); end.setHours(23,59,59,999);
          const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0,0,0,0);
          rangeStart = start; rangeEnd = end;
        }
        if (rangeStart && rangeEnd) {
          const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const buckets: Array<{ start: Date; created: number; firstActive: number; subscribed: number }> = [];
          const cursor = new Date(rangeStart);
          const push = (d: Date) => buckets.push({ start: new Date(d), created: 0, firstActive: 0, subscribed: 0 });
          if (granularity === 'daily') {
            while (cursor <= rangeEnd) { push(cursor); cursor.setDate(cursor.getDate()+1); }
          } else if (granularity === 'weekly') {
            while (cursor <= rangeEnd) { push(cursor); cursor.setDate(cursor.getDate()+7); }
          } else {
            while (cursor <= rangeEnd) { push(cursor); cursor.setMonth(cursor.getMonth()+1); }
          }
          const idxFor = (d: Date) => {
            if (granularity === 'daily') return Math.floor((d.getTime() - rangeStart!.getTime()) / 86400000);
            if (granularity === 'weekly') return Math.floor((d.getTime() - rangeStart!.getTime()) / (86400000*7));
            return (d.getFullYear() - rangeStart!.getFullYear())*12 + (d.getMonth() - rangeStart!.getMonth());
          };
          const parseConsentDate = (raw: any): Date | null => {
            if (!raw) return null; if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
            const s = String(raw).trim(); if (!s || ['TRUE','FALSE','NEVER_SUBSCRIBED'].includes(s.toUpperCase())) return null;
            const d = new Date(s); return isNaN(d.getTime()) ? null : d;
          };
          for (const s of activeSubs) {
            const created: Date | null = s?.profileCreated instanceof Date ? s.profileCreated : null;
            if (created && created >= rangeStart && created <= rangeEnd) { const i = idxFor(created); if (buckets[i]) buckets[i].created++; }
            const first: Date | null = (s?.firstActiveRaw instanceof Date ? s.firstActiveRaw : (s?.firstActive instanceof Date ? s.firstActive : null));
            if (first && first >= rangeStart && first <= rangeEnd) { const i = idxFor(first); if (buckets[i]) buckets[i].firstActive++; }
            const consentDate: Date | null = (s?.emailConsentTimestamp instanceof Date ? s.emailConsentTimestamp : parseConsentDate(s?.emailConsentRaw));
            if (consentDate && consentDate >= rangeStart && consentDate <= rangeEnd) {
              const i = idxFor(consentDate); if (buckets[i]) buckets[i].subscribed++;
            } else if (s?.emailConsent === true && created && created >= rangeStart && created <= rangeEnd) {
              const i = idxFor(created); if (buckets[i]) buckets[i].subscribed++;
            }
          }
          const series = buckets.map(b => ({ date: fmt(b.start), created: b.created, firstActive: b.firstActive, subscribed: b.subscribed }));
          const totals = series.reduce((acc, p) => { acc.created += p.created; acc.firstActive += p.firstActive; acc.subscribed += p.subscribed; return acc; }, { created: 0, firstActive: 0, subscribed: 0 });
          json.audienceGrowth = { granularity, series, totals };
        }
      } catch {}
    }
  } catch (e) {
    // Non-fatal
  }

  return json;
}

function zeroMetrics(): ExportMetricValues {
  return { totalRevenue: 0, avgOrderValue: 0, totalOrders: 0, conversionRate: 0, openRate: 0, clickRate: 0, clickToOpenRate: 0, revenuePerEmail: 0, emailsSent: 0, unsubscribeRate: 0, spamRate: 0, bounceRate: 0 };
}
