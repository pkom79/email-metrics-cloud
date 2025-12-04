import type { ProcessedCampaign } from "../data/dataTypes";

export type FrequencyBucketKey = string;

export interface FrequencyBucketAggregate {
  key: FrequencyBucketKey;
  weeksCount: number;
  totalCampaigns: number;
  // sums across all campaigns in bucket
  sumRevenue: number;
  sumEmails: number;
  sumOrders: number;
  sumOpens: number;
  sumClicks: number;
  sumUnsubs: number;
  sumSpam: number;
  sumBounces: number;
  // per-week averages
  avgWeeklyRevenue: number;
  avgWeeklyOrders: number;
  avgWeeklyEmails: number;
  // per-campaign averages
  avgCampaignRevenue: number;
  avgCampaignOrders: number;
  avgCampaignEmails: number;
  // weighted metrics
  aov: number;
  revenuePerEmail: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  conversionRate: number;
  unsubscribeRate: number;
  spamRate: number;
  bounceRate: number;
}

/**
 * Compute Campaign Send Frequency buckets with Seasonal Anomaly Filter (90th Percentile).
 * 1. Analyzes last 365 days (from allCampaignsForHistory) to find the 90th percentile frequency.
 * 2. Excludes weeks in the current 'campaigns' set that exceed this threshold (outliers).
 * 3. Groups remaining weeks by frequency (1, 2, 3, 4, 5...) dynamically.
 */
export function computeCampaignSendFrequency(
  campaigns: ProcessedCampaign[],
  allCampaignsForHistory?: ProcessedCampaign[]
): FrequencyBucketAggregate[] {
  if (!campaigns?.length) return [];

  // Monday of week helper
  const mondayOf = (d: Date) => {
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    const day = n.getDay();
    const diff = n.getDate() - day + (day === 0 ? -6 : 1);
    n.setDate(diff);
    return n;
  };

  // Helper to group campaigns by week
  const groupWeeks = (list: ProcessedCampaign[]) => {
    const map = new Map<string, { key: string; campaignCount: number; campaigns: ProcessedCampaign[] }>();
    for (const c of list) {
      if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
      const m = mondayOf(c.sentDate);
      const wk = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
      let agg = map.get(wk);
      if (!agg) { agg = { key: wk, campaignCount: 0, campaigns: [] }; map.set(wk, agg); }
      agg.campaignCount += 1;
      agg.campaigns.push(c);
    }
    return Array.from(map.values());
  };

  // 1. Calculate Anomaly Threshold (P90) from History
  let maxAllowedFrequency = Infinity;
  
  if (allCampaignsForHistory?.length) {
    // Filter to last 365 days relative to the latest campaign in history
    const latestDate = allCampaignsForHistory.reduce((max, c) => c.sentDate > max ? c.sentDate : max, new Date(0));
    const oneYearAgo = new Date(latestDate);
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);
    
    const historyWeeks = groupWeeks(allCampaignsForHistory.filter(c => c.sentDate >= oneYearAgo));
    
    if (historyWeeks.length > 0) {
      const counts = historyWeeks.map(w => w.campaignCount).sort((a, b) => a - b);
      const p90Index = Math.ceil(0.9 * counts.length) - 1;
      const p90Value = counts[Math.max(0, p90Index)];
      const maxValue = counts[counts.length - 1];

      // "If the 90th Percentile equals the Maximum value, no data is excluded."
      if (p90Value < maxValue) {
        maxAllowedFrequency = p90Value;
      }
    }
  }

  // 2. Process Current Campaigns
  const currentWeeks = groupWeeks(campaigns);
  
  // 3. Filter Outliers
  const validWeeks = currentWeeks.filter(w => w.campaignCount <= maxAllowedFrequency);

  // 4. Group by Frequency Bucket
  const bucketMap = new Map<string, typeof validWeeks>();
  
  for (const w of validWeeks) {
    const key = String(w.campaignCount);
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push(w);
  }

  const result: FrequencyBucketAggregate[] = [];
  
  // Sort keys numerically
  const sortedKeys = Array.from(bucketMap.keys()).sort((a, b) => Number(a) - Number(b));

  for (const key of sortedKeys) {
    const arr = bucketMap.get(key)!;
    const weeksCount = arr.length;
    let sumRevenue = 0, sumEmails = 0, sumOrders = 0, sumOpens = 0, sumClicks = 0, sumUnsubs = 0, sumSpam = 0, sumBounces = 0, totalCampaigns = 0;
    
    arr.forEach(w => {
      totalCampaigns += w.campaignCount;
      w.campaigns.forEach(c => {
        sumRevenue += c.revenue;
        sumEmails += c.emailsSent;
        sumOrders += c.totalOrders;
        sumOpens += c.uniqueOpens;
        sumClicks += c.uniqueClicks;
        sumUnsubs += c.unsubscribesCount;
        sumSpam += c.spamComplaintsCount;
        sumBounces += c.bouncesCount;
      });
    });

    const avgWeeklyRevenue = weeksCount > 0 ? sumRevenue / weeksCount : 0;
    const avgWeeklyOrders = weeksCount > 0 ? sumOrders / weeksCount : 0;
    const avgWeeklyEmails = weeksCount > 0 ? sumEmails / weeksCount : 0;
    const avgCampaignRevenue = totalCampaigns > 0 ? sumRevenue / totalCampaigns : 0;
    const avgCampaignOrders = totalCampaigns > 0 ? sumOrders / totalCampaigns : 0;
    const avgCampaignEmails = totalCampaigns > 0 ? sumEmails / totalCampaigns : 0;
    const aov = sumOrders > 0 ? sumRevenue / sumOrders : 0;
    const revenuePerEmail = sumEmails > 0 ? sumRevenue / sumEmails : 0;
    const openRate = sumEmails > 0 ? (sumOpens / sumEmails) * 100 : 0;
    const clickRate = sumEmails > 0 ? (sumClicks / sumEmails) * 100 : 0;
    const clickToOpenRate = sumOpens > 0 ? (sumClicks / sumOpens) * 100 : 0;
    const conversionRate = sumClicks > 0 ? (sumOrders / sumClicks) * 100 : 0;
    const unsubscribeRate = sumEmails > 0 ? (sumUnsubs / sumEmails) * 100 : 0;
    const spamRate = sumEmails > 0 ? (sumSpam / sumEmails) * 100 : 0;
    const bounceRate = sumEmails > 0 ? (sumBounces / sumEmails) * 100 : 0;

    result.push({ key, weeksCount, totalCampaigns, sumRevenue, sumEmails, sumOrders, sumOpens, sumClicks, sumUnsubs, sumSpam, sumBounces, avgWeeklyRevenue, avgWeeklyOrders, avgWeeklyEmails, avgCampaignRevenue, avgCampaignOrders, avgCampaignEmails, aov, revenuePerEmail, openRate, clickRate, clickToOpenRate, conversionRate, unsubscribeRate, spamRate, bounceRate });
  }

  return result;
}

