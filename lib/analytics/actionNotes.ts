import type { FrequencyBucketAggregate } from "./campaignSendFrequency";
import type { SendVolumeGuidanceResult } from "./sendVolumeGuidance";
import { computeCampaignSendFrequency, computeSendFrequencyGuidance } from "./campaignSendFrequency";
import { computeAudienceSizeBuckets } from "./audienceSizeBuckets";
import type { AudienceSizeBucket } from "./audienceSizeBuckets";
import { computeCampaignGapsAndLosses } from "./campaignGapsLosses";
import { computeCampaignDayPerformance } from "./campaignDayPerformance";
import { computeDeadWeightSavings } from "./deadWeightSavings";
import { computeSendVolumeGuidance } from "./sendVolumeGuidance";
import { DataManager } from "../data/dataManager";
import {
  getRiskZone,
  getDeliverabilityPoints,
  computeOptimalLookbackDays,
  hasStatisticalSignificance,
  getDeliverabilityRiskMessage,
  getInsufficientDataMessage,
  RiskZone,
  SPAM_GREEN_LIMIT,
  SPAM_RED_LIMIT,
  BOUNCE_GREEN_LIMIT,
  BOUNCE_RED_LIMIT,
  AccountDeliverabilityContext,
  getDeliverabilityZoneWithContext, 
  MIN_SAMPLE_SIZE
} from "./deliverabilityZones";
import { ProcessedCampaign, ProcessedFlowEmail, FlowSequenceInfo } from "../data/dataTypes";
import {
  calculateMoneyPillarScoreStandalone,
  getStandaloneRevenueScore
} from "./revenueTiers";
import {
  inferFlowType,
  projectNewStepRevenue
} from "./flowDecayFactors";

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
  type: "lift" | "savings";
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

// CONSTANTS
const CONSERVATIVE_FACTOR = 0.5;
const MIN_OPPORTUNITY_MONTHLY_GAIN = 100;
const MIN_STEP_EMAILS = 250;
const FLOW_MIN_TOTAL_SENDS = 500; // Legacy / Fallback

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
  const channelLabel =
    result.channel === "all"
      ? "overall email activity"
      : `${result.channel} activity`;
  return `Based on ${count} ${plural} of ${channelLabel} in this range.`;
}

