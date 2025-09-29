import type { FrequencyBucketAggregate } from "./campaignSendFrequency";
import type { SendVolumeGuidanceResult } from "./sendVolumeGuidance";
import type { ProcessedCampaign, ProcessedFlowEmail } from "../data/dataTypes";
import { computeCampaignSendFrequency } from "./campaignSendFrequency";
import { computeAudienceSizeBuckets } from "./audienceSizeBuckets";
import type { AudienceSizeBucket } from "./audienceSizeBuckets";
import { computeCampaignGapsAndLosses } from "./campaignGapsLosses";
import { computeCampaignDayPerformance } from "./campaignDayPerformance";
import { computeDeadWeightSavings } from "./deadWeightSavings";
import { computeSendVolumeGuidance } from "./sendVolumeGuidance";
import { DataManager } from "../data/dataManager";

export type ModuleSlug =
  | "sendVolumeImpact"
  | "campaignSendFrequency"
  | "audienceSizePerformance"
  | "campaignGapsLosses"
  | "campaignDayPerformance"
  | "flowStepAnalysis"
  | "subscribedVsNotSubscribed"
  | "engagementByProfileAge"
  | "inactivityRevenueDrain"
  | "deadWeightAudience";

export type OpportunityCategoryKey = "campaigns" | "flows" | "audience";

export interface OpportunitySummaryItem {
  module: ModuleSlug;
  label: string;
  scope?: string;
  amountAnnual: number;
  type: "lift" | "savings";
  category: OpportunityCategoryKey;
  percentOfCategory?: number;
  percentOfOverall?: number;
  metadata?: Record<string, unknown>;
}

export interface OpportunitySummaryCategory {
  key: OpportunityCategoryKey;
  label: string;
  color: "indigo" | "emerald" | "purple";
  totalAnnual: number;
  percentOfOverall: number;
  percentOfBaseline?: number | null;
  baselineAnnual?: number | null;
  baselineMonthly?: number | null;
  baselineWeekly?: number | null;
  items: OpportunitySummaryItem[];
  metadata?: Record<string, unknown>;
}

export interface OpportunitySummary {
  totals: {
    annual: number;
    monthly: number;
    weekly: number;
    percentOfEmailRevenue: number | null;
    emailRevenue: number;
    baselineAnnual: number | null;
    baselineMonthly: number | null;
    baselineWeekly: number | null;
  };
  categories: OpportunitySummaryCategory[];
  breakdown: OpportunitySummaryItem[];
}

export interface OpportunityEstimate {
  weekly?: number | null;
  monthly?: number | null;
  annual?: number | null;
  type: "increase" | "savings";
  description?: string;
  basis?: string;
}

export interface ModuleActionNote {
  module: ModuleSlug;
  scope?: string;
  title: string;
  message?: string;
  summary?: string;
  paragraphs?: string[];
  sample?: string | null;
  status?: string;
  estimatedImpact?: OpportunityEstimate | null;
  metadata?: Record<string, unknown>;
}

const CONSERVATIVE_FACTOR = 0.5; // halve theoretical uplifts when extrapolating
const FLOW_ADD_STEP_CONSERVATIVE_SHARE = 0.5;
const FLOW_MIN_TOTAL_SENDS = 2000;
const FLOW_MIN_STEP_EMAILS = 250;
const MIN_OPPORTUNITY_MONTHLY_GAIN = 500;

const weeksToMonthly = (weekly: number) => weekly * 4; // conservative 4 weeks/month
const weeksToAnnual = (weekly: number) => weekly * 52;

function sanitizeCurrency(value: number | null | undefined): number | null {
  if (!Number.isFinite(value || 0)) return null;
  const v = Number(value);
  return isNaN(v) ? null : v;
}

function roundCurrency(value: number | null | undefined): number | null {
  const v = sanitizeCurrency(value);
  if (v == null) return null;
  return Math.round(v * 100) / 100;
}

function makeEstimate(
  weeklyRaw: number | null | undefined,
  type: OpportunityEstimate["type"],
  description?: string,
  basis?: string
): OpportunityEstimate | null {
  const weekly = roundCurrency(weeklyRaw ?? null);
  if (weekly == null || weekly === 0) {
    return null;
  }
  const monthly = roundCurrency(weeksToMonthly(weekly));
  const annual = roundCurrency(weeksToAnnual(weekly));
  return {
    weekly,
    monthly,
    annual,
    type,
    description,
    basis,
  };
}

// ------------------------------
// Send Volume Impact
// ------------------------------

function buildSendVolumeSample(result: SendVolumeGuidanceResult): string | null {
  if (!result.sampleSize || !result.periodType) return null;
  const unit = result.periodType === "weekly" ? "week" : "month";
  const count = result.sampleSize;
  const plural = count === 1 ? unit : `${unit}s`;
  return `Based on ${count} ${plural} of ${result.channel} activity in this range.`;
}

export function buildSendVolumeNotes(params: {
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): ModuleActionNote[] {
  const dm = DataManager.getInstance();
  const base: Array<{ key: "campaigns" | "flows"; label: string }> = [
    { key: "campaigns", label: "Campaigns" },
    { key: "flows", label: "Flows" },
  ];
  return base.map(({ key, label }) => {
    const result = computeSendVolumeGuidance(key, { ...params }, dm);
    return {
      module: "sendVolumeImpact",
      scope: label.toLowerCase(),
      status: result.status,
      title:
        result.status === "insufficient"
          ? `Not enough data to evaluate ${label.toLowerCase()} volume`
          : label === "Campaigns"
          ? `${label}: ${result.status === "send-more" ? "Increase" : result.status === "send-less" ? "Reduce" : "Keep"} volume`
          : `${label}: ${result.status === "send-more" ? "Scale" : result.status === "send-less" ? "Trim" : "Maintain"} send volume`,
      message: result.message,
      sample: buildSendVolumeSample(result),
      estimatedImpact: null,
      metadata: {
        sampleSize: result.sampleSize,
        periodType: result.periodType,
        revenueScore: result.revenueScore,
        riskScore: result.riskScore,
        correlations: result.correlations,
      },
    } satisfies ModuleActionNote;
  });
}

// ------------------------------
// Campaign Send Frequency
// ------------------------------

interface SendFrequencyContext {
  campaigns: ProcessedCampaign[];
  weeksInRange: number;
}

function deriveSendFrequencyContext(
  campaigns: ProcessedCampaign[],
  dateRange: string,
  customFrom?: string,
  customTo?: string
): SendFrequencyContext {
  const dm = DataManager.getInstance();
  const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  let weeks = 0;
  if (resolved) {
    const ms = resolved.endDate.getTime() - resolved.startDate.getTime();
    weeks = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24 * 7)));
  }
  if (!weeks) {
    const uniqueWeeks = new Set<string>();
    for (const c of campaigns) {
      if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
      const d = new Date(c.sentDate);
      d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      uniqueWeeks.add(d.toISOString().slice(0, 10));
    }
    weeks = Math.max(1, uniqueWeeks.size);
  }
  return { campaigns, weeksInRange: weeks };
}