export type SendFrequencyGuidanceStatus = 'send-more' | 'keep-as-is' | 'send-less' | 'insufficient';
export type SendFrequencyRecommendationKind = 'scale' | 'test' | 'stay' | 'reduce' | 'insufficient';

export interface SendFrequencyGuidanceResult {
  status: SendFrequencyGuidanceStatus;
  recommendationKind: SendFrequencyRecommendationKind;
  cadenceLabel: string;
  title: string;
  message: string;
  sample: string | null;
  baselineKey?: FrequencyBucketKey;
  targetKey?: FrequencyBucketKey;
  baselineWeeklyRevenue?: number;
  targetWeeklyRevenue?: number;
  estimatedWeeklyGain: number | null;
  estimatedMonthlyGain: number | null;
  metadata?: Record<string, unknown>;
}

const MIN_TOTAL_WEEKS_FOR_REC = 12;
const TEST_WEEKS_THRESHOLD = 3; // If target has < 3 weeks, it's a test.

// Thresholds
const SPAM_GREEN_LIMIT = 0.1; // < 0.1%
const SPAM_RED_LIMIT = 0.2;   // > 0.2% is Red
const BOUNCE_GREEN_LIMIT = 2.0; // < 2.0%
const BOUNCE_RED_LIMIT = 3.0;   // > 3.0% is Red

function formatPercent(value: number) {
  if (!isFinite(value)) return '∞%';
  return `${(value * 100).toFixed(Math.abs(value) >= 1 ? 0 : 1)}%`;
}

function pluralize(word: string, count: number) {
  return count === 1 ? word : `${word}s`;
}

export function labelForFrequencyBucket(key: FrequencyBucketKey): string {
  const k = Number(key);
  return `${k} ${pluralize('campaign', k)} / week`;
}

export function actionLabelForFrequencyBucket(key: FrequencyBucketKey): string {
  const k = Number(key);
  return `${k} ${pluralize('campaign', k)} a week`;
}

