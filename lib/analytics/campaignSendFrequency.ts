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

const MIN_WEEKS = 4;
const MIN_EMAILS = 1000;
const VARIATION_WEEKS_THRESHOLD = 8;
const LIFT_THRESHOLD = 0.1;
const ENGAGEMENT_DROP_LIMIT = -0.05;
const SPAM_DELTA_LIMIT = 0.05;
const BOUNCE_DELTA_LIMIT = 0.1;
const HIGH_SPAM_ALERT = 0.3;
const HIGH_BOUNCE_ALERT = 0.5;
const OPEN_HEALTHY_MIN = 12;
const CLICK_HEALTHY_MIN = 1;
const UNSUB_WARN = 0.5;
const SPAM_WARN = 0.15;
const BOUNCE_WARN = 0.5;
const CONSERVATIVE_FACTOR = 0.5;

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
      return '1 campaign per week';
    case '2':
      return '2 campaigns per week';
    case '3':
      return '3 campaigns per week';
    default:
      return '4 or more campaigns per week';
  }
}

function deltaRatio(candidate: number, baseline: number) {
  if (!isFinite(candidate) || !isFinite(baseline)) return 0;
  if (baseline === 0) return candidate === 0 ? 0 : Infinity;
  return (candidate - baseline) / baseline;
}