function pickFrequencyLift(
  buckets: FrequencyBucketAggregate[]
): {
  note: ModuleActionNote;
  baseline?: FrequencyBucketAggregate;
  target?: FrequencyBucketAggregate;
} {
  if (!buckets.length) {
    return {
      note: {
        module: "campaignSendFrequency",
        title: "Not enough data for a recommendation",
        message: "No campaigns were found in the selected date range.",
        sample: null,
      },
    };
  }

  const MIN_WEEKS = 4;
  const MIN_EMAILS = 2500;
  const eligible = buckets.filter(
    (b) => b.weeksCount >= MIN_WEEKS && b.sumEmails >= MIN_EMAILS
  );
  const totalWeeks = buckets.reduce((sum, b) => sum + b.weeksCount, 0);
  const sample = totalWeeks
    ? `Based on ${totalWeeks} ${totalWeeks === 1 ? "week" : "weeks"} of campaign data.`
    : null;

  if (!eligible.length) {
    return {
      note: {
        module: "campaignSendFrequency",
        status: "insufficient",
        title: "Not enough data for a recommendation",
        message:
          "Each cadence ran too few weeks or emails to compare. Extend testing before changing frequency.",
        sample,
      },
    };
  }

  const orderMap: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4+": 4 };
  const byWeeksDesc = [...eligible].sort((a, b) => {
    if (b.weeksCount !== a.weeksCount) return b.weeksCount - a.weeksCount;
    return orderMap[a.key] - orderMap[b.key];
  });
  const baseline = byWeeksDesc[0];
  const higher = eligible
    .filter((b) => orderMap[b.key] > orderMap[baseline.key])
    .sort((a, b) => orderMap[a.key] - orderMap[b.key]);
  const lower = eligible
    .filter((b) => orderMap[b.key] < orderMap[baseline.key])
    .sort((a, b) => orderMap[b.key] - orderMap[a.key]);

  const labelFor = (key: string) =>
    key === "4+" ? "4+ campaigns per week" : `${key} campaign${key === "1" ? "" : "s"} per week`;

  const buildLiftNote = (
    candidate: FrequencyBucketAggregate,
    direction: "more" | "less",
    lift: number
  ): ModuleActionNote => {
    const liftPct = lift === Infinity ? "from a low base" : `${(lift * 100).toFixed(1)}%`;
    const title =
      direction === "more"
        ? `Send ${labelFor(candidate.key)}`
        : `Shift to ${labelFor(candidate.key)}`;
    const message =
      direction === "more"
        ? `${labelFor(candidate.key)} weeks outperformed ${labelFor(
            baseline.key
          )} by ${liftPct} on weekly revenue. Engagement stayed within guardrails, so scale toward this cadence.`
        : `${labelFor(baseline.key)} underperformed ${labelFor(
            candidate.key
          )} by ${liftPct}. Drop cadence to recover revenue and reduce fatigue.`;
    return {
      module: "campaignSendFrequency",
      status: direction === "more" ? "send-more" : "send-less",
      title,
      message,
      sample,
      metadata: {
        baselineKey: baseline.key,
        targetKey: candidate.key,
        baselineWeekly: baseline.avgWeeklyRevenue,
        targetWeekly: candidate.avgWeeklyRevenue,
      },
    } satisfies ModuleActionNote;
  };

  for (const candidate of higher) {
    const lift = baseline.avgWeeklyRevenue
      ? (candidate.avgWeeklyRevenue - baseline.avgWeeklyRevenue) /
        baseline.avgWeeklyRevenue
      : candidate.avgWeeklyRevenue > 0
      ? Infinity
      : 0;
    if (lift > 0.05) {
      const note = buildLiftNote(candidate, "more", lift);
      return { note, baseline, target: candidate };
    }
  }

  for (const candidate of lower) {
    const lift = baseline.avgWeeklyRevenue
      ? (baseline.avgWeeklyRevenue - candidate.avgWeeklyRevenue) /
        baseline.avgWeeklyRevenue
      : 0;
    if (lift > 0.05) {
      const note = buildLiftNote(candidate, "less", lift);
      return { note, baseline, target: candidate };
    }
  }

  return {
    note: {
      module: "campaignSendFrequency",
      status: "keep-as-is",
      title: `Stay with ${labelFor(baseline.key)}`,
      message: `${labelFor(
        baseline.key
      )} is performing consistently. Keep gathering data before changing cadence.`,
      sample,
      metadata: {
        baselineKey: baseline.key,
      },
    },
    baseline,
    target: baseline,
  };
}

