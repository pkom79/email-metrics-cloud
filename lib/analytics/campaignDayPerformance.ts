import type { ProcessedCampaign } from '../data/dataTypes';

// Day keys aligned to Monday-first weekly analyses elsewhere (Mon..Sun)
export type DowKey = 'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun';

export interface DowAggregate {
  day: DowKey;
  campaigns: number;
  emailsSent: number;
  revenue: number;
  opens: number;
  clicks: number;
  orders: number;
  unsubs: number;
  spam: number;
  revPerEmail: number;
  openRate: number;      // 0-100 (percent)
  clickRate: number;     // 0-100
  conversionRate: number;// orders / emails (0-100)
  unsubRate: number;     // 0-100
  spamRate: number;      // 0-100
  revenueIndex: number;
  engagementIndex: number;
  riskIndex: number;
  compositeScore: number;
  volatile?: boolean;
  eligible: boolean;
}

export interface CampaignDayPerformanceRecommendation {
  state: 'normal' | 'not_enough_data' | 'even' | 'risk_shift' | 'consider' | 'exploratory';
  headline: string;
  body: string[]; // one or two short paragraphs/sentences
  sampleLine?: string;
  recommendedDays?: DowKey[];
  considerDays?: DowKey[];
  excludedRiskDays?: DowKey[];
  debug?: any; // non-rendered rationale for future inspection
}

export interface CampaignDayPerformanceInputs {
  campaigns: ProcessedCampaign[];
  rangeStart: Date; // to compute full weeks observed
  rangeEnd: Date;
  frequencyRecommendation?: number; // 1..7 (we will map 5..7 -> 4 days max per spec)
  dateRangeLabel?: string; // optional for sample line
  minWeeks?: number; // override for testing (default 4)
}

const DAY_LABELS: DowKey[] = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust to Monday
  d.setDate(diff);
  return d;
}

function countFullWeeks(rangeStart: Date, rangeEnd: Date): number {
  if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date)) return 0;
  const startMon = mondayOf(rangeStart);
  const endMon = mondayOf(rangeEnd);
  const ms = endMon.getTime() - startMon.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (7*24*60*60*1000)) + 1; // inclusive Mondays
}

interface InternalAgg { day: DowKey; campaigns: number; emails: number; revenue: number; opens: number; clicks: number; orders: number; unsubs: number; spam: number; largestCampaignEmails: number; largestCampaignRevenue: number; secondCampaignRevenue: number; }