function describeIssues(bucket: FrequencyBucketAggregate, revenue: number) {
  const issues: string[] = [];
  if (revenue <= 0) issues.push('revenue is flat');
  if (bucket.openRate < OPEN_HEALTHY_MIN) issues.push(`opens are below ${OPEN_HEALTHY_MIN}%`);
  if (bucket.clickRate < CLICK_HEALTHY_MIN) issues.push(`clicks are below ${CLICK_HEALTHY_MIN}%`);
  if (bucket.unsubscribeRate > UNSUB_WARN) issues.push(`unsubscribes exceed ${UNSUB_WARN}%`);
  if (bucket.spamRate > SPAM_WARN) issues.push('spam complaints are elevated');
  if (bucket.bounceRate > BOUNCE_WARN) issues.push('bounce rate is high');
  if (!issues.length) return 'engagement needs improvement';
  if (issues.length === 1) return issues[0];
  return `${issues.slice(0, -1).join(', ')}, and ${issues[issues.length - 1]}`;
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

  const eligible = buckets.filter((b) => b.weeksCount >= MIN_WEEKS && b.sumEmails >= MIN_EMAILS);

  const pickBaseline = () => {
    if (!eligible.length) return null;
    const sorted = [...eligible].sort((a, b) => {
      if (b.weeksCount !== a.weeksCount) return b.weeksCount - a.weeksCount;
      return orderMap[a.key] - orderMap[b.key];
    });
    return sorted[0];
  };

  const baseline = pickBaseline();

  if (!baseline) {
    const richest = buckets.reduce<FrequencyBucketAggregate | null>((best, curr) => (curr.weeksCount > (best?.weeksCount ?? 0) ? curr : best), null);
    const cadenceLabel = richest ? labelForFrequencyBucket(richest.key) : 'current cadence';
    const hasWeeksButLowVolume = buckets.some((b) => b.weeksCount >= MIN_WEEKS && b.sumEmails < MIN_EMAILS);
    let message: string;
    if (totalWeeksAll < MIN_WEEKS) {
      if (totalWeeksAll === 0) message = 'No complete campaign weeks fall inside this date range yet. Expand the window or keep sending to unlock guidance.';
      else message = `This date range includes only ${totalWeeksAll} ${pluralize('week', totalWeeksAll)} of campaign data. Expand the range or keep sending before changing cadence.`;
    } else if (hasWeeksButLowVolume) {
      message = `Each cadence ran with fewer than ${MIN_EMAILS.toLocaleString()} emails. Run larger sends at ${cadenceLabel} to measure impact confidently.`;
    } else {
      message = 'Cadence tests were too short to compare. Extend each cadence for at least four weeks before making frequency changes.';
    }
    return {
      status: 'insufficient',
      recommendationKind: 'insufficient',
      cadenceLabel,
      title: 'Not enough data for a recommendation',
      message,
      sample: formatSample(),
      estimatedWeeklyGain: null,
      estimatedMonthlyGain: null,
    };
  }

  const baselineLabel = labelForFrequencyBucket(baseline.key);
  const higher = eligible
    .filter((b) => orderMap[b.key] > orderMap[baseline.key])
    .sort((a, b) => orderMap[a.key] - orderMap[b.key]);
  const lower = eligible
    .filter((b) => orderMap[b.key] < orderMap[baseline.key])
    .sort((a, b) => orderMap[b.key] - orderMap[a.key]);

  const baselineRevenue = getRevenueValue(baseline);
  const acceptance = (candidate: FrequencyBucketAggregate) => {
    const candidateRevenue = getRevenueValue(candidate);
    const lift = baselineRevenue === 0
      ? (candidateRevenue > 0 ? Infinity : 0)
      : (candidateRevenue - baselineRevenue) / baselineRevenue;
    const openDelta = deltaRatio(candidate.openRate, baseline.openRate);
    const clickDelta = deltaRatio(candidate.clickRate, baseline.clickRate);
    const spamDelta = candidate.spamRate - baseline.spamRate;
    const bounceDelta = candidate.bounceRate - baseline.bounceRate;
    return { lift, openDelta, clickDelta, spamDelta, bounceDelta, candidateRevenue };
  };

  for (const candidate of higher) {
    const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = acceptance(candidate);
    const engagementSafe = openDelta >= ENGAGEMENT_DROP_LIMIT && clickDelta >= ENGAGEMENT_DROP_LIMIT;
    const riskSafe = spamDelta <= SPAM_DELTA_LIMIT && bounceDelta <= BOUNCE_DELTA_LIMIT;
    if (lift >= LIFT_THRESHOLD && engagementSafe && riskSafe) {
      const liftPct = lift === Infinity ? 'from zero' : formatPercent(lift);
      const title = `Send ${actionLabelForFrequencyBucket(candidate.key)}`;
      const message = lift === Infinity
        ? `${labelForFrequencyBucket(candidate.key)} has revenue where ${baselineLabel} does not. Scale testing into this cadence while monitoring engagement.`
        : `${labelForFrequencyBucket(candidate.key)} weeks delivered ${liftPct} more weekly revenue than ${baselineLabel}. Open and click rates stayed within 5% and spam/bounce remained under guardrails, so increase cadence toward this level.`;
      const weeklyDiff = (candidate.avgWeeklyRevenue - baseline.avgWeeklyRevenue) * CONSERVATIVE_FACTOR;
      return {
        status: 'send-more',
        recommendationKind: 'scale',
        cadenceLabel: labelForFrequencyBucket(candidate.key),
        title,
        message,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: candidate.key,
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: candidate.avgWeeklyRevenue,
        estimatedWeeklyGain: weeklyDiff,
        estimatedMonthlyGain: weeklyDiff * 4,
        metadata: { strategy: 'scale' },
      };
    }
  }

  const exploratoryHigher = buckets.filter((b) => orderMap[b.key] > orderMap[baseline.key] && (b.weeksCount > 0 || b.sumEmails > 0) && !eligible.includes(b));
  for (const candidate of exploratoryHigher) {
    const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = acceptance(candidate);
    const engagementSafe = openDelta >= ENGAGEMENT_DROP_LIMIT && clickDelta >= ENGAGEMENT_DROP_LIMIT;
    const riskSafe = spamDelta <= SPAM_DELTA_LIMIT && bounceDelta <= BOUNCE_DELTA_LIMIT;
    if (lift >= LIFT_THRESHOLD && engagementSafe && riskSafe) {
      const limitedWeeks = candidate.weeksCount;
      const limitedCopy = limitedWeeks > 0
        ? `${limitedWeeks} ${pluralize('week', limitedWeeks)} of ${labelForFrequencyBucket(candidate.key)} data`
        : `${labelForFrequencyBucket(candidate.key)} tests so far`;
      const title = `Test ${actionLabelForFrequencyBucket(candidate.key)}`;
      const liftPct = lift === Infinity ? 'from zero' : formatPercent(lift);
      const msg = `${limitedCopy} show ${liftPct} higher weekly revenue than ${baselineLabel}. Schedule a four-week test at this cadence and keep an eye on engagement.`;
      return {
        status: 'send-more',
        recommendationKind: 'test',
        cadenceLabel: labelForFrequencyBucket(candidate.key),
        title,
        message: msg,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: candidate.key,
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: candidate.avgWeeklyRevenue,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
        metadata: { strategy: 'test' },
      };
    }
  }

  const riskyBaseline = baseline.spamRate >= HIGH_SPAM_ALERT || baseline.bounceRate >= HIGH_BOUNCE_ALERT;

  for (const candidate of lower) {
    const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = acceptance(candidate);
    const lessRisk = spamDelta < -SPAM_DELTA_LIMIT || bounceDelta < -BOUNCE_DELTA_LIMIT || riskyBaseline;
    const revenueOkay = lift >= -0.1;
    if (lessRisk && revenueOkay) {
      const title = `Send ${actionLabelForFrequencyBucket(candidate.key)}`;
      const msg = `${baselineLabel} shows rising risk (spam or bounce). Drop back to ${labelForFrequencyBucket(candidate.key)} to stabilize engagement while keeping revenue within 10% of current results.`;
      return {
        status: 'send-less',
        recommendationKind: 'reduce',
        cadenceLabel: labelForFrequencyBucket(candidate.key),
        title,
        message: msg,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: candidate.key,
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: candidate.avgWeeklyRevenue,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
        metadata: { strategy: 'risk-mitigation' },
      };
    }
    if (lift >= LIFT_THRESHOLD) {
      const title = `Send ${actionLabelForFrequencyBucket(candidate.key)}`;
      const msg = `${baselineLabel} underperforms ${labelForFrequencyBucket(candidate.key)} by ${formatPercent(lift)}. Shift down to recover revenue and reduce fatigue.`;
      const weeklyDiff = (baseline.avgWeeklyRevenue - candidate.avgWeeklyRevenue) * CONSERVATIVE_FACTOR;
      return {
        status: 'send-less',
        recommendationKind: 'reduce',
        cadenceLabel: labelForFrequencyBucket(candidate.key),
        title,
        message: msg,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: candidate.key,
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: candidate.avgWeeklyRevenue,
        estimatedWeeklyGain: weeklyDiff,
        estimatedMonthlyGain: weeklyDiff * 4,
        metadata: { strategy: 'recover' },
      };
    }
  }

  const onlyBucket = eligible.length === 1 && higher.length === 0 && lower.length === 0;
  if (onlyBucket) {
    const healthy = baselineRevenue > 0 && baseline.spamRate < HIGH_SPAM_ALERT && baseline.bounceRate < HIGH_BOUNCE_ALERT && baseline.openRate >= OPEN_HEALTHY_MIN && baseline.clickRate >= CLICK_HEALTHY_MIN;
    const issueSummary = describeIssues(baseline, baselineRevenue);
    const weeksAtCadence = baseline.weeksCount;
    if (healthy && orderMap[baseline.key] < 4) {
      const nextKey = ['1', '2', '3', '4+'][orderMap[baseline.key]] as FrequencyBucketKey | undefined;
      const nextLabel = nextKey ? labelForFrequencyBucket(nextKey) : 'a higher cadence';
      const title = `Test ${nextKey ? actionLabelForFrequencyBucket(nextKey) : 'a higher cadence'}`;
      const msg = weeksAtCadence >= VARIATION_WEEKS_THRESHOLD
        ? `${baselineLabel} has held strong for ${weeksAtCadence} ${pluralize('week', weeksAtCadence)}. Add ${nextLabel} for a four-week test to see if the lift holds.`
        : `${baselineLabel} is performing well with healthy engagement and low complaints. Run at least four weeks with ${nextKey ? nextLabel : 'a higher cadence'} to validate headroom.`;
      return {
        status: 'send-more',
        recommendationKind: 'test',
        cadenceLabel: nextLabel,
        title,
        message: msg,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: nextKey,
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: undefined,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
        metadata: { strategy: 'test' },
      };
    }
    if (orderMap[baseline.key] === 4) {
      const title = `Ease back to 3 campaigns per week`;
      const msg = `${baselineLabel} is aggressive with limited comparative data. If you see complaint spikes, test a three-campaign cadence to protect reputation.`;
      return {
        status: 'send-less',
        recommendationKind: 'reduce',
        cadenceLabel: '3 campaigns / week',
        title,
        message: msg,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: '3',
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: undefined,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
        metadata: { strategy: 'scale-back' },
      };
    }
    if (!healthy) {
      const title = `Stabilize ${actionLabelForFrequencyBucket(baseline.key)} before scaling`;
      const msg = `${baselineLabel} is struggling. ${issueSummary}. Tighten audience segments and creative at this cadence, then revisit higher-frequency tests.`;
      return {
        status: 'keep-as-is',
        recommendationKind: 'stay',
        cadenceLabel: baselineLabel,
        title,
        message: msg,
        sample: formatSample(),
        baselineKey: baseline.key,
        targetKey: baseline.key,
        baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
        targetWeeklyRevenue: baseline.avgWeeklyRevenue,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
        metadata: { strategy: 'stabilize' },
      };
    }
  }

  if (riskyBaseline && orderMap[baseline.key] === 4) {
    const title = `Send 3 campaigns per week`;
    const msg = `${baselineLabel} is triggering high spam or bounce rates without a safer alternative measured. Start dialing back to a 3-campaign cadence to protect deliverability.`;
    return {
      status: 'send-less',
      recommendationKind: 'reduce',
      cadenceLabel: '3 campaigns / week',
      title,
      message: msg,
      sample: formatSample(),
      baselineKey: baseline.key,
      targetKey: '3',
      baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
      targetWeeklyRevenue: undefined,
      estimatedWeeklyGain: null,
      estimatedMonthlyGain: null,
      metadata: { strategy: 'risk-mitigation' },
    };
  }

  const baselineAction = actionLabelForFrequencyBucket(baseline.key);
  const title = baselineAction ? `Stay at ${baselineAction}` : 'Keep current cadence';
  const msg = higher.length || lower.length
    ? `${baselineLabel} remains the most balanced cadence. Other buckets either lack enough weeks, miss the 10% revenue lift bar, or add spam/bounce risk. Maintain this schedule and retest after gathering more data.`
    : `${baselineLabel} is the only cadence with enough data. Continue collecting results and test another cadence when ready.`;

  return {
    status: 'keep-as-is',
    recommendationKind: 'stay',
    cadenceLabel: baselineLabel,
    title,
    message: msg,
    sample: formatSample(),
    baselineKey: baseline.key,
    targetKey: baseline.key,
    baselineWeeklyRevenue: baseline.avgWeeklyRevenue,
    targetWeeklyRevenue: baseline.avgWeeklyRevenue,
    estimatedWeeklyGain: null,
    estimatedMonthlyGain: null,
    metadata: { strategy: 'maintain' },
  };
}