export function buildSendFrequencyNote(params: {
  campaigns: ProcessedCampaign[];
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): ModuleActionNote {
  const { campaigns, weeksInRange } = deriveSendFrequencyContext(
    params.campaigns,
    params.dateRange,
    params.customFrom,
    params.customTo
  );
  const buckets = computeCampaignSendFrequency(campaigns);
  const { note, baseline, target } = pickFrequencyLift(buckets);

  const estimatedImpact = (() => {
    if (note.status !== "send-more" || !baseline || !target) return null;

    const weeklyDeltaRaw =
      (target.avgWeeklyRevenue - baseline.avgWeeklyRevenue) * CONSERVATIVE_FACTOR;
    if (!weeklyDeltaRaw || weeklyDeltaRaw <= 0) return null;

    const estimate = makeEstimate(
      weeklyDeltaRaw,
      "increase",
      "Estimated incremental revenue from adopting recommended cadence",
      `${weeksInRange} weeks analysed`
    );

    if (!estimate?.monthly || estimate.monthly < MIN_OPPORTUNITY_MONTHLY_GAIN) {
      return null;
    }

    return estimate;
  })();

  note.estimatedImpact = estimatedImpact;

  return note;
}

// ------------------------------
// Audience Size Performance
// ------------------------------

interface AudienceSizeContext {
  buckets: AudienceSizeBucket[];
  lookbackWeeks: number;
  sampleCampaigns: number;
}

function buildAudienceSizeContext(
  campaigns: ProcessedCampaign[],
  dateRange: string,
  customFrom?: string,
  customTo?: string
): AudienceSizeContext {
  const { buckets, lookbackWeeks } = computeAudienceSizeBuckets(
    campaigns,
    dateRange,
    customFrom,
    customTo
  );
  const sampleCampaigns = buckets.reduce(
    (sum, b) => sum + (b.totalCampaigns || 0),
    0
  );
  return { buckets, lookbackWeeks, sampleCampaigns };
}

function pickAudienceSizeNote(
  context: AudienceSizeContext
): {
  note: ModuleActionNote;
  baseline?: AudienceSizeBucket;
  target?: AudienceSizeBucket;
} {
  const { buckets, sampleCampaigns, lookbackWeeks } = context;
  const sample = sampleCampaigns
    ? `Based on ${sampleCampaigns} ${
        sampleCampaigns === 1 ? "campaign" : "campaigns"
      } across ${Math.max(1, lookbackWeeks)} ${
        lookbackWeeks === 1 ? "week" : "weeks"
      }.`
    : null;

  if (!buckets.length) {
    return {
      note: {
        module: "audienceSizePerformance",
        title: "Not enough data for a recommendation",
        message: "No campaigns with measurable audience sizes were found.",
        sample,
      },
    };
  }

  const MIN_CAMPAIGNS = 3;
  const MIN_EMAILS = 10000;
  const qualified = buckets.filter(
    (b) => (b.totalCampaigns || 0) >= MIN_CAMPAIGNS && b.totalEmailsSent >= MIN_EMAILS
  );
  if (!qualified.length) {
    return {
      note: {
        module: "audienceSizePerformance",
        title: "Not enough data for a recommendation",
        message:
          "Each audience size bucket needs more campaigns before we can compare performance.",
        sample,
      },
    };
  }

  const best = [...qualified].sort((a, b) => b.totalRevenue - a.totalRevenue)[0];
  const safe = qualified.filter((b) => b !== best);

  const buildMessage = (bucket: AudienceSizeBucket, safeChoice = false) => {
    if (safeChoice) {
      return `${bucket.rangeLabel} recipients delivered reliable revenue with healthier engagement than larger blasts. Shift targeting toward this window.`;
    }
    return `${bucket.rangeLabel} recipients produced the most revenue while staying within deliverability guardrails. Scale campaign targeting toward this range.`;
  };

  const baseline = qualified.find((b) => b === best) || qualified[0];
  const target = safe.length ? safe[0] : best;

  return {
    note: {
      module: "audienceSizePerformance",
      title: `Focus on ${target.rangeLabel} recipients per campaign`,
      message: buildMessage(target, target !== best),
      sample,
      metadata: {
        baselineRange: baseline.rangeLabel,
        targetRange: target.rangeLabel,
        baselineRevenue: baseline.avgCampaignRevenue,
        targetRevenue: target.avgCampaignRevenue,
      },
    },
    baseline,
    target,
  };
}

export function buildAudienceSizeNote(params: {
  campaigns: ProcessedCampaign[];
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): ModuleActionNote {
  const context = buildAudienceSizeContext(
    params.campaigns,
    params.dateRange,
    params.customFrom,
    params.customTo
  );
  const { note, baseline, target } = pickAudienceSizeNote(context);
  if (baseline && target) {
    const totalCampaigns = context.buckets.reduce((sum, b) => sum + (b.totalCampaigns || 0), 0);
    const totalRevenue = context.buckets.reduce((sum, b) => sum + (b.totalRevenue || 0), 0);
    const overallAvg = totalCampaigns > 0 ? totalRevenue / totalCampaigns : 0;
    const weeklyCampaigns = context.lookbackWeeks > 0
      ? (target.totalCampaigns || 0) / context.lookbackWeeks
      : 0;
    const deltaPerCampaign = (target.avgCampaignRevenue - overallAvg) * CONSERVATIVE_FACTOR;
    const weeklyDelta = weeklyCampaigns > 0 && deltaPerCampaign > 0 ? deltaPerCampaign * weeklyCampaigns : 0;
    const estimate = makeEstimate(
      weeklyDelta,
      "increase",
      "Estimated incremental revenue by leaning into the recommended audience size",
      `${context.sampleCampaigns} campaigns analysed`
    );
    note.estimatedImpact =
      estimate && estimate.monthly && estimate.monthly >= MIN_OPPORTUNITY_MONTHLY_GAIN
        ? estimate
        : null;
  }
  return note;
}

// ------------------------------
// Flow Step Analysis (Add Step)
// ------------------------------

type FlowStepMetric = {
  sequencePosition: number;
  emailName?: string;
  emailsSent: number;
  revenue: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  conversionRate: number;
  unsubscribeRate: number;
  avgOrderValue: number;
  bounceRate: number;
  spamRate: number;
  revenuePerEmail: number;
  totalOrders: number;
  totalClicks: number;
};

type FlowStepScoreResult = {
  score: number;
  volumeInsufficient: boolean;
  notes: string[];
  pillars: {
    money: { points: number; ri: number; riPts: number; storeSharePts: number; storeShare: number };
    deliverability: { points: number; base: number; lowVolumeAdjusted: boolean; riskHigh: boolean };
    confidence: { points: number };
  };
  baselines: { flowRevenueTotal: number; storeRevenueTotal: number };
};

type FlowStepScoreContext = {
  results: FlowStepScoreResult[];
  context: { s1Sends: number; storeRevenueTotal: number; accountSendsTotal: number };
};

function buildFlowStepMetricsForNotes(
  flowName: string,
  flowEmails: ProcessedFlowEmail[],
  sequenceInfo: any
): FlowStepMetric[] {
  if (!sequenceInfo) return [];
  const metrics: FlowStepMetric[] = [];

  for (let idx = 0; idx < (sequenceInfo.sequenceLength || 0); idx++) {
    const stepIndex = idx + 1;
    const messageId = sequenceInfo.messageIds?.[idx];
    let stepEmails = flowEmails.filter((email) => email.flowName === flowName && email.flowMessageId === messageId);
    if (!stepEmails.length) {
      stepEmails = flowEmails.filter((email) => email.flowName === flowName && Number(email.sequencePosition) === stepIndex);
    }

    if (!stepEmails.length) {
      metrics.push({
        sequencePosition: stepIndex,
        emailName: sequenceInfo.emailNames?.[idx] || `Step ${stepIndex}`,
        emailsSent: 0,
        revenue: 0,
        openRate: 0,
        clickRate: 0,
        clickToOpenRate: 0,
        conversionRate: 0,
        unsubscribeRate: 0,
        avgOrderValue: 0,
        bounceRate: 0,
        spamRate: 0,
        revenuePerEmail: 0,
        totalOrders: 0,
        totalClicks: 0,
      });
      continue;
    }

    const totalEmails = stepEmails.reduce((sum, email) => sum + (email.emailsSent || 0), 0);
    const totalRevenue = stepEmails.reduce((sum, email) => sum + (email.revenue || 0), 0);
    const totalOrders = stepEmails.reduce((sum, email) => sum + (email.totalOrders || 0), 0);
    const totalOpens = stepEmails.reduce((sum, email) => sum + (email.uniqueOpens || 0), 0);
    const totalClicks = stepEmails.reduce((sum, email) => sum + (email.uniqueClicks || 0), 0);
    const totalUnsubs = stepEmails.reduce((sum, email) => sum + (email.unsubscribesCount || 0), 0);
    const totalBounces = stepEmails.reduce((sum, email) => sum + (email.bouncesCount || 0), 0);
    const totalSpam = stepEmails.reduce((sum, email) => sum + (email.spamComplaintsCount || 0), 0);

    const openRate = totalEmails > 0 ? (totalOpens / totalEmails) * 100 : 0;
    const clickRate = totalEmails > 0 ? (totalClicks / totalEmails) * 100 : 0;
    const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
    const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
    const unsubscribeRate = totalEmails > 0 ? (totalUnsubs / totalEmails) * 100 : 0;
    const bounceRate = totalEmails > 0 ? (totalBounces / totalEmails) * 100 : 0;
    const spamRate = totalEmails > 0 ? (totalSpam / totalEmails) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const revenuePerEmail = totalEmails > 0 ? totalRevenue / totalEmails : 0;

    const emailName = sequenceInfo.emailNames?.[idx]
      || stepEmails[stepEmails.length - 1]?.emailName
      || `Step ${stepIndex}`;

    metrics.push({
      sequencePosition: stepIndex,
      emailName,
      emailsSent: totalEmails,
      revenue: totalRevenue,
      openRate,
      clickRate,
      clickToOpenRate,
      conversionRate,
      unsubscribeRate,
      avgOrderValue,
      bounceRate,
      spamRate,
      revenuePerEmail,
      totalOrders,
      totalClicks,
    });
  }

  return metrics;
}

function computeFlowStepScoresForNotes(
  flowStepMetrics: FlowStepMetric[],
  dm: DataManager,
  dateRange: string,
  customFrom?: string,
  customTo?: string
): FlowStepScoreContext {
  if (!flowStepMetrics.length) {
    return { results: [], context: { s1Sends: 0, storeRevenueTotal: 0, accountSendsTotal: 0 } };
  }

  const s1Sends = flowStepMetrics[0]?.emailsSent || 0;
  const flowRevenueTotal = flowStepMetrics.reduce((sum, s) => sum + (s.revenue || 0), 0);
  const totalFlowSendsInWindow = flowStepMetrics.reduce((sum, s) => sum + (s.emailsSent || 0), 0);

  const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  const start = resolved?.startDate ?? new Date(0);
  const end = resolved?.endDate ?? new Date();
  const accountAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), dm.getFlowEmails(), start, end);
  const storeRevenueTotal = accountAgg.totalRevenue || 0;
  const accountSendsTotal = accountAgg.emailsSent || 0;

  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

  const storeShareToPoints = (share: number): number => {
    if (!isFinite(share) || share <= 0) return 5;
    const pct = share * 100;
    if (pct >= 5) return 35;
    if (pct >= 3) return 30;
    if (pct >= 2) return 25;
    if (pct >= 1) return 20;
    if (pct >= 0.5) return 15;
    if (pct >= 0.25) return 10;
    return 5;
  };

  const rpesForBaseline = flowStepMetrics
    .filter((s) => (s.emailsSent || 0) > 0)
    .map((s) => {
      const emails = s.emailsSent || 0;
      const revenue = s.revenue || 0;
      return emails > 0 ? revenue / emails : 0;
    })
    .filter((v) => isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  const midIndex = Math.floor(rpesForBaseline.length / 2);
  let medianRPE = rpesForBaseline.length
    ? (rpesForBaseline.length % 2 === 0
        ? (rpesForBaseline[midIndex - 1] + rpesForBaseline[midIndex]) / 2
        : rpesForBaseline[midIndex])
    : 0;

  if (flowStepMetrics.length === 1) {
    try {
      const flowsOnlyAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), start, end);
      medianRPE = flowsOnlyAgg.revenuePerEmail || medianRPE;
    } catch {
      /* ignore */
    }
  }

  const results: FlowStepScoreResult[] = [];

  flowStepMetrics.forEach((s) => {
    const emailsSent = s.emailsSent || 0;
    const volumeSufficient = emailsSent >= FLOW_MIN_STEP_EMAILS;
    const notes: string[] = [];
    const clampScore = (val: number, max: number) => clamp(val, 0, max);

    const rpe = emailsSent > 0 ? (s.revenue || 0) / emailsSent : 0;
    const riRaw = medianRPE > 0 ? rpe / medianRPE : 0;
    const riClipped = clamp(riRaw, 0, 2.0);
    const riPts = 35 * (riClipped / 2);
    const storeShare = storeRevenueTotal > 0 ? (s.revenue / storeRevenueTotal) : 0;
    const storeSharePts = clamp(storeShareToPoints(storeShare), 0, 35);
    if (riClipped >= 1.4) notes.push('High Revenue Index');
    if (storeRevenueTotal <= 0) notes.push('No store revenue in window');
    const moneyPoints = clampScore(riPts + storeSharePts, 70);

    const unsub = s.unsubscribeRate;
    const spam = s.spamRate;
    const bounce = s.bounceRate;
    const openPct = s.openRate;
    const clickPct = s.clickRate;

    const spamPts = (() => {
      if (spam < 0.05) return 7;
      if (spam < 0.10) return 6;
      if (spam < 0.20) return 3;
      if (spam < 0.30) return 1;
      return 0;
    })();
    const bouncePts = (() => {
      if (bounce < 1.0) return 7;
      if (bounce < 2.0) return 6;
      if (bounce < 3.0) return 3;
      if (bounce < 5.0) return 1;
      return 0;
    })();
    const unsubPts = (() => {
      if (unsub < 0.20) return 3;
      if (unsub < 0.50) return 2.5;
      if (unsub < 1.00) return 1;
      return 0;
    })();
    const openPts = (() => {
      if (openPct >= 30) return 2;
      if (openPct >= 20) return 1;
      return 0;
    })();
    const clickPts = (() => {
      if (clickPct > 3) return 1;
      if (clickPct >= 1) return 0.5;
      return 0;
    })();

    const baseD = clamp(spamPts + bouncePts + unsubPts + openPts + clickPts, 0, 20);
    const sendShareOfAccount = accountSendsTotal > 0 ? (emailsSent / accountSendsTotal) : 0;
    const applyVolumeAdj = baseD < 15 && sendShareOfAccount > 0 && sendShareOfAccount < 0.005;
    const volumeFactor = applyVolumeAdj ? (1 - (sendShareOfAccount / 0.005)) : 0;
    const adjustedD = applyVolumeAdj ? (baseD + (20 - baseD) * volumeFactor) : baseD;
    const lowVolumeAdjusted = applyVolumeAdj;
    const deliverabilityPoints = clamp(adjustedD, 0, 20);

    const scPoints = volumeSufficient ? clamp(Math.floor(emailsSent / 100), 0, 10) : 0;

    const riskHigh = spam >= 0.30 || unsub > 1.0 || bounce >= 5.0 || openPct < 20 || clickPct < 1;
    const highMoney = moneyPoints >= 55 || riClipped >= 1.4;
    const lowMoney = moneyPoints <= 35;

    let score = clamp(moneyPoints + deliverabilityPoints + scPoints, 0, 100);
    let action: 'scale' | 'keep' | 'improve' | 'pause' | 'insufficient' = 'improve';
    if (lowMoney && riskHigh) action = 'pause';
    else if (riskHigh && highMoney) action = 'keep';
    else if (score >= 75) action = 'scale';
    else if (score >= 60) action = 'keep';
    else if (score >= 40) action = 'improve';
    else action = 'pause';

    const flowShare = flowRevenueTotal > 0 ? (s.revenue / flowRevenueTotal) : 0;
    if (!riskHigh && action === 'pause' && (s.revenue >= 5000 || flowShare >= 0.10)) {
      action = 'keep';
      notes.push('High revenue guardrail');
    }

    if (!volumeSufficient) {
      action = 'insufficient';
      notes.push('Needs ≥250 sends for reliable read');
    }

    results.push({
      score,
      volumeInsufficient: !volumeSufficient,
      notes,
      pillars: {
        money: { points: moneyPoints, ri: riClipped, riPts, storeSharePts, storeShare },
        deliverability: { points: deliverabilityPoints, base: baseD, lowVolumeAdjusted, riskHigh },
        confidence: { points: scPoints },
      },
      baselines: { flowRevenueTotal, storeRevenueTotal },
    });
  });

  return {
    results,
    context: { s1Sends, storeRevenueTotal, accountSendsTotal },
  };
}

