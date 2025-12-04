import type { ProcessedCampaign } from "../data/dataTypes";

export type FrequencyBucketKey = '1' | '2' | '3' | '4+';

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
 * Compute Campaign Send Frequency buckets identical to the dashboard module.
 * Groups campaigns by ISO-week starting Monday and aggregates metrics by bucket:
 * 1, 2, 3, 4+ campaigns per week.
 */
export function computeCampaignSendFrequency(
  campaigns: ProcessedCampaign[]
): FrequencyBucketAggregate[] {
  if (!campaigns?.length) return [];

  // Monday of week
  const mondayOf = (d: Date) => {
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    const day = n.getDay();
    const diff = n.getDate() - day + (day === 0 ? -6 : 1);
    n.setDate(diff);
    return n;
  };

  interface WeekAgg { key: string; campaignCount: number; campaigns: ProcessedCampaign[]; }
  const weekMap = new Map<string, WeekAgg>();
  for (const c of campaigns) {
    if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
    const m = mondayOf(c.sentDate);
    const wk = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
    let agg = weekMap.get(wk);
    if (!agg) { agg = { key: wk, campaignCount: 0, campaigns: [] }; weekMap.set(wk, agg); }
    agg.campaignCount += 1;
    agg.campaigns.push(c);
  }

  const weekAggs = Array.from(weekMap.values());
  const bucketMap: Record<FrequencyBucketKey, WeekAgg[]> = { '1': [], '2': [], '3': [], '4+': [] };
  for (const w of weekAggs) {
    if (w.campaignCount >= 4) bucketMap['4+'].push(w);
    else if (w.campaignCount === 3) bucketMap['3'].push(w);
    else if (w.campaignCount === 2) bucketMap['2'].push(w);
    else if (w.campaignCount === 1) bucketMap['1'].push(w);
  }

  const result: FrequencyBucketAggregate[] = [];
  const pushBucket = (key: FrequencyBucketKey, arr: WeekAgg[]) => {
    if (!arr.length) return; // omit empty bucket
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
  };

  pushBucket('1', bucketMap['1']);
  pushBucket('2', bucketMap['2']);
  pushBucket('3', bucketMap['3']);
  pushBucket('4+', bucketMap['4+']);

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
const TEST_WEEKS_THRESHOLD = 4; // If target has < 4 weeks, it's a test.

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
  return ({ '1': '1 campaign / week', '2': '2 campaigns / week', '3': '3 campaigns / week', '4+': '4+ campaigns / week' }[key]);
}

export function actionLabelForFrequencyBucket(key: FrequencyBucketKey): string {
  switch (key) {
    case '1':
      return '1 campaign a week';
    case '2':
      return '2 campaigns a week';
    case '3':
      return '3 campaigns a week';
    default:
      return '4 campaigns a week';
  }
}

export function computeSendFrequencyGuidance(
  buckets: FrequencyBucketAggregate[],
  mode: 'week' | 'campaign' = 'week'
): SendFrequencyGuidanceResult | null {
  if (!buckets.length) return null;

  const metricKey = mode === 'week' ? 'avgWeeklyRevenue' : 'avgCampaignRevenue';
  const getRevenueValue = (b: FrequencyBucketAggregate) => (b as any)[metricKey] as number;
  const orderMap: Record<FrequencyBucketKey, number> = { '1': 1, '2': 2, '3': 3, '4+': 4 };
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
  const bestBucket = candidates.sort((a, b) => getRevenueValue(b) - getRevenueValue(a))[0];
  
  // 5. Check Risk Level of Best Bucket
  const isYellow = bestBucket.spamRate >= SPAM_GREEN_LIMIT || bestBucket.bounceRate >= BOUNCE_GREEN_LIMIT;
  const riskLabel = isYellow ? ' (Higher Risk)' : '';
  const riskWarning = isYellow ? ' Note: This frequency shows slightly elevated risk metrics (Yellow Zone), so monitor spam and bounce rates closely.' : '';

  // 6. Compare to Dominant to Frame Recommendation
  const baselineRevenue = getRevenueValue(dominant);
  const targetRevenue = getRevenueValue(bestBucket);
  const lift = baselineRevenue === 0 ? (targetRevenue > 0 ? Infinity : 0) : (targetRevenue - baselineRevenue) / baselineRevenue;
  const liftPct = lift === Infinity ? 'from zero' : formatPercent(lift);
  const weeklyDiff = targetRevenue - baselineRevenue;

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
  if (orderMap[bestBucket.key] > orderMap[dominant.key]) {
      const isConfident = bestBucket.weeksCount >= TEST_WEEKS_THRESHOLD;
      const recKind = isConfident ? 'scale' : 'test';
      
      return {
        status: 'send-more',
        recommendationKind: recKind,
        cadenceLabel: labelForFrequencyBucket(bestBucket.key) + riskLabel,
        title: `Send ${actionLabelForFrequencyBucket(bestBucket.key)}`,
        message: `${labelForFrequencyBucket(bestBucket.key)} generates ${liftPct} more weekly revenue than your current cadence.${riskWarning} ${isConfident ? 'Scale up to this frequency.' : 'Try this frequency for a month to see if results hold.'}`,
        sample: formatSample(),
        baselineKey: dominant.key,
        targetKey: bestBucket.key,
        baselineWeeklyRevenue: baselineRevenue,
        targetWeeklyRevenue: targetRevenue,
        estimatedWeeklyGain: weeklyDiff,
        estimatedMonthlyGain: weeklyDiff * 4,
        metadata: { strategy: 'scale-revenue-max', risk: isYellow ? 'yellow' : 'green' },
      };
  }

  // Case C: Scale Down (Best is Lower Frequency)
  if (orderMap[bestBucket.key] < orderMap[dominant.key]) {
      return {
        status: 'send-less',
        recommendationKind: 'reduce',
        cadenceLabel: labelForFrequencyBucket(bestBucket.key) + riskLabel,
        title: `Send ${actionLabelForFrequencyBucket(bestBucket.key)}`,
        message: `${labelForFrequencyBucket(bestBucket.key)} generates ${liftPct} more revenue than your current cadence.${riskWarning} Consider reducing frequency to maximize return.`,
        sample: formatSample(),
        baselineKey: dominant.key,
        targetKey: bestBucket.key,
        baselineWeeklyRevenue: baselineRevenue,
        targetWeeklyRevenue: targetRevenue,
        estimatedWeeklyGain: weeklyDiff,
        estimatedMonthlyGain: weeklyDiff * 4,
        metadata: { strategy: 'reduce-revenue-max', risk: isYellow ? 'yellow' : 'green' },
      };
  }

  return null;
}