export function buildSendVolumeNotes(params: {
  dateRange: string;
  customFrom?: string;
  customTo?: string;
}): ModuleActionNote[] {
  const dm = DataManager.getInstance();
  const base: Array<{ key: "all" | "campaigns" | "flows"; label: string }> = [
    { key: "all", label: "All Emails" },
    { key: "campaigns", label: "Campaigns" },
    { key: "flows", label: "Flows" },
  ];
  return base.map(({ key, label }) => {
    const result = computeSendVolumeGuidance(key, { ...params }, dm);
    const title = (() => {
      if (result.status === "insufficient") {
        return `Not enough data to evaluate ${label.toLowerCase()} volume`;
      }
      switch (result.channel) {
        case "all":
          return `${label}: ${
            result.status === "send-more"
              ? "Scale total volume"
              : result.status === "send-less"
              ? "Trim total volume"
              : "Hold steady"
          }`;
        case "campaigns":
          return `${label}: ${
            result.status === "send-more"
              ? "Increase"
              : result.status === "send-less"
              ? "Reduce"
              : "Keep"
          } volume`;
        case "flows":
        default:
          return `${label}: ${
            result.status === "send-more"
              ? "Scale"
              : result.status === "send-less"
              ? "Trim"
              : "Maintain"
          } send volume`;
      }
    })();
    return {
      module: "sendVolumeImpact",
      scope: result.channel,
      status: result.status,
      title,
      message: result.message,
      sample: buildSendVolumeSample(result),
      estimatedImpact: null,
      metadata: {
        sampleSize: result.sampleSize,
        periodType: result.periodType,
        revenueScore: result.revenueScore,
        riskScore: result.riskScore,
        trigger: result.trigger,
        deliverabilityBreached: result.deliverabilityBreached,
        maxRates: result.maxRates,
        thresholds: result.thresholds,
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
  const { buckets } = computeCampaignSendFrequency(campaigns);
  const guidance = computeSendFrequencyGuidance(buckets, 'week');

  if (!guidance) {
    return {
      module: "campaignSendFrequency",
      title: "Not enough data for a recommendation",
      message: "No campaigns were found in the selected date range.",
      sample: null,
    };
  }

  const note: ModuleActionNote = {
    module: "campaignSendFrequency",
    status: guidance.status,
    title: guidance.title,
    message: guidance.message,
    sample: guidance.sample,
    metadata: {
      baselineKey: guidance.baselineKey,
      targetKey: guidance.targetKey,
      baselineWeeklyRevenue: guidance.baselineWeeklyRevenue,
      targetWeeklyRevenue: guidance.targetWeeklyRevenue,
      cadenceLabel: guidance.cadenceLabel,
      weeksAnalysed: weeksInRange,
      weeklyDelta: guidance.estimatedWeeklyGain ?? null,
      recommendationKind: guidance.recommendationKind,
    },
    estimatedImpact: null,
  };

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

  const best = [...qualified].sort((a, b) => b.avgCampaignRevenue - a.avgCampaignRevenue)[0];
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
      "lift",
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

interface FlowStepMetrics {
  sequencePosition: number;
  emailName: string;
  emailsSent: number;
  revenue: number;
  openRate: number;
  clickRate: number;
  revenuePerEmail: number;
  spamRate: number;
  bounceRate: number;
  spamComplaintsCount: number;
  bouncesCount: number;
  totalOrders: number;
}

function processFlowOpportunity(
  flowName: string,
  emails: ProcessedFlowEmail[],
  sequenceInfo: FlowSequenceInfo,
  accountContext: AccountDeliverabilityContext,
  storeRevenueTotal: number,
  weeksInRange: number,
  dateRangeDays: number
): ModuleActionNote | null {
  if (!emails.length || !sequenceInfo) return null;

  // 1. Build Step Metrics (Mirroring FlowStepAnalysis)
  const stepMetrics: FlowStepMetrics[] = [];
  let s1Sends = 0;

  for (let idx = 0; idx < sequenceInfo.messageIds.length; idx++) {
    const messageId = sequenceInfo.messageIds[idx];
    let stepEmails = emails.filter((e) => e.flowMessageId === messageId);
    if (!stepEmails.length) {
      stepEmails = emails.filter((e) => e.sequencePosition === idx + 1);
    }
    
    if (!stepEmails.length) continue;

    const totalEmailsSent = stepEmails.reduce((sum, e) => sum + (e.emailsSent || 0), 0);
    const totalRevenue = stepEmails.reduce((sum, e) => sum + (e.revenue || 0), 0);
    const totalOrders = stepEmails.reduce((sum, e) => sum + (e.totalOrders || 0), 0);
    const totalOpens = stepEmails.reduce((sum, e) => sum + (e.uniqueOpens || 0), 0);
    const totalClicks = stepEmails.reduce((sum, e) => sum + (e.uniqueClicks || 0), 0);
    const totalSpam = stepEmails.reduce((sum, e) => sum + (e.spamComplaintsCount || 0), 0);
    const totalBounces = stepEmails.reduce((sum, e) => sum + (e.bouncesCount || 0), 0);

    const rpe = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
    
    // Sort to get name from latest email
    const sorted = [...stepEmails].sort((a, b) => new Date(a.sentDate).getTime() - new Date(b.sentDate).getTime());
    const name = sequenceInfo.emailNames[idx] || (sorted.length ? sorted[sorted.length - 1].emailName : `Step ${idx+1}`);

    stepMetrics.push({
      sequencePosition: idx + 1,
      emailName: name,
      emailsSent: totalEmailsSent,
      revenue: totalRevenue,
      openRate: totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0,
      clickRate: totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0,
      revenuePerEmail: rpe,
      spamRate: totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0,
      bounceRate: totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0,
      spamComplaintsCount: totalSpam,
      bouncesCount: totalBounces,
      totalOrders
    });

    if (idx === 0) s1Sends = totalEmailsSent;
  }

  if (!stepMetrics.length) return null;

  // 2. Identify Last Step & Calculate Baselines
  const lastIdx = stepMetrics.length - 1;
  const last = stepMetrics[lastIdx];
  const flowRevenue = stepMetrics.reduce((sum, s) => sum + s.revenue, 0);
  
  // RPE Baseline (Median of flow steps)
  const rpesForBaseline = stepMetrics
    .filter(s => s.emailsSent > 0)
    .map(s => s.revenuePerEmail)
    .sort((a, b) => a - b);
    
  let medianRPE = 0;
  if (rpesForBaseline.length > 0) {
    const mid = Math.floor(rpesForBaseline.length / 2);
    medianRPE = rpesForBaseline.length % 2 === 0 
      ? (rpesForBaseline[mid - 1] + rpesForBaseline[mid]) / 2 
      : rpesForBaseline[mid];
  }

  // 3. Score & Gate (Strictly mirroring FlowStepAnalysis logic)
  
  // -- Delivery Context
  const contextZoneResult = getDeliverabilityZoneWithContext(
    last.spamRate, 
    last.bounceRate, 
    last.emailsSent, 
    last.spamComplaintsCount, 
    last.bouncesCount, 
    accountContext
  );
  const effectiveZone = contextZoneResult.effectiveZone;
  const deliverabilityPoints = contextZoneResult.points;
  const hasRedZone = effectiveZone === 'red';

  // -- Money Score
  const moneyScore = calculateMoneyPillarScoreStandalone(
    last.revenuePerEmail, 
    medianRPE, 
    last.revenue, 
    dateRangeDays
  );
  const moneyPoints = moneyScore.totalPoints;
  
  // -- Confidence Score
  const volumeSufficient = last.emailsSent >= MIN_SAMPLE_SIZE; // 250
  const scPoints = volumeSufficient 
    ? Math.min(10, Math.floor(last.emailsSent / 100))
    : 0;

  const totalScore = Math.min(100, moneyPoints + deliverabilityPoints + scPoints);

  // -- Gates
  const volumeOk = last.emailsSent >= Math.max(MIN_STEP_EMAILS, Math.round(0.05 * s1Sends));
  const deliverabilityOk = !hasRedZone;
  
  const rpeOk = medianRPE > 0 ? last.revenuePerEmail >= medianRPE : true;
  const prevStep = lastIdx > 0 ? stepMetrics[lastIdx - 1] : null;
  const deltaRpeOk = prevStep ? (last.revenuePerEmail - prevStep.revenuePerEmail) >= 0 : true;

  const lastRevenuePct = flowRevenue > 0 ? (last.revenue / flowRevenue) * 100 : 0;
  
  const isHighValueStep = moneyScore.annualizedRevenue >= 50000;
  const absoluteRevenueOk = (last.revenue >= 500) || (lastRevenuePct >= 5);
  
  const scoreThreshold = isHighValueStep ? 65 : 75;
  const rpeGatesPass = isHighValueStep ? true : (rpeOk && deltaRpeOk);

  // Final Suggestion Check
  const suggested = (totalScore >= scoreThreshold) && deliverabilityOk && rpeGatesPass && volumeOk && absoluteRevenueOk;

  if (!suggested) return null;

  // 4. Projection Calculation (Using shared utility)
  const allStepRPEs = stepMetrics.map(s => s.revenuePerEmail);
  const projection = projectNewStepRevenue(
    flowName,
    last.emailsSent,
    last.revenuePerEmail,
    allStepRPEs,
    medianRPE,
    Math.max(1, weeksInRange) 
  );

  const weeklyGain = projection.projectedRevenuePerWeek.mid;
  if (weeklyGain * 4 < MIN_OPPORTUNITY_MONTHLY_GAIN) return null; // Small opportunities filter

  // 5. Construct Note
  const monthly = weeklyGain * 4;
  const annual = weeklyGain * 52;
  
  // Format as friendly check
  return {
    module: "flowStepAnalysis",
    scope: "flows",
    title: `Add a follow-up to ${flowName}`,
    message: `Step ${last.sequencePosition} is performing well. A follow-up could add value.`,
    sample: null,
    metadata: {
      flowName: flowName,
      stepSequence: last.sequencePosition,
      stepName: last.emailName,
      projectedMonthly: monthly,
      confidenceLevel: projection.confidenceLevel
    },
    estimatedImpact: {
      weekly: roundCurrency(weeklyGain),
      monthly: roundCurrency(monthly),
      annual: roundCurrency(annual),
      type: "lift",
      description: `Projected add-step revenue based on ${projection.flowType} decay patterns`,
      basis: `Extrapolated from Step ${last.sequencePosition} (${last.emailsSent.toLocaleString()} sends, $${last.revenuePerEmail.toFixed(2)} RPE) using conservative decay factor (${projection.decayFactor})`
    }
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

  // Account Context for scoring
  const campaigns = dm.getCampaigns(); 
  const flowsAllRaw = dm.getFlowEmails();
  
  // Filter for range
  const campaignsInRange = start && end ? campaigns.filter(c => c.sentDate >= start && c.sentDate <= end) : campaigns;
  const flowsInRange = start && end ? flowsAllRaw.filter(f => f.sentDate >= start && f.sentDate <= end) : flowsAllRaw;
  
  const agg = dm.getAggregatedMetricsForPeriod(campaignsInRange, flowsInRange, start || new Date(0), end || new Date());
  
  const accountContext: AccountDeliverabilityContext = {
    accountSends: agg.emailsSent || 0,
    accountSpamComplaints: agg.spamComplaintsCount || 0,
    accountBounces: agg.bouncesCount || 0,
    accountSpamRate: agg.spamRate || 0,
    accountBounceRate: agg.bounceRate || 0
  };

  const storeRevenueTotal = agg.totalRevenue || 0;
  const days = start && end ? Math.max(1, (end.getTime() - start.getTime()) / (86400000)) : 30;
  const weeks = Math.max(1, days / 7);

  // Group Flows
  const flowGroups = new Map<string, ProcessedFlowEmail[]>();
  const liveFlows = flowsInRange.filter(f => (f.status || '').toLowerCase() === 'live');
  
  for (const email of liveFlows) {
    if (!email.flowName) continue;
    const arr = flowGroups.get(email.flowName) || [];
    arr.push(email);
    flowGroups.set(email.flowName, arr);
  }

  const notes: ModuleActionNote[] = [];

  for (const [flowName, emails] of flowGroups.entries()) {
    const sequenceInfo = dm.getFlowSequenceInfo(flowName);
    if (!sequenceInfo) continue;

    const note = processFlowOpportunity(
      flowName, 
      emails, 
      sequenceInfo, 
      accountContext, 
      storeRevenueTotal, 
      weeks,
      days
    );

    if (note) {
      notes.push(note);
    }
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
    // CRITICAL FIX: Parse dates as UTC to avoid timezone issues
    const [y1, m1, d1] = params.customFrom.split('-').map(Number);
    const [y2, m2, d2] = params.customTo.split('-').map(Number);
    rangeStart = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
    rangeEnd = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));
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
          type: "lift",
          description: "Estimated revenue recovered by eliminating zero-send weeks",
          basis: `${Math.min(rangeDays, 365)} days analysed`,
        }
      : null,
    metadata: {
      estimatedLostRevenue: baseLost,
      adjustedLost: annualEstimate,
      coverageFactor,
      rangeFactor,
      zeroCampaignSendWeeks: result.zeroCampaignSendWeeks,
      weeksInRangeFull: result.weeksInRangeFull,
      weeksWithCampaignsSent: result.weeksWithCampaignsSent,
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
      "lift",
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
  const allCampaigns = dm.getCampaigns();
  const allFlows = dm.getFlowEmails();

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

  const isWithinRange = (date: Date | null | undefined, rangeStart: Date | null, rangeEnd: Date | null) => {
    if (!(date instanceof Date) || isNaN(date.getTime())) return false;
    if (rangeStart && date < rangeStart) return false;
    if (rangeEnd && date > rangeEnd) return false;
    return true;
  };

  const campaignsInRange = start && end
    ? allCampaigns.filter((c) => isWithinRange(c.sentDate, start, end))
    : [...allCampaigns];
  const flowsInRange = start && end
    ? allFlows.filter((f) => isWithinRange(f.sentDate, start, end))
    : [...allFlows];

  const overallAgg = dm.getAggregatedMetricsForPeriod(campaignsInRange, flowsInRange, start, end);
  const campaignAgg = dm.getAggregatedMetricsForPeriod(campaignsInRange, [], start, end);
  const flowAgg = dm.getAggregatedMetricsForPeriod([], flowsInRange, start, end);

  const emailRevenue = overallAgg.totalRevenue || 0;
  const campaignRevenue = campaignAgg.totalRevenue || 0;
  const flowRevenue = flowAgg.totalRevenue || 0;

  const baselineEnd = new Date(end);
  const baselineStart = new Date(baselineEnd);
  baselineStart.setDate(baselineStart.getDate() - 364);

  const campaignsBaseline = baselineStart && baselineEnd
    ? allCampaigns.filter((c) => isWithinRange(c.sentDate, baselineStart, baselineEnd))
    : [...allCampaigns];
  const flowsBaseline = baselineStart && baselineEnd
    ? allFlows.filter((f) => isWithinRange(f.sentDate, baselineStart, baselineEnd))
    : [...allFlows];
  const baselineCampaignAgg = dm.getAggregatedMetricsForPeriod(campaignsBaseline, [], baselineStart, baselineEnd);
  const baselineFlowAgg = dm.getAggregatedMetricsForPeriod([], flowsBaseline, baselineStart, baselineEnd);
  const baselineCampaignRevenueRaw = baselineCampaignAgg.totalRevenue || 0;
  const baselineFlowRevenueRaw = baselineFlowAgg.totalRevenue || 0;
  const baselineCampaignRevenue = baselineCampaignRevenueRaw > 0 ? baselineCampaignRevenueRaw : null;
  const baselineFlowRevenue = baselineFlowRevenueRaw > 0 ? baselineFlowRevenueRaw : null;
  const baselineEmailRevenueRaw = baselineCampaignRevenueRaw + baselineFlowRevenueRaw;
  const baselineEmailRevenue = baselineEmailRevenueRaw > 0 ? baselineEmailRevenueRaw : null;

  const collectedNotes: ModuleActionNote[] = [];

  const applySendFrequencyAdjustment = (gapMetadata?: Record<string, unknown>) => {
    const frequencyNote = collectedNotes.find((n) => n.module === "campaignSendFrequency");
    if (!frequencyNote) return;

    const meta: Record<string, unknown> = {
      ...(frequencyNote.metadata || {}),
    };
    const recommendationKind = typeof meta["recommendationKind"] === "string" ? String(meta["recommendationKind"]) : null;
    const weeklyDeltaValue = meta["weeklyDelta"];
    const weeklyDelta = typeof weeklyDeltaValue === "number" ? weeklyDeltaValue : null;
    // Allow 'scale' or 'test' (if we have a delta) to show impact
    if ((recommendationKind !== 'scale' && recommendationKind !== 'test') || weeklyDelta == null || weeklyDelta <= 0) {
      frequencyNote.estimatedImpact = null;
      return;
    }

    const zeroWeeksRaw = gapMetadata && typeof gapMetadata["zeroCampaignSendWeeks"] === "number"
      ? (gapMetadata["zeroCampaignSendWeeks"] as number)
      : 0;
    const zeroWeeks = Math.min(52, Math.max(0, Math.round(zeroWeeksRaw)));
    const annualWeeks = Math.max(0, 52 - zeroWeeks);
    if (annualWeeks <= 0) {
      frequencyNote.estimatedImpact = null;
      frequencyNote.metadata = {
        ...meta,
        adjustedAnnualWeeks: annualWeeks,
        zeroCampaignSendWeeks: zeroWeeks,
      };
      return;
    }

    const rawAnnual = weeklyDelta * annualWeeks;
    const rawMonthly = rawAnnual / 12;
    const rawWeekly = rawAnnual / 52;
    const annual = roundCurrency(rawAnnual);
    const monthly = roundCurrency(rawMonthly);
    const weekly = roundCurrency(rawWeekly);

    if (annual == null || monthly == null || weekly == null || monthly < MIN_OPPORTUNITY_MONTHLY_GAIN) {
      frequencyNote.estimatedImpact = null;
      frequencyNote.metadata = { ...meta, adjustedAnnualWeeks: annualWeeks, zeroCampaignSendWeeks: zeroWeeks };
      return;
    }

    const basisParts: string[] = [];
    basisParts.push(`${annualWeeks} active week${annualWeeks === 1 ? "" : "s"} modelled`);
    const analysedValue = meta["weeksAnalysed"];
    if (typeof analysedValue === "number" && analysedValue > 0) {
      const analysed = Math.round(analysedValue);
      basisParts.push(`${analysed} observed week${analysed === 1 ? "" : "s"}`);
    }
    if (zeroWeeks > 0) {
      basisParts.push(`${zeroWeeks} zero-send week${zeroWeeks === 1 ? "" : "s"} excluded`);
    }

    frequencyNote.estimatedImpact = {
      weekly,
      monthly,
      annual,
      type: "lift",
      description: "Estimated incremental revenue from adopting recommended cadence",
      basis: basisParts.join(" · ") || undefined,
    };

    frequencyNote.metadata = {
      ...meta,
      adjustedAnnualWeeks: annualWeeks,
      zeroCampaignSendWeeks: zeroWeeks,
    };
  };

  if (campaignsInRange.length) {
    collectedNotes.push(
      buildSendFrequencyNote({
        campaigns: campaignsInRange,
        dateRange: params.dateRange,
        customFrom: params.customFrom,
        customTo: params.customTo,
      })
    );

    collectedNotes.push(
      buildAudienceSizeNote({
        campaigns: campaignsInRange,
        dateRange: params.dateRange,
        customFrom: params.customFrom,
        customTo: params.customTo,
      })
    );

    const baselineFromIso = baselineStart.toISOString().slice(0, 10);
    const baselineToIso = baselineEnd.toISOString().slice(0, 10);
    const gapNote = buildCampaignGapsNote({
        campaigns: campaignsBaseline,
        dateRange: 'custom',
        customFrom: baselineFromIso,
        customTo: baselineToIso,
      });
    collectedNotes.push(gapNote);
    applySendFrequencyAdjustment(gapNote.metadata as Record<string, unknown> | undefined);
  } else {
    applySendFrequencyAdjustment();
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
      label: (note) => note.metadata?.flowName ? `Add Step: ${String(note.metadata.flowName)}` : `Flow Step Optimization`,
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
        
        // Campaign Optimization Blending Logic
        // 1. Identify Frequency vs Audience (Overlap) vs Gap (Independent)
        const freqItem = cat.items.find(i => i.module === 'campaignSendFrequency');
        const audItem = cat.items.find(i => i.module === 'audienceSizePerformance');
        const gapItem = cat.items.find(i => i.module === 'campaignGapsLosses');
        
        const freqVal = freqItem ? freqItem.amountAnnual : 0;
        const audVal = audItem ? audItem.amountAnnual : 0;
        const gapVal = gapItem ? gapItem.amountAnnual : 0;
        
        // Overlap: Take max of Frequency/Audience + 50% of the other
        // This assumes they are partially independent strategies but share revenue source
        const maxOpt = Math.max(freqVal, audVal);
        const minOpt = Math.min(freqVal, audVal);
        const optimizationTotal = maxOpt + (minOpt * 0.5);
        
        // Gap elimination is additive (it recovers lost time periods, effectively "filling holes")
        // though strictly it competes for wallet share, we treat it as additive recovery.
        const totalCampaignImpact = optimizationTotal + gapVal;
        
        // Update category total to reflect blended value instead of simple sum
        cat.totalAnnual = totalCampaignImpact;
        
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