export function computeSendFrequencyGuidance(
  buckets: FrequencyBucketAggregate[],
  mode: 'week' | 'campaign' = 'week'
): SendFrequencyGuidanceResult | null {
  if (!buckets.length) return null;

  const metricKey = mode === 'week' ? 'avgWeeklyRevenue' : 'avgCampaignRevenue';
  const getRevenueValue = (b: FrequencyBucketAggregate) => (b as any)[metricKey] as number;
  const totalWeeksAll = buckets.reduce((sum, b) => sum + b.weeksCount, 0);
  const formatSample = () => totalWeeksAll ? `Based on ${totalWeeksAll} ${pluralize('week', totalWeeksAll)} of campaign data.` : null;

  // 1. Global Data Sufficiency Check
  if (totalWeeksAll < MIN_TOTAL_WEEKS_FOR_REC) {
    return {
      status: 'insufficient',
      recommendationKind: 'insufficient',
      cadenceLabel: 'Not enough data',
      title: 'Not enough data for a recommendation',
      message: `We need at least ${MIN_TOTAL_WEEKS_FOR_REC} weeks of campaign data to provide a reliable recommendation. Keep sending!`,
      sample: formatSample(),
      estimatedWeeklyGain: null,
      estimatedMonthlyGain: null,
    };
  }

  // 2. Identify Dominant (Current Baseline)
  const dominant = buckets.reduce<FrequencyBucketAggregate>((best, curr) => 
    (curr.weeksCount > best.weeksCount ? curr : best), buckets[0]);

  // 3. Identify Candidates (Green & Yellow)
  // Red is strictly excluded from *recommendations*
  // Green: Spam < 0.1 && Bounce < 2.0
  // Yellow: (Spam <= 0.2 && Bounce <= 3.0) AND NOT Green
  // Red: Spam > 0.2 || Bounce > 3.0
  const candidates = buckets.filter(b => 
    b.spamRate <= SPAM_RED_LIMIT && 
    b.bounceRate <= BOUNCE_RED_LIMIT
  );

  // If no candidates (all Red), fallback to stabilizing dominant
  if (candidates.length === 0) {
      return {
         status: 'send-less',
         recommendationKind: 'reduce',
         cadenceLabel: labelForFrequencyBucket(dominant.key),
         title: `Stabilize at ${actionLabelForFrequencyBucket(dominant.key)}`,
         message: `${labelForFrequencyBucket(dominant.key)} is generating high spam/bounce rates (> ${SPAM_RED_LIMIT}% spam or > ${BOUNCE_RED_LIMIT}% bounce). Focus on list cleaning and content quality before scaling.`,
         sample: formatSample(),
         baselineKey: dominant.key,
         targetKey: dominant.key,
         baselineWeeklyRevenue: getRevenueValue(dominant),
         targetWeeklyRevenue: getRevenueValue(dominant),
         estimatedWeeklyGain: null,
         estimatedMonthlyGain: null,
         metadata: { strategy: 'stabilize-emergency' },
      };
  }

  // 4. Pick Best by Revenue (Independent of Dominant)
  // Filter out buckets with only 1 week of data (insufficient significance)
  const validCandidates = candidates.filter(b => b.weeksCount >= 2);
  
  // If no valid candidates (e.g. all high performers are 1-week anomalies), fallback to dominant if it's safe
  let bestBucket = validCandidates.sort((a, b) => getRevenueValue(b) - getRevenueValue(a))[0];

  if (!bestBucket) {
      // If dominant is safe, default to it. Otherwise, we have no recommendation.
      const dominantIsSafe = candidates.some(c => c.key === dominant.key);
      if (dominantIsSafe) {
          bestBucket = dominant;
      } else {
          // Dominant is Red, and no other safe bucket has > 1 week.
          return {
             status: 'send-less',
             recommendationKind: 'reduce',
             cadenceLabel: labelForFrequencyBucket(dominant.key),
             title: `Stabilize at ${actionLabelForFrequencyBucket(dominant.key)}`,
             message: `${labelForFrequencyBucket(dominant.key)} is generating high spam/bounce rates (> ${SPAM_RED_LIMIT}% spam or > ${BOUNCE_RED_LIMIT}% bounce). Focus on list cleaning and content quality before scaling.`,
             sample: formatSample(),
             baselineKey: dominant.key,
             targetKey: dominant.key,
             baselineWeeklyRevenue: getRevenueValue(dominant),
             targetWeeklyRevenue: getRevenueValue(dominant),
             estimatedWeeklyGain: null,
             estimatedMonthlyGain: null,
             metadata: { strategy: 'stabilize-emergency' },
          };
      }
  }
  
  // 5. Check Risk Level of Best Bucket
  const isYellow = bestBucket.spamRate >= SPAM_GREEN_LIMIT || bestBucket.bounceRate >= BOUNCE_GREEN_LIMIT;
  const riskLabel = isYellow ? ' (Higher Risk)' : '';
  const riskWarning = isYellow ? ' Note: This frequency shows slightly elevated risk metrics (Yellow Zone), so monitor spam and bounce rates closely.' : '';

  // 6. Compare to Dominant to Frame Recommendation
  const baselineRevenue = getRevenueValue(dominant);
  const targetRevenue = getRevenueValue(bestBucket);
  const lift = baselineRevenue === 0 ? (targetRevenue > 0 ? Infinity : 0) : (targetRevenue - baselineRevenue) / baselineRevenue;
  const liftPct = lift === Infinity ? 'from zero' : formatPercent(lift);
  
  // Calculate Overall Average Weekly Revenue for Projection Baseline
  // (Revenue per week for the entire look back period)
  const totalRevenueAll = buckets.reduce((sum, b) => sum + b.sumRevenue, 0);
  const overallAvgWeeklyRevenue = totalWeeksAll > 0 ? totalRevenueAll / totalWeeksAll : 0;

  // Helper to calculate conservative projected gain
  // Formula: (Target Weekly - Overall Average Weekly) * 4 weeks * 50% conservative factor
  const calculateProjectedGain = (targetWeeklyRev: number) => {
      const weeklyGain = targetWeeklyRev - overallAvgWeeklyRevenue;
      if (weeklyGain <= 0) return null;
      return weeklyGain * 4 * 0.5;
  };

  // Case A: Stay (Best is Dominant)
  if (bestBucket.key === dominant.key) {
      return {
          status: 'keep-as-is',
          recommendationKind: 'stay',
          cadenceLabel: labelForFrequencyBucket(bestBucket.key) + riskLabel,
          title: `Send ${actionLabelForFrequencyBucket(bestBucket.key)}`,
          message: `${labelForFrequencyBucket(bestBucket.key)} is your top performing cadence for revenue.${riskWarning}`,
          sample: formatSample(),
          baselineKey: dominant.key,
          targetKey: bestBucket.key,
          baselineWeeklyRevenue: baselineRevenue,
          targetWeeklyRevenue: targetRevenue,
          estimatedWeeklyGain: 0,
          estimatedMonthlyGain: 0,
          metadata: { strategy: 'maintain-revenue-max', risk: isYellow ? 'yellow' : 'green' },
      };
  }

  // Case B: Scale Up / Test (Best is Higher Frequency)
  if (Number(bestBucket.key) > Number(dominant.key)) {
      const isConfident = bestBucket.weeksCount >= TEST_WEEKS_THRESHOLD;
      const recKind = isConfident ? 'scale' : 'test';
      
      // Only show revenue projection for Full recommendations (isConfident)
      const projectedMonthlyGain = isConfident ? calculateProjectedGain(targetRevenue) : null;
      
      return {
        status: 'send-more',
        recommendationKind: recKind,
        cadenceLabel: labelForFrequencyBucket(bestBucket.key) + riskLabel,
        title: `Send ${actionLabelForFrequencyBucket(bestBucket.key)}`,
        message: `${labelForFrequencyBucket(bestBucket.key)} generates ${liftPct} more weekly revenue than your most frequent cadence.${riskWarning} ${isConfident ? 'Scale up to this frequency.' : 'Consider testing this bucket to see if results hold.'}`,
        sample: formatSample(),
        baselineKey: dominant.key,
        targetKey: bestBucket.key,
        baselineWeeklyRevenue: baselineRevenue,
        targetWeeklyRevenue: targetRevenue,
        estimatedWeeklyGain: null, // Deprecated in favor of monthly projection logic
        estimatedMonthlyGain: projectedMonthlyGain,
        metadata: { strategy: 'scale-revenue-max', risk: isYellow ? 'yellow' : 'green' },
      };
  }

  // Case C: Scale Down (Best is Lower Frequency)
  if (Number(bestBucket.key) < Number(dominant.key)) {
      const isConfident = bestBucket.weeksCount >= TEST_WEEKS_THRESHOLD;
      
      // Only show revenue projection for Full recommendations
      const projectedMonthlyGain = isConfident ? calculateProjectedGain(targetRevenue) : null;

      return {
        status: 'send-less',
        recommendationKind: 'reduce',
        cadenceLabel: labelForFrequencyBucket(bestBucket.key) + riskLabel,
        title: `Send ${actionLabelForFrequencyBucket(bestBucket.key)}`,
        message: `${labelForFrequencyBucket(bestBucket.key)} generates ${liftPct} more revenue than your most frequent cadence.${riskWarning} ${isConfident ? 'Consider reducing frequency to maximize return.' : 'Consider testing this lower frequency.'}`,
        sample: formatSample(),
        baselineKey: dominant.key,
        targetKey: bestBucket.key,
        baselineWeeklyRevenue: baselineRevenue,
        targetWeeklyRevenue: targetRevenue,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: projectedMonthlyGain,
        metadata: { strategy: 'reduce-revenue-max', risk: isYellow ? 'yellow' : 'green' },
      };
  }

  return null;
}
