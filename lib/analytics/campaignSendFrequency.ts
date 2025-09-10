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