export function computeCampaignDayPerformance({ campaigns, rangeStart, rangeEnd, frequencyRecommendation, dateRangeLabel, minWeeks = 4 }: CampaignDayPerformanceInputs): { aggregates: DowAggregate[]; recommendation: CampaignDayPerformanceRecommendation } {
  // Defensive copies / guards
  if (!Array.isArray(campaigns) || !campaigns.length) {
    return {
      aggregates: [],
      recommendation: {
        state: 'not_enough_data',
        headline: 'Not enough data for day-of-week guidance.',
        body: ['No campaigns were found in this date range.'],
      }
    };
  }

  const weeksObserved = countFullWeeks(rangeStart, rangeEnd);
  if (weeksObserved < minWeeks) {
    return {
      aggregates: [],
      recommendation: {
        state: 'not_enough_data',
        headline: 'Not enough data for day-of-week guidance.',
        body: [`At least ${minWeeks} full weeks are required. Only ${weeksObserved} observed.`],
        sampleLine: weeksObserved ? `Based on ${weeksObserved} week${weeksObserved===1?'':'s'} of data.` : undefined,
      }
    };
  }

  // Build per-day aggregates
  const base: Record<DowKey, InternalAgg> = {
    Mon: { day:'Mon', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
    Tue: { day:'Tue', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
    Wed: { day:'Wed', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
    Thu: { day:'Thu', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
    Fri: { day:'Fri', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
    Sat: { day:'Sat', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
    Sun: { day:'Sun', campaigns:0, emails:0, revenue:0, opens:0, clicks:0, orders:0, unsubs:0, spam:0, largestCampaignEmails:0, largestCampaignRevenue:0, secondCampaignRevenue:0 },
  };

  const perDayCampaigns: Record<DowKey, { emails: number; revenue: number; }[]> = { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] };

  for (const c of campaigns) {
    if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
    const jsDow = c.sentDate.getDay(); // 0 Sun .. 6 Sat
    const key: DowKey = jsDow === 0 ? 'Sun' : jsDow === 1 ? 'Mon' : jsDow === 2 ? 'Tue' : jsDow === 3 ? 'Wed' : jsDow === 4 ? 'Thu' : jsDow === 5 ? 'Fri' : 'Sat';
    const agg = base[key];
    agg.campaigns += 1;
    agg.emails += c.emailsSent || 0;
    agg.revenue += c.revenue || 0;
    agg.opens += c.uniqueOpens || 0;
    agg.clicks += c.uniqueClicks || 0;
    agg.orders += c.totalOrders || 0;
    agg.unsubs += c.unsubscribesCount || 0;
    agg.spam += c.spamComplaintsCount || 0;
    perDayCampaigns[key].push({ emails: c.emailsSent || 0, revenue: c.revenue || 0 });
  }

  // Determine volatility (single large campaign spike) and largest/second revenue
  for (const day of DAY_LABELS) {
    const list = perDayCampaigns[day].sort((a,b)=> b.emails - a.emails);
    if (list.length) {
      const largest = list[0];
      const largestEmails = largest.emails;
      base[day].largestCampaignEmails = largestEmails;
    }
    const revSorted = [...perDayCampaigns[day]].sort((a,b)=> b.revenue - a.revenue);
    if (revSorted.length) {
      base[day].largestCampaignRevenue = revSorted[0].revenue;
      base[day].secondCampaignRevenue = revSorted[1]?.revenue || 0;
    }
  }

  const aggregates: DowAggregate[] = [];
  let totalEmailsRaw = 0, totalRevenue = 0, totalOpens = 0, totalClicks = 0, totalOrders = 0, totalUnsubs = 0, totalSpam = 0;
  for (const day of DAY_LABELS) {
    const b = base[day];
    totalEmailsRaw += b.emails; totalRevenue += b.revenue; totalOpens += b.opens; totalClicks += b.clicks; totalOrders += b.orders; totalUnsubs += b.unsubs; totalSpam += b.spam;
  }

  const weightedRevPerEmail = totalEmailsRaw > 0 ? totalRevenue / totalEmailsRaw : 0;
  const weightedOpenRate = totalEmailsRaw > 0 ? (totalOpens / totalEmailsRaw) : 0; // proportion 0-1
  const weightedClickRate = totalEmailsRaw > 0 ? (totalClicks / totalEmailsRaw) : 0;
  const weightedConversionRate = totalEmailsRaw > 0 ? (totalOrders / totalEmailsRaw) : 0;
  const weightedUnsubRate = totalEmailsRaw > 0 ? (totalUnsubs / totalEmailsRaw) : 0;
  const weightedSpamRate = totalEmailsRaw > 0 ? (totalSpam / totalEmailsRaw) : 0;

  const MIN_EMAILS_PER_DAY = Math.max(1000, Math.round(0.02 * totalEmailsRaw));
  const MIN_CAMPAIGNS_PER_DAY = 3;
  const VOLATILE_CAMPAIGN_SHARE = 0.60;
  const VOLATILE_DAMPEN = 0.70;
  const CLEAR_WINNER_SCORE_RATIO = 1.05;
  const CLUSTER_SCORE_DELTA = 0.04; // absolute difference
  const RISK_SPAM_CAUTION = 0.003; // 0.3%
  const RISK_SPAM_BLOCK = 0.005;   // 0.5%
  const RISK_UNSUB_CAUTION_ADD = 0.0015; // +0.15 pp

  for (const day of DAY_LABELS) {
    const b = base[day];
    const revPerEmail = b.emails > 0 ? b.revenue / b.emails : 0;
    const openRate = b.emails > 0 ? (b.opens / b.emails) * 100 : 0;
    const clickRate = b.emails > 0 ? (b.clicks / b.emails) * 100 : 0;
    const conversionRate = b.emails > 0 ? (b.orders / b.emails) * 100 : 0;
    const unsubRate = b.emails > 0 ? (b.unsubs / b.emails) * 100 : 0;
    const spamRate = b.emails > 0 ? (b.spam / b.emails) * 100 : 0;
    const eligible = (b.campaigns >= MIN_CAMPAIGNS_PER_DAY) || (b.emails >= MIN_EMAILS_PER_DAY);
    let revenueIndex = weightedRevPerEmail > 0 ? revPerEmail / weightedRevPerEmail : 0;
    const openProp = b.emails > 0 ? (b.opens / b.emails) : 0; // 0-1
    const clickProp = b.emails > 0 ? (b.clicks / b.emails) : 0;
    const convProp = b.emails > 0 ? (b.orders / b.emails) : 0;
    const engagementIndex = (
      0.5 * (weightedOpenRate > 0 ? openProp / weightedOpenRate : 0) +
      0.3 * (weightedClickRate > 0 ? clickProp / weightedClickRate : 0) +
      0.2 * (weightedConversionRate > 0 ? convProp / weightedConversionRate : 0)
    );
    const unsubProp = b.emails > 0 ? (b.unsubs / b.emails) : 0;
    const spamProp = b.emails > 0 ? (b.spam / b.emails) : 0;
    const unsubDelta = Math.max(0, ((unsubProp - weightedUnsubRate) / Math.max(weightedUnsubRate, 0.0001)));
    const spamDelta = Math.max(0, ((spamProp - weightedSpamRate) / Math.max(weightedSpamRate, 0.00005)));
    let rawRisk = 0.6 * spamDelta + 0.4 * unsubDelta;
    if (rawRisk > 0.40) rawRisk = 0.40;
    let riskIndex = 1 - rawRisk; // 0.6..1 range typically
    // Volatility check
    const volatile = b.emails > 0 && b.largestCampaignEmails / Math.max(1, b.emails) >= VOLATILE_CAMPAIGN_SHARE && (b.largestCampaignRevenue >= 2.5 * Math.max(1, b.secondCampaignRevenue));
    if (volatile) revenueIndex *= VOLATILE_DAMPEN;
    const compositeScore = (0.55 * revenueIndex) + (0.25 * engagementIndex) + (0.20 * riskIndex);
    aggregates.push({ day, campaigns: b.campaigns, emailsSent: b.emails, revenue: b.revenue, opens: b.opens, clicks: b.clicks, orders: b.orders, unsubs: b.unsubs, spam: b.spam, revPerEmail, openRate, clickRate, conversionRate, unsubRate, spamRate, revenueIndex, engagementIndex, riskIndex, compositeScore, volatile, eligible });
  }

  const eligibleDays = aggregates.filter(a => a.eligible);
  const totalCampaigns = campaigns.length;
  const totalEmails = totalEmailsFormatter(totalEmailsRaw);
  if (eligibleDays.length < 1) {
    return {
      aggregates,
      recommendation: {
        state: 'not_enough_data',
        headline: 'Not enough data for day-of-week guidance.',
        body: [`No day met the sample bar (≥${MIN_CAMPAIGNS_PER_DAY} campaigns or ≥${MIN_EMAILS_PER_DAY.toLocaleString()} emails).`],
        sampleLine: `Based on ${weeksObserved} weeks / ${totalCampaigns} campaigns (${totalEmails} emails).`
      }
    };
  }

  if (eligibleDays.length === 1) {
    const d = eligibleDays[0];
    return {
      aggregates,
      recommendation: {
        state: 'exploratory',
        headline: `Use ${d.day} as an anchor day.`,
        body: [`Only ${d.day} passed sampling so far. Continue testing other days before locking a pattern.`],
        sampleLine: `Based on ${weeksObserved} weeks / ${totalCampaigns} campaigns (${totalEmails} emails).`,
        recommendedDays: [d.day]
      }
    };
  }

  // Sort by composite
  eligibleDays.sort((a,b)=> b.compositeScore - a.compositeScore);
  const top = eligibleDays[0];
  const second = eligibleDays[1];

  // Even performance detection
  const compScores = eligibleDays.map(d=> d.compositeScore);
  const maxComp = Math.max(...compScores);
  const minComp = Math.min(...compScores);
  if ((maxComp - minComp) < 0.06) {
    return {
      aggregates,
      recommendation: {
        state: 'even',
        headline: 'Performance is even across days.',
        body: ['Revenue and engagement vary <6% among sampled days. Maintain consistency. Focus testing on creative rather than shifting send days.'],
        sampleLine: `Based on ${weeksObserved} weeks / ${totalCampaigns} campaigns (${totalEmails} emails).`
      }
    };
  }

  const clearWinner = top && second && top.compositeScore >= second.compositeScore * CLEAR_WINNER_SCORE_RATIO && top.revenueIndex >= 1.05;

  // Form cluster (within absolute delta + revenueIndex guard)
  const cluster = eligibleDays.filter(d => (top.compositeScore - d.compositeScore) <= CLUSTER_SCORE_DELTA && d.revenueIndex >= 0.95);

  // Determine requested recommendation count (N)
  let freqRec = frequencyRecommendation;
  if (!freqRec || freqRec < 1) {
    // Infer from total campaigns / weeksObserved rounded, cap 4
    const inferred = weeksObserved > 0 ? Math.round(totalCampaigns / weeksObserved) : 1;
    freqRec = Math.min(4, Math.max(1, inferred));
  }
  if (freqRec > 4) freqRec = 4; // cap per spec

  const inclusionRatio = freqRec === 1 ? 1 : freqRec === 2 ? 0.92 : freqRec === 3 ? 0.90 : 0.88;
  const targetDays = eligibleDays.filter(d => d.compositeScore >= top.compositeScore * inclusionRatio).slice(0, freqRec);
  if (targetDays.length < freqRec) {
    // expand with next best if needed until freqRec or run out
    for (const d of eligibleDays) {
      if (targetDays.length >= freqRec) break;
      if (!targetDays.includes(d)) targetDays.push(d);
    }
  }

  // Risk gating for top revenue day
  const risky: DowAggregate[] = [];
  for (const d of targetDays) {
    if ((d.spamRate/100) >= RISK_SPAM_BLOCK || (d.unsubRate/100) >= ((weightedUnsubRate + RISK_UNSUB_CAUTION_ADD) * 100) ) {
      risky.push(d);
    }
  }

  const recommendedDays: DowKey[] = targetDays.map(d=> d.day);
  const considerDays: DowKey[] = [];
  const excludedRiskDays: DowKey[] = risky.map(r=> r.day);

  if (risky.length) {
    // Remove risky days from recommendation unless they are the only ones
    for (const r of risky) {
      if (recommendedDays.length > 1) {
        const idx = recommendedDays.indexOf(r.day);
        if (idx >= 0) recommendedDays.splice(idx,1);
        // Add a safe alternate if available
        for (const alt of eligibleDays) {
          if (!recommendedDays.includes(alt.day) && !excludedRiskDays.includes(alt.day)) {
            recommendedDays.push(alt.day);
            break;
          }
        }
      }
    }
  }

  // If clear winner and frequency 1 -> single-day headline
  const sampleLine = `Based on ${weeksObserved} weeks / ${totalCampaigns} campaigns (${totalEmails} emails).`;
  const formatPct = (v: number) => `${(v).toFixed(v >= 10 ? 1 : 2)}%`;
  const formatCurrency = (v: number) => `$${v.toFixed(2)}`;

  if (freqRec === 1 && clearWinner) {
    const lift = weightedRevPerEmail > 0 ? ((top.revPerEmail - weightedRevPerEmail)/ weightedRevPerEmail) * 100 : 0;
    const revLift = lift > 0 ? `${lift.toFixed(lift >= 10 ? 0 : 1)}% higher` : 'on par';
    return {
      aggregates,
      recommendation: {
        state: 'normal',
        headline: `Prioritize ${top.day} sends.`,
        body: [`${top.day} delivered ${revLift} revenue per email (${formatCurrency(top.revPerEmail)} vs ${formatCurrency(weightedRevPerEmail)}) with stable engagement (open ${formatPct(top.openRate)}, click ${formatPct(top.clickRate)}) and low risk (spam ${formatPct(top.spamRate)}, unsub ${formatPct(top.unsubRate)}).`],
        sampleLine,
        recommendedDays: [top.day],
        debug: { clearWinner, cluster: cluster.map(d=>d.day) }
      }
    };
  }

  if (freqRec === 1 && !clearWinner) {
    const d1 = top; const d2 = second;
    return {
      aggregates,
      recommendation: {
        state: 'consider',
        headline: `No clear leader–consider ${d1.day} or ${d2.day}.`,
        body: ['Performance differences are within normal variance. Keep testing while avoiding overfitting to short-term spikes.'],
        sampleLine,
        recommendedDays: [d1.day, d2.day]
      }
    };
  }

  // Multi-day headline
  const recDaysAggs = recommendedDays.map(d => eligibleDays.find(a=> a.day === d)!).filter(Boolean);
  const avgClusterRev = recDaysAggs.reduce((s,a)=> s + a.revPerEmail, 0) / Math.max(1, recDaysAggs.length);
  const clusterLift = weightedRevPerEmail > 0 ? ((avgClusterRev - weightedRevPerEmail)/weightedRevPerEmail)*100 : 0;
  const clusterLiftTxt = clusterLift > 0 ? `${clusterLift.toFixed(clusterLift >= 10 ? 0 : 1)}% over baseline` : 'in line with baseline';
  const headline = `Focus sends on ${recommendedDays.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
  const body = [`These days form the top performance cluster (avg revenue/email ${formatCurrency(avgClusterRev)}; ${clusterLiftTxt}) without meaningful engagement tradeoffs.`];
  if (risky.length) body.push(`Monitoring elevated complaints on ${excludedRiskDays.join(', ')}–keep copy and segmentation tight.`);

  return {
    aggregates,
    recommendation: {
      state: 'normal',
      headline,
      body,
      sampleLine,
      recommendedDays,
      considerDays,
      excludedRiskDays,
      debug: { cluster: cluster.map(d=> d.day), freqRec, inclusionRatio }
    }
  };
}

function totalEmailsFormatter(n: number): string { return n.toLocaleString(); }
