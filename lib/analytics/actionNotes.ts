import type { FrequencyBucketAggregate } from "./campaignSendFrequency";
import type { SendVolumeGuidanceResult } from "./sendVolumeGuidance";
import type { ProcessedCampaign } from "../data/dataTypes";
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

  if (baseline && target) {
    const weeklyDelta =
      (target.avgWeeklyRevenue - baseline.avgWeeklyRevenue) * CONSERVATIVE_FACTOR;
    note.estimatedImpact = makeEstimate(
      weeklyDelta,
      "increase",
      "Estimated incremental revenue from adopting recommended cadence",
      `${weeksInRange} weeks analysed`
    );
  }

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
    const weeklyCampaigns = context.lookbackWeeks
      ? (target.totalCampaigns || 0) / context.lookbackWeeks
      : 0;
    const deltaPerCampaign =
      (target.avgCampaignRevenue - baseline.avgCampaignRevenue) * CONSERVATIVE_FACTOR;
    const weeklyDelta = weeklyCampaigns > 0 ? deltaPerCampaign * weeklyCampaigns : 0;
    note.estimatedImpact = makeEstimate(
      weeklyDelta,
      "increase",
      "Estimated incremental revenue by leaning into the recommended audience size",
      `${context.sampleCampaigns} campaigns analysed`
    );
  }
  return note;
}

// ------------------------------
// Campaign Gaps & Losses
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

  const lost = sanitizeCurrency(result.estimatedLostRevenue) ?? 0;
  const weeklyDelta = result.weeksInRangeFull
    ? (lost / Math.max(1, result.zeroCampaignSendWeeks)) * CONSERVATIVE_FACTOR
    : lost * CONSERVATIVE_FACTOR;

  return {
    module: "campaignGapsLosses",
    title: `Fill ${result.zeroCampaignSendWeeks.toLocaleString()} missed ${
      result.zeroCampaignSendWeeks === 1 ? "week" : "weeks"
    } to claw back revenue`,
    message: lost
      ? `Skipping ${result.zeroCampaignSendWeeks} ${
          result.zeroCampaignSendWeeks === 1 ? "week" : "weeks"
        } cost an estimated $${Math.round(lost).toLocaleString()}. Build a backup send to protect that revenue.`
      : `Skipping ${result.zeroCampaignSendWeeks} ${
          result.zeroCampaignSendWeeks === 1 ? "week" : "weeks"
        } likely cost meaningful revenue. Build a backup send to protect that revenue.`,
    sample,
    estimatedImpact: makeEstimate(
      weeklyDelta,
      "increase",
      "Estimated revenue recovered by eliminating zero-send weeks",
      `${result.weeksInRangeFull} full weeks analysed`
    ),
    metadata: {
      estimatedLostRevenue: lost,
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
  } = summary;

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
    },
  };
}

export interface OpportunitySummary {
  notes: ModuleActionNote[];
  totals: {
    weekly: number;
    monthly: number;
    annual: number;
  };
}

export function computeOpportunitySummary(params: {
  dateRange: string;
  customFrom?: string;
  customTo?: string;
  granularity?: "daily" | "weekly" | "monthly";
}): OpportunitySummary {
  const dm = DataManager.getInstance();
  const campaigns = dm.getCampaigns();

  const notes: ModuleActionNote[] = [];

  // Send Frequency
  if (campaigns.length) {
    const freqNote = buildSendFrequencyNote({
      campaigns,
      dateRange: params.dateRange,
      customFrom: params.customFrom,
      customTo: params.customTo,
    });
    notes.push(freqNote);
  }

  // Audience Size
  if (campaigns.length) {
    const audienceNote = buildAudienceSizeNote({
      campaigns,
      dateRange: params.dateRange,
      customFrom: params.customFrom,
      customTo: params.customTo,
    });
    notes.push(audienceNote);
  }

  // Campaign Gaps & Losses
  if (campaigns.length) {
    notes.push(
      buildCampaignGapsNote({
        campaigns,
        dateRange: params.dateRange,
        customFrom: params.customFrom,
        customTo: params.customTo,
      })
    );
  }

  // Dead-Weight Audience
  const deadWeightNote = buildDeadWeightNote();
  if (deadWeightNote) notes.push(deadWeightNote);

  const totals = notes.reduce(
    (acc, note) => {
      const impact = note.estimatedImpact;
      if (!impact) return acc;
      if (typeof impact.weekly === "number") acc.weekly += Math.max(0, impact.weekly);
      if (typeof impact.monthly === "number") acc.monthly += Math.max(0, impact.monthly);
      if (typeof impact.annual === "number") acc.annual += Math.max(0, impact.annual);
      return acc;
    },
    { weekly: 0, monthly: 0, annual: 0 }
  );

  return { notes, totals };
}

// Remaining modules (flowStepAnalysis, subscribed vs not subscribed, engagement by profile age, inactivity revenue drain, dead weight audience)
// will be implemented incrementally where needed by dashboard and export builder.
