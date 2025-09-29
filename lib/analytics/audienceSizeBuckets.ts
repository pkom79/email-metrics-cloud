import type { ProcessedCampaign } from "../data/dataTypes";
import { DataManager } from "../data/dataManager";

export interface AudienceSizeBucket {
  key: string;
  rangeLabel: string;
  rangeMin: number;
  rangeMax: number;
  totalCampaigns: number;
  totalEmailsSent: number;
  avgCampaignEmails: number;
  totalRevenue: number;
  avgCampaignRevenue: number;
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
  campaigns: ProcessedCampaign[];
}

export interface AudienceSizeBucketsResult {
  buckets: AudienceSizeBucket[];
  limited: boolean;
  lookbackWeeks: number;
}

const MIN_THRESHOLD_EMAILS = 100;

function niceRangeLabel(lo: number, hi: number): string {
  const format = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
    return `${n}`;
  };
  const roundTo = (x: number) => {
    if (x >= 1_000_000) return Math.round(x / 100_000) * 100_000;
    if (x >= 100_000) return Math.round(x / 10_000) * 10_000;
    if (x >= 10_000) return Math.round(x / 1_000) * 1_000;
    if (x >= 1_000) return Math.round(x / 100) * 100;
    return Math.round(x);
  };
  return `${format(roundTo(lo))}–${format(roundTo(hi))}`;
}

export function computeAudienceSizeBuckets(
  campaigns: ProcessedCampaign[],
  dateRange: string,
  customFrom?: string,
  customTo?: string
): AudienceSizeBucketsResult {
  const dm = DataManager.getInstance();
  const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  const start = resolved?.startDate;
  const end = resolved?.endDate;

  const filteredCampaigns = campaigns.filter((c) => {
    const emails = Number(c.emailsSent || 0);
    if (!Number.isFinite(emails) || emails < MIN_THRESHOLD_EMAILS) return false;
    if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) return false;
    if (start && c.sentDate < start) return false;
    if (end && c.sentDate > end) return false;
    return true;
  });

  if (!filteredCampaigns.length) {
    return { buckets: [], limited: true, lookbackWeeks: 0 };
  }

  const sorted = [...filteredCampaigns].sort((a, b) => a.emailsSent - b.emailsSent);
  const min = sorted[0].emailsSent;
  const max = sorted[sorted.length - 1].emailsSent;

  const boundaries: number[] = [min];
  if (sorted.length >= 12 && min !== max) {
    const percentile = (p: number) => {
      const idx = (sorted.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo].emailsSent;
      const weight = idx - lo;
      return Math.round(
        sorted[lo].emailsSent * (1 - weight) + sorted[hi].emailsSent * weight
      );
    };
    boundaries.push(percentile(0.25), percentile(0.5), percentile(0.75), max);
  } else if (min === max) {
    boundaries.push(max, max, max, max);
  } else {
    for (let i = 1; i <= 4; i++) {
      boundaries.push(Math.round(min + (i * (max - min)) / 4));
    }
  }

  const ranges: Array<[number, number]> = [
    [boundaries[0], boundaries[1]],
    [boundaries[1], boundaries[2]],
    [boundaries[2], boundaries[3]],
    [boundaries[3], boundaries[4]],
  ];

  const buckets: AudienceSizeBucket[] = ranges
    .map(([lo, hi], idx) => {
      const campaignsInBucket = sorted.filter((c) =>
        idx === 0 ? c.emailsSent >= lo && c.emailsSent <= hi : c.emailsSent > lo && c.emailsSent <= hi
      );

      const totals = campaignsInBucket.reduce(
        (acc, c) => {
          acc.emails += c.emailsSent || 0;
          acc.revenue += c.revenue || 0;
          acc.orders += c.totalOrders || 0;
          acc.opens += c.uniqueOpens || 0;
          acc.clicks += c.uniqueClicks || 0;
          acc.unsubs += c.unsubscribesCount || 0;
          acc.spam += c.spamComplaintsCount || 0;
          acc.bounces += c.bouncesCount || 0;
          return acc;
        },
        {
          emails: 0,
          revenue: 0,
          orders: 0,
          opens: 0,
          clicks: 0,
          unsubs: 0,
          spam: 0,
          bounces: 0,
        }
      );

      const totalCampaigns = campaignsInBucket.length;
      if (!totalCampaigns) return null;

      const avgCampaignRevenue = totals.revenue / totalCampaigns;
      const avgCampaignEmails = totals.emails / totalCampaigns;
      const avgOrderValue = totals.orders > 0 ? totals.revenue / totals.orders : 0;
      const revenuePerEmail = totals.emails > 0 ? totals.revenue / totals.emails : 0;
      const conversionRate = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;
      const openRate = totals.emails > 0 ? (totals.opens / totals.emails) * 100 : 0;
      const clickRate = totals.emails > 0 ? (totals.clicks / totals.emails) * 100 : 0;
      const clickToOpenRate = totals.opens > 0 ? (totals.clicks / totals.opens) * 100 : 0;
      const unsubscribeRate = totals.emails > 0 ? (totals.unsubs / totals.emails) * 100 : 0;
      const spamRate = totals.emails > 0 ? (totals.spam / totals.emails) * 100 : 0;
      const bounceRate = totals.emails > 0 ? (totals.bounces / totals.emails) * 100 : 0;

      return {
        key: `${idx}`,
        rangeLabel: niceRangeLabel(lo, hi),
        rangeMin: lo,
        rangeMax: hi,
        totalCampaigns,
        totalEmailsSent: totals.emails,
        avgCampaignEmails,
        totalRevenue: totals.revenue,
        avgCampaignRevenue,
        avgOrderValue,
        revenuePerEmail,
        conversionRate,
        openRate,
        clickRate,
        clickToOpenRate,
        avgWeeklyEmailsSent: 0,
        unsubscribeRate,
        spamRate,
        bounceRate,
        campaigns: campaignsInBucket,
      } satisfies AudienceSizeBucket;
    })
    .filter(Boolean) as AudienceSizeBucket[];

  const msPerDay = 24 * 60 * 60 * 1000;
  const lookbackWeeks = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay) / 7) : 0;

  const limited = buckets.reduce((sum, b) => sum + b.totalCampaigns, 0) < 12;

  // Compute avg weekly emails using lookback weeks
  const weeks = Math.max(1, Math.round(lookbackWeeks));
  buckets.forEach((b) => {
    b.avgWeeklyEmailsSent = weeks > 0 ? b.totalEmailsSent / weeks : 0;
  });

  return { buckets, limited, lookbackWeeks: Math.max(1, Math.round(lookbackWeeks)) };
}

