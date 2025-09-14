// LLM-friendly JSON export builder with a strict minimal schema.
// Uses DataManager processed data; outputs only the requested metrics and splits.

import { DataManager } from "../data/dataManager";
import { computeCampaignSendFrequency } from "../analytics/campaignSendFrequency";
import { computeSubjectAnalysis } from "../analytics/subjectAnalysis";
import { computeCampaignGapsAndLosses } from "../analytics/campaignGapsLosses";
import type { AggregatedMetrics } from "../data/dataTypes";
import { computeDeadWeightSavings } from "../analytics/deadWeightSavings";

export interface LlmExportJson {
  // Metadata about this export and helpful descriptions
  meta?: {
    account?: { name?: string; url?: string };
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
  // Subject Line Analysis (All Segments): category-based, reliable entries only
  subjectLineAnalysis?: {
    categories: Array<{
      key: string; label: string;
      metrics: {
        openRate?: { value: number; liftVsBaseline: number; countCampaigns: number; totalEmails: number; reliable: boolean; pAdj?: number };
        clickRate?: { value: number; liftVsBaseline: number; countCampaigns: number; totalEmails: number; reliable: boolean; pAdj?: number };
        clickToOpenRate?: { value: number; liftVsBaseline: number; countCampaigns: number; totalEmails: number; reliable: boolean; pAdj?: number };
        revenuePerEmail?: { value: number; liftVsBaseline: number; countCampaigns: number; totalEmails: number; reliable: boolean; ci95?: { lo: number; hi: number } };
      };
      examples?: string[];
    }>;
    baseline: { openRate: number; clickRate: number; clickToOpenRate: number; revenuePerEmail: number };
    lengthBins: Array<{ key: string; label: string; value: number; liftVsBaseline: number; countCampaigns: number; totalEmails: number }>;
    note: string; // overlapping categories; reliable = volume + significance
  };
  // Flow Step Analysis (lookback totals only — per flow and per step; no time series)
  flowStepAnalysis?: {
    disclaimer: string;
    flows: Array<{
      flowName: string;
      total: FlowMetricTotals;
      // Availability of step performance indicator for this flow
      indicatorAvailable?: boolean;
      disabledReason?: string;
      notEnoughData?: boolean;
      // Scoring config/baselines used for this flow
      baselines?: { s1Sends: number; flowRevenueTotal: number; storeRevenueTotal: number };
      config?: { revenueLed: true };
      // Add-step suggestion with conservative estimate (Option B)
      addStepSuggestion?: {
        suggested: boolean;
        reason?: string;
  horizonDays?: number;
        estimate?: {
          projectedReach: number;
          rpeFloor: number;
          estimatedRevenue: number;
          assumptions: { reachPctOfLastStep: number; rpePercentile: 25; clampedToLastStepRpe: boolean };
        };
        gates: {
          lastStepRevenue: number;
          lastStepRevenuePctOfFlow: number; // 0-100
          deliverabilityOk: boolean;
          volumeOk: boolean;
          rpeOk: boolean;
          deltaRpeOk: boolean;
          isRecentWindow: boolean;
        };
      };
      steps: Array<{
        stepNumber: number;
        emailName?: string;
        total: FlowMetricTotals;
        stepScore?: {
          score: number; // 0-100
          action: 'scale' | 'keep' | 'improve' | 'pause';
          notes?: string[];
          pillars: {
            money: { points: number; riPts: number; ersPts: number; ri: number; ers: number };
            deliverability: { points: number; base: number; lowVolumeAdjusted: boolean; riskHigh: boolean };
            confidence: { points: number };
          };
          baselines: { flowRevenueTotal: number; storeRevenueTotal: number };
        };
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
  // Engagement by Profile Age: for each age segment, profile count and percentages across engagement windows
  engagementByProfileAge?: {
    buckets: Array<{
      label: '0-6 months' | '6-12 months' | '1-2 years' | '2+ years';
      profiles: number;
      percentages: {
        '0-30 days': number;
        '31-60 days': number;
        '61-90 days': number;
        '91-120 days': number;
        '120+ days': number;
        'Never engaged': number;
      };
    }>;
  };
  // Inactivity Revenue Drain: dormant CLV share by inactivity buckets with totals
  inactivityRevenueDrain?: {
    buckets: Array<{ label: '30-59 days' | '60-89 days' | '90-119 days' | '120+ days'; percentage: number; revenue: number }>;
    totals: { totalClv: number; dormantClv: number; dormantPct: number };
  };
  // Dead Weight Audience: size, percent of audience, projected size after purge, and Klaviyo pricing savings
  deadWeightAudience?: {
    audienceSize: number;
    deadWeightCount: number;
    deadWeightPct: number; // 0-100
    projectedAudienceSize: number;
    currentMonthlyPrice: number | null;
    projectedMonthlyPrice: number | null;
    monthlySavings: number | null;
    annualSavings: number | null;
    usedCustomPricingEstimate?: boolean;
    note?: string;
  };
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

  // Removed legacy SubjectMetricLiftSet; replaced by categories block

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

// (FlowMetricSeries removed — flowStepAnalysis is totals-only)

export async function buildLlmExportJson(params: {
  dateRange: string;
  granularity: "daily" | "weekly" | "monthly";
  compareMode: "prev-period" | "prev-year";
  customFrom?: string;
  customTo?: string;
  account?: { name?: string | null; url?: string | null };
}): Promise<LlmExportJson> {
  const dm = DataManager.getInstance();
  const { dateRange, customFrom, customTo, granularity } = params as any;
  const acct = (params as any).account as { name?: string | null; url?: string | null } | undefined;
  const normalizeUrl = (u?: string | null): string | undefined => {
    if (!u) return undefined;
    let v = String(u).trim();
    if (!v) return undefined;
    // If user stored just the domain (recommended), add https://
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    // Strip trailing slashes for cleanliness
    v = v.replace(/\/$/, '');
    return v;
  };

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
      account: { name: acct?.name ?? undefined, url: normalizeUrl(acct?.url) },
      conversionRateDefinition: 'Conversion Rate (%) = placed orders divided by clicks',
      generatedAt: new Date().toISOString(),
      moduleDescriptions: {
        period: 'Full-month window used for full-period metrics and monthly splits (fromMonth–toMonth inclusive).',
  metrics: 'Full-month aggregated KPIs for the window; split into overall and campaigns-only views.',
        audienceOverview: 'Snapshot from Audience Overview at export time: only profiles that can receive email (not suppressed). Includes Total Active Audience, Buyers, % of audience, Avg CLV (All), Avg CLV (Buyers).',
        audienceGrowth: 'Daily/Weekly/Monthly counts for Created, First Active, and Subscribed over the selected lookback period; includes period totals.',
        purchaseFrequencyDistribution: 'How many profiles have never purchased, purchased once, twice, 3–5 times, or 6+ times; includes counts and percent of audience.',
        audienceLifetime: 'How long profiles have been on your list (0–3m, 3–6m, 6–12m, 1–2y, 2+y); includes counts and percent of audience.',
        highValueCustomerSegments: 'Buyer cohorts whose lifetime value is at least 2x, 3x, or 6x the buyer AOV; includes customer counts and their cumulative revenue.',
        lastActiveSegments: 'Recency of engagement: Never Active, and inactive for 90+/120+/180+/365+ days based on Last Active; includes counts and percent of audience.',
        campaignFlowSplit: 'Monthly split of revenue and emails between Campaigns vs Flows over the full-month window, plus period totals.',
        sendVolumeImpact: 'Correlation between emails sent and performance metrics across the selected lookback buckets, by segment (Campaigns/Flows).',
        campaignSendFrequency: 'KPIs by weekly send frequency buckets (1, 2, 3, 4+) over the selected lookback period; includes campaign counts.',
  subjectLineAnalysis: 'Category-level lifts vs account average (All Segments) over the selected lookback. Only categories meeting volume and significance are included; baseline and length bins provided.',
        audienceSizePerformance: 'KPIs by audience size (emails sent) buckets over the selected lookback period; includes campaign counts and audience size totals.',
        campaignGapsAndLosses: 'Weekly-only analysis identifying zero-send weeks, longest gaps, coverage, estimated lost revenue, and zero-revenue campaigns over the lookback period.',
  campaignPerformanceByDayOfWeek: 'KPIs by weekday over the selected lookback period; includes how many campaigns were sent on each day.',
  flowStepAnalysis: 'Totals for every step in every active flow and roll-ups per flow over the selected lookback period (no time-series). Includes per-step indicator (good/needs work/consider pausing/low data), availability flags, and an Add Step suggestion with a conservative estimate when applicable. Disclaimer: step order may be imperfect due to inconsistent flow email naming.'
        ,
        engagementByProfileAge: 'For profile age segments (0–6m, 6–12m, 1–2y, 2+y), shows the segment size and the row-normalized percentage split across last engagement windows (0–30, 31–60, 61–90, 91–120, 120+ days, Never engaged).',
        inactivityRevenueDrain: 'Share of total CLV sitting in inactive subscribers by last engagement recency buckets (30–59, 60–89, 90–119, 120+ days). Includes Total CLV and Dormant CLV totals with percentage.'
        ,
        deadWeightAudience: 'Dead‑weight audience (never engaged or long inactive) and the estimated monthly Klaviyo plan savings if suppressed. Includes current list size, projected size after purge, and note when no savings apply.'
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
  const sumClvAll = active.reduce((sum, s) => sum + ((s?.historicClv ?? s?.totalClv) || 0), 0);
    const avgClvAll = totalActiveAudience > 0 ? (sumClvAll / totalActiveAudience) : 0;
  const sumClvBuyers = buyersArr.reduce((sum, s) => sum + ((s?.historicClv ?? s?.totalClv) || 0), 0);
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
        const h = (s?.historicClv ?? s?.totalClv) || 0;
        if (s?.isBuyer && h > 0) {
          segments.forEach(seg => {
            if (h >= seg.multiplier * aov) { seg.customers++; seg.revenue += h; }
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

  // Engagement by Profile Age (0–6m, 6–12m, 1–2y, 2+y) with percentages across engagement windows
  try {
    const subs = dm.getSubscribers() as any[];
    if (subs?.length) {
      const anchor = dm.getLastEmailDate();
      const diffInFullMonths = (anchorDate: Date, start: Date) => {
        let months = (anchorDate.getFullYear() - start.getFullYear()) * 12 + (anchorDate.getMonth() - start.getMonth());
        if (anchorDate.getDate() < start.getDate()) months -= 1;
        return Math.max(0, months);
      };
      const daysBetween = (a: Date, b: Date) => {
        const MS = 1000 * 60 * 60 * 24;
        const da = new Date(a); da.setHours(0,0,0,0);
        const db = new Date(b); db.setHours(0,0,0,0);
        return Math.floor((da.getTime() - db.getTime()) / MS);
      };
      const ageDefs = [
        { key: '0_6m', label: '0-6 months', minM: 0, maxM: 5 },
        { key: '6_12m', label: '6-12 months', minM: 6, maxM: 11 },
        { key: '1_2y', label: '1-2 years', minM: 12, maxM: 23 },
        { key: '2y_plus', label: '2+ years', minM: 24, maxM: Infinity },
      ];
      const engDefs = [
        { key: '0_30', label: '0-30 days', minD: 0, maxD: 30 },
        { key: '31_60', label: '31-60 days', minD: 31, maxD: 60 },
        { key: '61_90', label: '61-90 days', minD: 61, maxD: 90 },
        { key: '91_120', label: '91-120 days', minD: 91, maxD: 120 },
        { key: '121_plus', label: '120+ days', minD: 121, maxD: Infinity },
        { key: 'never', label: 'Never engaged', minD: null as any, maxD: null as any },
      ];
      const rows = ageDefs.map(a => ({ key: a.key, label: a.label, denom: 0, cells: engDefs.map(e => ({ key: e.key, count: 0 })) }));
      for (const s of subs) {
        const created: Date | null = s?.profileCreated instanceof Date ? s.profileCreated : null;
        if (!created) continue;
        const ageMonths = diffInFullMonths(anchor, created);
        const ageIdx = ageDefs.findIndex(a => ageMonths >= a.minM && ageMonths <= a.maxM);
        if (ageIdx === -1) continue;
        rows[ageIdx].denom += 1;
        const lastOpen: Date | null = s?.lastOpen instanceof Date ? s.lastOpen : null;
        const lastClick: Date | null = s?.lastClick instanceof Date ? s.lastClick : null;
        const last: Date | null = (lastOpen && lastClick) ? (lastOpen > lastClick ? lastOpen : lastClick) : (lastOpen || lastClick);
        if (!last) {
          const cell = rows[ageIdx].cells.find(c => c.key === 'never');
          if (cell) cell.count += 1;
          continue;
        }
        const d = daysBetween(anchor, last);
        for (const e of engDefs) {
          if (e.key === 'never') continue;
          const minD = e.minD as number; const maxD = e.maxD as number;
          if (d >= minD && d <= maxD) { const cell = rows[ageIdx].cells.find(c => c.key === e.key); if (cell) cell.count += 1; break; }
        }
      }
      json.engagementByProfileAge = {
        buckets: rows.map(r => {
          const mapLabel = (k: string) => engDefs.find(e => e.key === k)!.label as any;
          const pct = (n: number) => r.denom > 0 ? (n / r.denom) * 100 : 0;
          const asRecord: any = {};
          for (const c of r.cells) { asRecord[mapLabel(c.key)] = pct(c.count); }
          return { label: r.label as any, profiles: r.denom, percentages: asRecord };
        })
      };
    }
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

  // Inactivity Revenue Drain: dormant CLV share by inactivity buckets (30/60/90/120+ days)
  try {
    const subs = dm.getSubscribers() as any[];
    if (subs?.length) {
      const now = new Date();
      const defs = [
        { key: '30_59', label: '30-59 days', min: 30, max: 59, clv: 0, count: 0 },
        { key: '60_89', label: '60-89 days', min: 60, max: 89, clv: 0, count: 0 },
        { key: '90_119', label: '90-119 days', min: 90, max: 119, clv: 0, count: 0 },
        { key: '120_plus', label: '120+ days', min: 120, max: Infinity, clv: 0, count: 0 },
      ];
  let totalClv = 0;
      for (const s of subs) {
  const clv = Number((s?.historicClv ?? s?.totalClv) || 0); if (clv <= 0) continue; totalClv += clv;
        const lastOpen: Date | null = s?.lastOpen instanceof Date ? s.lastOpen : null;
        const lastClick: Date | null = s?.lastClick instanceof Date ? s.lastClick : null;
        const last: Date | null = (lastOpen && lastClick) ? (lastOpen > lastClick ? lastOpen : lastClick) : (lastOpen || lastClick);
        if (!last) continue; // no engagement ever -> excluded, mirrors current dashboard logic
        const days = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
        for (const b of defs) { if (days >= b.min && days <= b.max) { b.clv += clv; b.count += 1; break; } }
      }
      const dormantClv = defs.reduce((s, b) => s + b.clv, 0);
      json.inactivityRevenueDrain = {
        buckets: defs.map(b => ({ label: b.label as any, percentage: totalClv > 0 ? (b.clv / totalClv) * 100 : 0, revenue: b.clv })),
        totals: { totalClv, dormantClv, dormantPct: totalClv > 0 ? (dormantClv / totalClv) * 100 : 0 }
      };
    }
  } catch {}

  // Dead Weight Audience: audience size, percent of list, projected size after purge, and monthly Klaviyo savings
  try {
    const summary = computeDeadWeightSavings();
    if (summary) {
      const {
        currentSubscribers,
        deadWeightCount,
        projectedSubscribers,
        currentMonthlyPrice,
        projectedMonthlyPrice,
        monthlySavings,
        annualSavings,
        usedCustomPricingEstimate
      } = summary;
      const deadWeightPct = currentSubscribers > 0 ? (deadWeightCount / currentSubscribers) * 100 : 0;
      let note: string | undefined;
      let monthlySavingsOut: number | null | undefined = monthlySavings;
      let annualSavingsOut: number | null | undefined = annualSavings;
      if (usedCustomPricingEstimate) {
        // Mirror dashboard: on custom tiers (>250k), we do not show estimated savings
        note = 'Custom pricing tier (>250k). Savings not calculated.';
        monthlySavingsOut = null;
        annualSavingsOut = null;
      } else if (!monthlySavings || monthlySavings <= 0) {
        note = 'No savings detected — you are not overpaying for your Klaviyo plan. It can still be a good idea to suppress long‑inactive profiles for list hygiene.';
      }
      json.deadWeightAudience = {
        audienceSize: currentSubscribers,
        deadWeightCount,
        deadWeightPct,
        projectedAudienceSize: projectedSubscribers,
        currentMonthlyPrice,
        projectedMonthlyPrice,
        monthlySavings: monthlySavingsOut ?? monthlySavings ?? null,
        annualSavings: annualSavingsOut ?? annualSavings ?? null,
        usedCustomPricingEstimate,
        note,
      };
    }
  } catch {}

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

      // Subject Line Analysis (All Segments) — categories with reliability gating, plus baseline and length bins
      const buildCategories = () => {
        const metrics: Array<'openRate' | 'clickRate' | 'clickToOpenRate' | 'revenuePerEmail'> = ['openRate','clickRate','clickToOpenRate','revenuePerEmail'];
        const perMetric = metrics.map(m => ({ m, res: computeSubjectAnalysis(campaigns as any, m, 'ALL_SEGMENTS') }));
        // Build category map keyed by category key
        const map = new Map<string, { key: string; label: string; metrics: any; examples?: string[] }>();
        for (const { m, res } of perMetric) {
          for (const c of res.categories) {
            if (!map.has(c.key)) map.set(c.key, { key: c.key, label: c.label, metrics: {}, examples: c.examples });
            if (c.reliable) {
              map.get(c.key)!.metrics[m] = { value: c.value, liftVsBaseline: c.liftVsBaseline, countCampaigns: c.countCampaigns, totalEmails: c.totalEmails, reliable: !!c.reliable, pAdj: c.pAdj, ci95: c.ci95 };
            }
          }
        }
        // Baselines
        const base = {
          openRate: perMetric.find(x => x.m==='openRate')!.res.baseline.value,
          clickRate: perMetric.find(x => x.m==='clickRate')!.res.baseline.value,
          clickToOpenRate: perMetric.find(x => x.m==='clickToOpenRate')!.res.baseline.value,
          revenuePerEmail: perMetric.find(x => x.m==='revenuePerEmail')!.res.baseline.value,
        };
        // Length bins — take from the currently selected metric in UI? Export a neutral set from openRate for consistency here
        const lbRes = perMetric.find(x => x.m==='openRate')!.res.lengthBins || [];
        const lengthBins = lbRes.map(b => ({ key: (b as any).key, label: (b as any).label, value: b.value, liftVsBaseline: b.liftVsBaseline, countCampaigns: b.countCampaigns, totalEmails: b.totalEmails }));
        const categories = Array.from(map.values()).filter(c => Object.keys(c.metrics).length > 0);
        return { categories, baseline: base, lengthBins };
      };
      const cat = buildCategories();
      json.subjectLineAnalysis = { ...cat, note: 'Categories may overlap. Only entries meeting volume and significance are included.' } as any;

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

  // Flow Step Analysis — totals for lookback (no time series) with indicators and add-step suggestion
      try {
        const resolvedRange2 = dm.getResolvedDateRange(dateRange as any, customFrom as any, customTo as any);
        const s2 = resolvedRange2?.startDate ?? start;
        const e2 = resolvedRange2?.endDate ?? end;
        // Only include LIVE flows (exclude draft/manual) per requirement
        const flowsAll = dm.getFlowEmails().filter(f => {
          const status = (f as any).status;
          return typeof status === 'string' && status.toLowerCase() === 'live';
        });
        const flowsInRange = flowsAll.filter(f => {
          const d = (f as any).sentDate as Date | undefined;
          return d instanceof Date && !isNaN(d.getTime()) && d >= s2 && d <= e2;
        });
        const uniqueFlowNames = Array.from(new Set(flowsInRange.map(f => f.flowName))).sort((a, b) => a.localeCompare(b));
        const disclaimer = 'Step order might not be perfectly accurate due to inconsistent naming of flow emails.';
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
        const percentile = (v: number, sorted: number[]) => {
          if (!sorted.length) return 0.5;
          let lo = 0, hi = sorted.length - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid] < v) lo = mid + 1; else hi = mid - 1;
          }
          return sorted.length ? Math.max(0, Math.min(1, lo / sorted.length)) : 0.5;
        };
        const flows = uniqueFlowNames.map(flowName => {
          const flowItems = flowsInRange.filter(f => f.flowName === flowName);
          const total = toTotals(flowItems);
          // Steps grouped by sequence
          const stepMap = new Map<number, any[]>();
          const nameCounts = new Map<string, number>();
          for (const f of flowItems) {
            const k = Number.isFinite(f.sequencePosition) ? f.sequencePosition : 0;
            stepMap.set(k, [...(stepMap.get(k) || []), f]);
            const nm = (f.emailName || '').trim();
            if (nm) nameCounts.set(nm, (nameCounts.get(nm) || 0) + 1);
          }
          const steps = Array.from(stepMap.entries()).sort((a,b)=>a[0]-b[0]).map(([seq, list]) => ({
            stepNumber: seq,
            emailName: list[0]?.emailName,
            total: toTotals(list),
          }));
          if (!steps.length) return null;

          // Indicator availability: no duplicate names and monotonic median sentDate by step
          const hasDup = Array.from(nameCounts.values()).some(c => c > 1);
          let orderOk = true;
          try {
            let lastMed: number | null = null;
            for (const [seq, list] of Array.from(stepMap.entries()).sort((a,b)=>a[0]-b[0])) {
              const times = list.map(i => (i.sentDate instanceof Date ? i.sentDate.getTime() : NaN)).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
              if (!times.length) continue;
              const mid = Math.floor(times.length / 2);
              const median = times.length % 2 === 0 ? Math.round((times[mid-1] + times[mid]) / 2) : times[mid];
              if (lastMed != null && median < lastMed) { orderOk = false; break; }
              lastMed = median;
            }
          } catch {}
          const indicatorAvailable = !hasDup && orderOk;
          const totalFlowSends = steps.reduce((sum, s) => sum + (s.total.emailsSent || 0), 0);
          const notEnoughData = totalFlowSends < 2000;

          // New simplified 0–100 scoring with pillars (Money, Deliverability, Confidence)
          const s1Sends = steps[0]?.total.emailsSent || 0;
          const flowRevenueTotal = total.totalRevenue || 0;
          // Resolve account/store aggregates for window (campaigns + flows)
          const resolvedWindow = dm.getResolvedDateRange(dateRange as any, customFrom as any, customTo as any);
          const start = resolvedWindow?.startDate ?? new Date(0);
          const end = resolvedWindow?.endDate ?? new Date();
          const overallAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), dm.getFlowEmails(), start, end);
          const storeRevenueTotal = overallAgg.totalRevenue || 0;
          const accountSendsTotal = overallAgg.emailsSent || 0;
          const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
          const totalFlowSendsInWindow = steps.reduce((sum, s) => sum + (s.total.emailsSent || 0), 0);
          // Revenue Index baseline (median RPE across steps; for single‑step flows use flows‑only RPE in window)
          let medianRPE = 0;
          try {
            const rpes = steps
              .filter(st => (st.total.emailsSent || 0) > 0)
              .map(st => (st.total.totalRevenue || 0) / (st.total.emailsSent || 1))
              .filter(v => Number.isFinite(v) && v >= 0)
              .sort((a, b) => a - b);
            if (rpes.length > 0) {
              const mid = Math.floor(rpes.length / 2);
              medianRPE = rpes.length % 2 === 0 ? (rpes[mid - 1] + rpes[mid]) / 2 : rpes[mid];
            }
            if (steps.length === 1) {
              const flowsOnlyAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), s2, e2);
              medianRPE = flowsOnlyAgg?.revenuePerEmail || medianRPE || 0;
            }
          } catch {}

          const stepScores = steps.map((s, i) => {
            const notes: string[] = [];
            // Money pillar (max 70) = Revenue Index (35) + Email Rev Share (ERS, 35)
            const rpe = (s.total.emailsSent || 0) > 0 ? (s.total.totalRevenue || 0) / (s.total.emailsSent || 1) : 0;
            const riRaw = medianRPE > 0 ? (rpe / medianRPE) : 0;
            const riClipped = clamp(riRaw, 0, 2.0);
            const riPts = 35 * (riClipped / 2);
            const ers = storeRevenueTotal > 0 ? (s.total.totalRevenue / storeRevenueTotal) : 0;
            const ersPts = (() => {
              if (!isFinite(ers) || ers <= 0) return 5;
              const pct = ers * 100;
              if (pct >= 5) return 35;
              if (pct >= 3) return 30;
              if (pct >= 2) return 25;
              if (pct >= 1) return 20;
              if (pct >= 0.5) return 15;
              if (pct >= 0.25) return 10;
              return 5;
            })();
            if (riClipped >= 1.4) notes.push('High Revenue Index');
            if (storeRevenueTotal <= 0) notes.push('No store revenue in window');
            const moneyPoints = clamp(riPts + ersPts, 0, 70);
            // Deliverability additive bins + proportional low-volume adjustment
            const unsub = s.total.unsubscribeRate; const spam = s.total.spamRate; const bounce = s.total.bounceRate;
            const openPct = s.total.openRate; const clickPct = s.total.clickRate;
            const spamPts = ((): number => {
              if (spam < 0.05) return 7;
              if (spam < 0.10) return 6;
              if (spam < 0.20) return 3;
              if (spam < 0.30) return 1;
              return 0;
            })();
            const bouncePts = ((): number => {
              if (bounce < 1.0) return 7;
              if (bounce < 2.0) return 6;
              if (bounce < 3.0) return 3;
              if (bounce < 5.0) return 1;
              return 0;
            })();
            const unsubPts = ((): number => {
              if (unsub < 0.20) return 3;
              if (unsub < 0.50) return 2.5;
              if (unsub < 1.00) return 1;
              return 0;
            })();
            const openPts = ((): number => {
              if (openPct >= 30) return 2; // 30-40 and >40 both 2 pts
              if (openPct >= 20) return 1;
              return 0;
            })();
            const clickPts = ((): number => {
              if (clickPct > 3) return 1;
              if (clickPct >= 1) return 0.5;
              return 0;
            })();
            let baseD = clamp(spamPts + bouncePts + unsubPts + openPts + clickPts, 0, 20);
            const sendShareOfAccount = accountSendsTotal > 0 ? ((s.total.emailsSent || 0) / accountSendsTotal) : 0;
            const applyVolumeAdj = (baseD < 15) && (sendShareOfAccount > 0) && (sendShareOfAccount < 0.005);
            const volumeFactor = applyVolumeAdj ? (1 - (sendShareOfAccount / 0.005)) : 0;
            const adjustedD = applyVolumeAdj ? (baseD + (20 - baseD) * volumeFactor) : baseD;
            const lowVolumeAdjusted = applyVolumeAdj;
            const D = Math.max(0, Math.min(20, adjustedD));
            // Statistical Confidence (10): 1pt per 100 sends
            const scPoints = clamp(Math.floor((s.total.emailsSent || 0) / 100), 0, 10);
            const flowSendShare = totalFlowSendsInWindow > 0 ? (s.total.emailsSent / totalFlowSendsInWindow) : 0;
            const riskHigh = (spam >= 0.30) || (unsub > 1.00) || (bounce >= 5.00) || (openPct < 20) || (clickPct < 1);
            const highMoney = (moneyPoints >= 55) || (riClipped >= 1.4);
            const lowMoney = (moneyPoints <= 35);
            const deliverabilityPoints = D;
            let score = Math.max(0, Math.min(100, moneyPoints + deliverabilityPoints + scPoints));
            let action: 'scale'|'keep'|'improve'|'pause' = 'improve';
            if (lowMoney && riskHigh) action = 'pause';
            else if (riskHigh && highMoney) action = 'keep';
            else if (score >= 75) action = 'scale';
            else if (score >= 60) action = 'keep';
            else if (score >= 40) action = 'improve';
            else action = 'pause';
            return {
              stepScore: {
                score,
                action,
                notes,
                pillars: {
                  money: { points: moneyPoints, riPts, ersPts, ri: riClipped, ers },
                  deliverability: { points: deliverabilityPoints, base: baseD, lowVolumeAdjusted, riskHigh },
                  confidence: { points: scPoints },
                },
                baselines: { flowRevenueTotal, storeRevenueTotal },
              }
            } as const;
          });

          // Add-step suggestion gates and estimate
          let addStepSuggestion: any = undefined;
          try {
            if (indicatorAvailable) {
              const last = steps[steps.length - 1];
              const lastScore = stepScores[stepScores.length - 1]?.stepScore;
              const lastScoreVal = Number(lastScore?.score) || 0;
              const volumeOk = last.total.emailsSent >= Math.max(500, Math.round(0.05 * (steps[0]?.total.emailsSent || 0)));
              // Recompute median RPE across steps for gating compatible with simplified model
              const rpesGate = steps.map(s => s.total.revenuePerEmail).filter((v: number) => isFinite(v) && v >= 0).sort((a:number,b:number)=>a-b);
              const rpeMedianGate = rpesGate.length ? (rpesGate.length % 2 ? rpesGate[(rpesGate.length-1)/2] : (rpesGate[rpesGate.length/2 - 1] + rpesGate[rpesGate.length/2]) / 2) : last.total.revenuePerEmail;
              const rpeOk = last.total.revenuePerEmail >= rpeMedianGate;
              const prev = steps.length > 1 ? steps[steps.length - 2] : null;
              const deltaRpeOk = prev ? (last.total.revenuePerEmail - prev.total.revenuePerEmail) >= 0 : true;
              const lastStepRevenue = last.total.totalRevenue;
              const flowRevenue = total.totalRevenue;
              const lastRevenuePct = flowRevenue > 0 ? (lastStepRevenue / flowRevenue) * 100 : 0;
              const absoluteRevenueOk = (lastStepRevenue >= 500) || (lastRevenuePct >= 5);
              const lastEmailDate = dm.getLastEmailDate();
              // Treat 'all' as Last 2 Years: presets and 'all' end at last; custom must end at last
              const endsAtLast = (dateRange as any) === 'custom'
                ? (customTo ? new Date(customTo).toDateString() === lastEmailDate.toDateString() : false)
                : true;
              // Compute days using resolved range so 'all' and presets are accurate
              const resolvedWindow = dm.getResolvedDateRange(dateRange as any, customFrom as any, customTo as any);
              const days = resolvedWindow ? Math.max(1, Math.ceil((resolvedWindow.endDate.getTime() - resolvedWindow.startDate.getTime()) / (1000*60*60*24)) + 1) : 0;
              const isRecentWindow = endsAtLast; // allow any range length if it ends at last record
              const suggested = (lastScoreVal >= 75) && rpeOk && deltaRpeOk && volumeOk && absoluteRevenueOk && isRecentWindow;
              const rpes = steps.map(s => s.total.revenuePerEmail).filter(v => isFinite(v) && v >= 0).sort((a,b)=>a-b);
              const idx = rpes.length ? Math.floor(0.25 * (rpes.length - 1)) : 0;
              let floor = rpes.length ? rpes[idx] : last.total.revenuePerEmail;
              if (!isFinite(floor)) floor = last.total.revenuePerEmail;
              const rpeFloor = Math.min(floor, last.total.revenuePerEmail);
              const projectedReach = Math.round((last.total.emailsSent || 0) * 0.5);
              const estimatedRevenue = Math.round(projectedReach * rpeFloor * 100) / 100;
              const reason = suggested ? (steps.length === 1 ? 'Strong RPE and healthy deliverability' : `S${steps.length} performing well; follow-up could add value`) : undefined;
              addStepSuggestion = {
                suggested,
                reason,
                horizonDays: isRecentWindow ? days : undefined,
                estimate: suggested ? { projectedReach, rpeFloor, estimatedRevenue, assumptions: { reachPctOfLastStep: 0.5, rpePercentile: 25, clampedToLastStepRpe: true } } : undefined,
                gates: { lastStepRevenue, lastStepRevenuePctOfFlow: lastRevenuePct, deliverabilityOk: true, volumeOk, rpeOk, deltaRpeOk, isRecentWindow }
              };
            }
          } catch {}

          // Merge scores into steps
          const stepsWithScores = steps.map((s, i) => ({
            ...s,
            stepScore: stepScores[i]?.stepScore
          }));
          const disabledReason = indicatorAvailable ? undefined : (hasDup ? 'duplicate_names' : (!orderOk ? 'order_inconsistent' : 'unknown'));
          return { flowName, total, steps: stepsWithScores, indicatorAvailable, disabledReason, notEnoughData, addStepSuggestion, baselines: { s1Sends, flowRevenueTotal, storeRevenueTotal }, config: { revenueLed: true } };
        }).filter(Boolean) as any[];
        if (flows.length) {
          json.flowStepAnalysis = { disclaimer, flows } as any;
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