function computeAddStepSuggestionForNotes(
  flowStepMetrics: FlowStepMetric[],
  scoreContext: FlowStepScoreContext,
  dm: DataManager,
  dateRange: string,
  customFrom?: string,
  customTo?: string
) {
  if (!flowStepMetrics.length) return null;

  const totalFlowSends = flowStepMetrics.reduce((sum, s) => sum + (s.emailsSent || 0), 0);
  if (totalFlowSends < FLOW_MIN_TOTAL_SENDS) return null;

  const lastIdx = flowStepMetrics.length - 1;
  const last = flowStepMetrics[lastIdx];
  const s1Sends = scoreContext.context.s1Sends;
  const lastRes = scoreContext.results[lastIdx];
  const lastScoreVal = Number(lastRes?.score) || 0;
  const volumeOk = last.emailsSent >= Math.max(FLOW_MIN_STEP_EMAILS, Math.round(0.05 * s1Sends));

  const rpesAll = flowStepMetrics
    .map((s) => s.revenuePerEmail)
    .filter((v) => isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const rpeMedian = rpesAll.length
    ? (rpesAll.length % 2
        ? rpesAll[(rpesAll.length - 1) / 2]
        : (rpesAll[rpesAll.length / 2 - 1] + rpesAll[rpesAll.length / 2]) / 2)
    : last.revenuePerEmail;

  const prev = lastIdx > 0 ? flowStepMetrics[lastIdx - 1] : null;
  const deltaRpeOk = prev ? (last.revenuePerEmail - prev.revenuePerEmail) >= 0 : true;
  const lastStepRevenue = last.revenue || 0;
  const flowRevenue = flowStepMetrics.reduce((sum, s) => sum + (s.revenue || 0), 0);
  const lastRevenuePct = flowRevenue > 0 ? (lastStepRevenue / flowRevenue) * 100 : 0;
  const absoluteRevenueOk = lastStepRevenue >= 500 || lastRevenuePct >= 5;

  const lastEmailDate = dm.getLastEmailDate();
  const endsAtLast = dateRange === 'custom'
    ? (customTo ? new Date(customTo).toDateString() === lastEmailDate.toDateString() : false)
    : true;
  const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  const days = resolved ? Math.max(1, Math.ceil((resolved.endDate.getTime() - resolved.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1) : 0;
  const isRecentWindow = endsAtLast;

  const rpeOk = last.revenuePerEmail >= rpeMedian;
  const suggested = lastScoreVal >= 75 && rpeOk && deltaRpeOk && volumeOk && absoluteRevenueOk && isRecentWindow;

  if (!suggested) return null;

  const rpes = flowStepMetrics
    .map((s) => s.revenuePerEmail)
    .filter((v) => isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const idx = rpes.length ? Math.floor(0.25 * (rpes.length - 1)) : 0;
  let floor = rpes.length ? rpes[idx] : last.revenuePerEmail;
  if (!isFinite(floor)) floor = last.revenuePerEmail;
  const rpeFloor = Math.min(floor, last.revenuePerEmail);
  const projectedReach = Math.round(last.emailsSent * FLOW_ADD_STEP_CONSERVATIVE_SHARE);
  const estimatedRevenue = Math.round(projectedReach * rpeFloor * 100) / 100;

  const reason = flowStepMetrics.length === 1
    ? 'Strong RPE and healthy deliverability'
    : `Step ${last.sequencePosition} is performing well; a follow-up could add value`;

  return {
    suggested: true,
    reason,
    horizonDays: isRecentWindow ? days : undefined,
    estimate: {
      projectedReach,
      rpeFloor,
      estimatedRevenue,
    },
    lastStepLabel: last.emailName || `Step ${last.sequencePosition}`,
  };
}

export function buildFlowAddStepNotes(params: {
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): ModuleActionNote[] {
  const dm = DataManager.getInstance();
  const resolved = dm.getResolvedDateRange(params.dateRange, params.customFrom, params.customTo);
  const start = resolved?.startDate ?? null;
  const end = resolved?.endDate ?? null;

  const flowsAll = dm
    .getFlowEmails()
    .filter((email) => (email.status || '').toLowerCase() === 'live');

  const flowGroups = new Map<string, ProcessedFlowEmail[]>();
  for (const email of flowsAll) {
    if (!email.flowName) continue;
    const sentDate = email.sentDate instanceof Date ? email.sentDate : new Date(email.sentDate);
    if (start && sentDate < start) continue;
    if (end && sentDate > end) continue;
    const arr = flowGroups.get(email.flowName) || [];
    arr.push(email);
    flowGroups.set(email.flowName, arr);
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const notes: ModuleActionNote[] = [];

  for (const [flowName, emails] of flowGroups.entries()) {
    if (!emails.length) continue;
    const sequenceInfo = dm.getFlowSequenceInfo(flowName);
    if (!sequenceInfo) continue;

    const metrics = buildFlowStepMetricsForNotes(flowName, emails, sequenceInfo);
    const totalFlowSends = metrics.reduce((sum, m) => sum + (m.emailsSent || 0), 0);
    if (!metrics.length || totalFlowSends < FLOW_MIN_TOTAL_SENDS) continue;

    const scoreContext = computeFlowStepScoresForNotes(metrics, dm, params.dateRange, params.customFrom, params.customTo);
    const suggestion = computeAddStepSuggestionForNotes(metrics, scoreContext, dm, params.dateRange, params.customFrom, params.customTo);
    if (!suggestion || !suggestion.estimate?.estimatedRevenue) continue;

    const rangeStart = start ? start : new Date(Math.min(...emails.map((e) => (e.sentDate instanceof Date ? e.sentDate.getTime() : new Date(e.sentDate).getTime()))));
    const rangeEnd = end ? end : new Date(Math.max(...emails.map((e) => (e.sentDate instanceof Date ? e.sentDate.getTime() : new Date(e.sentDate).getTime()))));
    const days = Math.max(1, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY) + 1);
    const weeksObserved = Math.max(1, days / 7);
    const weeklyGain = suggestion.estimate.estimatedRevenue / weeksObserved;
    if (!Number.isFinite(weeklyGain) || weeklyGain <= 0) continue;

    const noteImpact = makeEstimate(weeklyGain, "increase", "Estimated revenue from extending this flow", `Flow: ${flowName}`);
    if (!noteImpact) continue;

    const sample = `Based on ${totalFlowSends.toLocaleString('en-US')} emails in ${flowName} during the selected range.`;

    notes.push({
      module: "flowStepAnalysis",
      scope: flowName,
      title: `Add a follow-up to ${flowName}`,
      message: suggestion.reason,
      sample,
      estimatedImpact: noteImpact,
      metadata: {
        flowName,
        weeklyGain,
        lastStepLabel: suggestion.lastStepLabel,
      },
    });
  }

  return notes;
}

// ------------------------------
// Gap Week Elimination
// ------------------------------

export function buildCampaignGapsNote(params: {
  campaigns: ProcessedCampaign[];
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): ModuleActionNote {
  const dm = DataManager.getInstance();
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;
  if (params.dateRange === "custom" && params.customFrom && params.customTo) {
    rangeStart = new Date(`${params.customFrom}T00:00:00`);
    rangeEnd = new Date(`${params.customTo}T23:59:59`);
  } else {
    const resolved = dm.getResolvedDateRange(
      params.dateRange,
      params.customFrom,
      params.customTo
    );
    rangeStart = resolved?.startDate ?? null;
    rangeEnd = resolved?.endDate ?? null;
  }
  if (!rangeStart || !rangeEnd) {
    return {
      module: "campaignGapsLosses",
      title: "Not enough data for a recommendation",
      message: "The selected range does not contain campaigns.",
    };
  }
  const result = computeCampaignGapsAndLosses({
    campaigns: params.campaigns,
    flows: [],
    rangeStart,
    rangeEnd,
  });

  const sample = result.weeksInRangeFull
    ? `Based on ${result.weeksInRangeFull} full ${
        result.weeksInRangeFull === 1 ? "week" : "weeks"
      }.`
    : null;

  if (result.zeroCampaignSendWeeks <= 0) {
    return {
      module: "campaignGapsLosses",
      title: "Keep weekly cadence humming",
      message:
        "You shipped campaigns every full week in this range. Maintain a backup promo or automation so coverage stays intact when volume shifts.",
      sample,
    };
  }

  const baseLost = sanitizeCurrency(result.estimatedLostRevenue) ?? 0;
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const rangeDays = Math.max(1, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY) + 1);
  const coverageWeeks = result.weeksWithCampaignsSent || 0;
  const coverageFactor = result.weeksInRangeFull > 0 ? coverageWeeks / result.weeksInRangeFull : 0;
  const rangeFactor = rangeDays > 0 ? 365 / Math.min(rangeDays, 365) : 1;
  const adjustedLost = baseLost * rangeFactor * Math.max(0, coverageFactor);
  const annualEstimate = roundCurrency(adjustedLost);
  const monthlyEstimate = annualEstimate != null ? roundCurrency((annualEstimate || 0) / 12) : null;
  const weeklyEstimate = annualEstimate != null ? roundCurrency((annualEstimate || 0) / 52) : null;

  const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const annualDisplay = annualEstimate != null ? currencyFormatter.format(annualEstimate) : null;

  return {
    module: "campaignGapsLosses",
    title: `Fill ${result.zeroCampaignSendWeeks.toLocaleString()} missed ${
      result.zeroCampaignSendWeeks === 1 ? "week" : "weeks"
    } to claw back revenue`,
    message: annualDisplay
      ? `Skipping ${result.zeroCampaignSendWeeks} ${
          result.zeroCampaignSendWeeks === 1 ? "week" : "weeks"
        } could be costing roughly ${annualDisplay} per year. Build a backup send to protect that revenue.`
      : `Skipping ${result.zeroCampaignSendWeeks} ${
          result.zeroCampaignSendWeeks === 1 ? "week" : "weeks"
        } likely costs meaningful revenue. Build a backup send to protect that revenue.`,
    sample,
    estimatedImpact: annualEstimate != null
      ? {
          weekly: weeklyEstimate,
          monthly: monthlyEstimate,
          annual: annualEstimate,
          type: "increase",
          description: "Estimated revenue recovered by eliminating zero-send weeks",
          basis: `${Math.min(rangeDays, 365)} days analysed`,
        }
      : null,
    metadata: {
      estimatedLostRevenue: baseLost,
      adjustedLost: annualEstimate,
      coverageFactor,
      rangeFactor,
    },
  };
}

// ------------------------------
// Campaign Day Performance
// ------------------------------

export function buildCampaignDayNote(params: {
  campaigns: ProcessedCampaign[];
  rangeStart: Date;
  rangeEnd: Date;
  frequencyRecommendation?: number;
  dateRangeLabel?: string;
}): ModuleActionNote {
  const { aggregates, recommendation } = computeCampaignDayPerformance(params);

  const sample = recommendation.sampleLine ?? null;

  const top = aggregates
    .filter((a) => a.eligible)
    .sort((a, b) => b.revenue - a.revenue)[0];
  const averageRevenue = aggregates.reduce((sum, a) => sum + (a.revenue || 0), 0);
  const averageWeeks = aggregates.reduce((sum, a) => sum + (a.campaigns || 0), 0);
  const weeklyDelta =
    top && averageWeeks
      ? ((top.revenue || 0) - averageRevenue / Math.max(1, aggregates.length)) /
        Math.max(1, aggregates.length) *
        CONSERVATIVE_FACTOR
      : 0;

  return {
    module: "campaignDayPerformance",
    title: recommendation.headline,
    summary: recommendation.body?.[0],
    paragraphs: recommendation.body?.slice(1) ?? [],
    sample,
    estimatedImpact: makeEstimate(
      weeklyDelta,
      "increase",
      "Estimated revenue gain from prioritising the recommended send day",
      params.dateRangeLabel
    ),
    metadata: {
      recommendedDays: recommendation.recommendedDays,
    },
  };
}

// ------------------------------
// Dead Weight Audience Savings
// ------------------------------

export function buildDeadWeightNote(): ModuleActionNote | null {
  const summary = computeDeadWeightSavings();
  if (!summary) return null;
  const {
    currentSubscribers,
    deadWeightCount,
    monthlySavings,
    annualSavings,
    projectedSubscribers,
    usedCustomPricingEstimate,
    currentMonthlyPrice,
    projectedMonthlyPrice,
  } = summary;

  const deadWeightPct = currentSubscribers > 0 ? (deadWeightCount / currentSubscribers) * 100 : null;

  const monthly = sanitizeCurrency(monthlySavings) ?? null;
  const annual = sanitizeCurrency(annualSavings) ?? (monthly != null ? monthly * 12 : null);
  const weekly = monthly != null ? monthly / 4 : annual != null ? annual / 52 : null;

  return {
    module: "deadWeightAudience",
    title: "Suppress dead-weight subscribers to reduce Klaviyo costs",
    message: `Suppressing ${deadWeightCount.toLocaleString()} inactive profiles would trim the list from ${currentSubscribers.toLocaleString()} to ${projectedSubscribers.toLocaleString()} and reduce Klaviyo spend.`,
    estimatedImpact: weekly != null || monthly != null || annual != null
      ? {
          weekly: roundCurrency(weekly),
          monthly: roundCurrency(monthly),
          annual: roundCurrency(annual),
          type: "savings",
          description: usedCustomPricingEstimate
            ? "Savings estimate hidden for custom pricing tiers"
            : "Suppression-driven subscription savings",
        }
      : null,
    metadata: {
      currentSubscribers,
      deadWeightCount,
      projectedSubscribers,
      usedCustomPricingEstimate,
      currentMonthlyPrice,
      projectedMonthlyPrice,
      deadWeightPct,
    },
  };
}

export function computeOpportunitySummary(params: {
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): OpportunitySummary {
  const dm = DataManager.getInstance();
  const campaigns = dm.getCampaigns();

  const collectedNotes: ModuleActionNote[] = [];

  if (campaigns.length) {
    collectedNotes.push(
      buildSendFrequencyNote({
        campaigns,
        dateRange: params.dateRange,
        customFrom: params.customFrom,
        customTo: params.customTo,
      })
    );

    collectedNotes.push(
      buildAudienceSizeNote({
        campaigns,
        dateRange: params.dateRange,
        customFrom: params.customFrom,
        customTo: params.customTo,
      })
    );

    collectedNotes.push(
      buildCampaignGapsNote({
        campaigns,
        dateRange: params.dateRange,
        customFrom: params.customFrom,
        customTo: params.customTo,
      })
    );
  }

  collectedNotes.push(
    ...buildFlowAddStepNotes({
      dateRange: params.dateRange,
      customFrom: params.customFrom,
      customTo: params.customTo,
    })
  );

  const deadWeightNote = buildDeadWeightNote();
  if (deadWeightNote) collectedNotes.push(deadWeightNote);

  const resolveRange = () => {
    const resolved = dm.getResolvedDateRange(params.dateRange, params.customFrom, params.customTo);
    let start = resolved?.startDate || null;
    let end = resolved?.endDate || null;
    const lastEmail = dm.getLastEmailDate?.();
    const fallbackEnd = lastEmail ? new Date(lastEmail) : new Date();
    if (!end) {
      end = new Date(fallbackEnd);
    }
    if (!start) {
      start = new Date(end);
      start.setMonth(start.getMonth() - 6);
    }
    return { start, end };
  };

  const { start, end } = resolveRange();

  const overallAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), dm.getFlowEmails(), start, end);
  const campaignAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), [], start, end);
  const flowAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), start, end);

  const emailRevenue = overallAgg.totalRevenue || 0;
  const campaignRevenue = campaignAgg.totalRevenue || 0;
  const flowRevenue = flowAgg.totalRevenue || 0;

  const baselineEnd = new Date(end);
  const baselineStart = new Date(baselineEnd);
  baselineStart.setDate(baselineStart.getDate() - 364);

  const baselineCampaignAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), [], baselineStart, baselineEnd);
  const baselineFlowAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), baselineStart, baselineEnd);
  const baselineCampaignRevenueRaw = baselineCampaignAgg.totalRevenue || 0;
  const baselineFlowRevenueRaw = baselineFlowAgg.totalRevenue || 0;
  const baselineCampaignRevenue = baselineCampaignRevenueRaw > 0 ? baselineCampaignRevenueRaw : null;
  const baselineFlowRevenue = baselineFlowRevenueRaw > 0 ? baselineFlowRevenueRaw : null;
  const baselineEmailRevenueRaw = baselineCampaignRevenueRaw + baselineFlowRevenueRaw;
  const baselineEmailRevenue = baselineEmailRevenueRaw > 0 ? baselineEmailRevenueRaw : null;

  const toAnnual = (impact?: OpportunityEstimate | null): number => {
    if (!impact) return 0;
    if (typeof impact.annual === "number") return Math.max(0, impact.annual);
    if (typeof impact.monthly === "number") return Math.max(0, impact.monthly * 12);
    if (typeof impact.weekly === "number") return Math.max(0, impact.weekly * 52);
    return 0;
  };

  const moduleMap: Partial<Record<ModuleSlug, {
    category: OpportunityCategoryKey;
    label: (note: ModuleActionNote) => string;
    type: "lift" | "savings";
  }>> = {
    campaignSendFrequency: {
      category: "campaigns",
      label: () => "Send Frequency Optimization",
      type: "lift",
    },
    audienceSizePerformance: {
      category: "campaigns",
      label: () => "Campaign Performance by Audience Size",
      type: "lift",
    },
    campaignGapsLosses: {
      category: "campaigns",
      label: () => "Gap Week Elimination",
      type: "lift",
    },
    flowStepAnalysis: {
      category: "flows",
      label: (note) => note.metadata?.flowName ? `Add Step — ${String(note.metadata.flowName)}` : `Flow Step Optimization`,
      type: "lift",
    },
    deadWeightAudience: {
      category: "audience",
      label: () => "Dead Weight Audience",
      type: "savings",
    },
  };

  const categoryMeta: Record<OpportunityCategoryKey, { label: string; color: "indigo" | "emerald" | "purple"; baselineAnnual: number | null }> = {
    campaigns: { label: "Campaigns", color: "indigo", baselineAnnual: baselineCampaignRevenue },
    flows: { label: "Flows", color: "emerald", baselineAnnual: baselineFlowRevenue },
    audience: { label: "Audience", color: "purple", baselineAnnual: null },
  };

  type MutableCategory = {
    key: OpportunityCategoryKey;
    label: string;
    color: "indigo" | "emerald" | "purple";
    totalAnnual: number;
    baselineAnnual: number | null;
    items: OpportunitySummaryItem[];
    metadata?: Record<string, unknown>;
  };

  const categoriesMap = new Map<OpportunityCategoryKey, MutableCategory>();
  const ensureCategory = (key: OpportunityCategoryKey): MutableCategory => {
    if (!categoriesMap.has(key)) {
      const meta = categoryMeta[key];
      categoriesMap.set(key, {
        key,
        label: meta.label,
        color: meta.color,
        baselineAnnual: meta.baselineAnnual,
        totalAnnual: 0,
        items: [],
        metadata: {},
      });
    }
    return categoriesMap.get(key)!;
  };

  const breakdown: OpportunitySummaryItem[] = [];

  for (const note of collectedNotes) {
    const meta = moduleMap[note.module];
    if (!meta) continue;
    const amountAnnual = toAnnual(note.estimatedImpact);
    if (!amountAnnual || amountAnnual <= 0) continue;

    const category = ensureCategory(meta.category);
    const item: OpportunitySummaryItem = {
      module: note.module,
      label: meta.label(note),
      scope: note.scope,
      amountAnnual,
      type: meta.type,
      category: meta.category,
      percentOfCategory: 0,
      percentOfOverall: 0,
      metadata: note.metadata || undefined,
    };

    breakdown.push(item);
    category.items.push(item);
    category.totalAnnual += amountAnnual;

    if (meta.category === "audience" && note.metadata) {
      category.metadata = {
        ...(category.metadata || {}),
        ...note.metadata,
      };
    }
  }

  const categories: OpportunitySummaryCategory[] = Array.from(categoriesMap.values())
    .filter((cat) => cat.totalAnnual > 0)
    .map((cat) => {
      let percentOfBaseline: number | null = null;
      if (cat.key === "campaigns" && cat.baselineAnnual) {
        percentOfBaseline = cat.baselineAnnual > 0 ? (cat.totalAnnual / cat.baselineAnnual) * 100 : null;
      } else if (cat.key === "flows" && cat.baselineAnnual) {
        percentOfBaseline = cat.baselineAnnual > 0 ? (cat.totalAnnual / cat.baselineAnnual) * 100 : null;
      } else if (cat.key === "audience" && cat.metadata) {
        const current = Number((cat.metadata as any).currentMonthlyPrice) || 0;
        const projected = Number((cat.metadata as any).projectedMonthlyPrice) || 0;
        percentOfBaseline = current > 0 ? ((current - projected) / current) * 100 : null;
      }

      return {
        key: cat.key,
        label: cat.label,
        color: cat.color,
        totalAnnual: cat.totalAnnual,
        percentOfOverall: 0,
        percentOfBaseline,
        baselineAnnual: cat.baselineAnnual,
        baselineMonthly: null,
        baselineWeekly: null,
        items: cat.items,
        metadata: cat.metadata,
      } satisfies OpportunitySummaryCategory;
    });

  const totalAnnual = categories.reduce((sum, cat) => sum + cat.totalAnnual, 0);
  const totalMonthly = totalAnnual / 12;
  const totalWeekly = totalAnnual / 52;
  const percentOfEmailRevenue = baselineEmailRevenue && baselineEmailRevenue > 0 ? (totalAnnual / baselineEmailRevenue) * 100 : null;

  categories.forEach((cat) => {
    cat.percentOfOverall = totalAnnual > 0 ? (cat.totalAnnual / totalAnnual) * 100 : 0;
    if (cat.baselineAnnual != null) {
      cat.baselineMonthly = cat.baselineAnnual / 12;
      cat.baselineWeekly = cat.baselineAnnual / 52;
    }
    cat.items.forEach((item) => {
      item.percentOfCategory = cat.totalAnnual > 0 ? (item.amountAnnual / cat.totalAnnual) * 100 : 0;
      item.percentOfOverall = totalAnnual > 0 ? (item.amountAnnual / totalAnnual) * 100 : 0;
    });
  });

  breakdown.forEach((item) => {
    const category = categories.find((cat) => cat.key === item.category);
    if (!category) return;
    item.percentOfCategory = category.totalAnnual > 0 ? (item.amountAnnual / category.totalAnnual) * 100 : 0;
    item.percentOfOverall = totalAnnual > 0 ? (item.amountAnnual / totalAnnual) * 100 : 0;
  });

  return {
    totals: {
      annual: totalAnnual,
      monthly: totalMonthly,
      weekly: totalWeekly,
      percentOfEmailRevenue,
      emailRevenue,
      baselineAnnual: baselineEmailRevenue,
      baselineMonthly: baselineEmailRevenue != null ? baselineEmailRevenue / 12 : null,
      baselineWeekly: baselineEmailRevenue != null ? baselineEmailRevenue / 52 : null,
    },
    categories,
    breakdown,
  };
}

// Remaining modules (flowStepAnalysis, subscribed vs not subscribed, engagement by profile age, inactivity revenue drain, dead weight audience)
// will be implemented incrementally where needed by dashboard and export builder.
