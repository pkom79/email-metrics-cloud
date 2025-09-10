import type { ProcessedCampaign } from "../data/dataTypes";

export type AudienceBucket = {
  key: string;
  rangeLabel: string;
  rangeMin: number;
  rangeMax: number;
  campaignCount: number;
  sumRevenue: number;
  sumEmails: number;
  sumOrders: number;
  sumOpens: number;
  sumClicks: number;
  sumUnsubs: number;
  sumSpam: number;
  sumBounces: number;
  avgCampaignRevenue: number;
  avgCampaignEmails: number;
  aov: number;
  revenuePerEmail: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  conversionRate: number;
  unsubscribeRate: number;
  spamRate: number;
  bounceRate: number;
};

function formatEmailsShort(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return `${n}`;
}

function niceRangeLabel(min: number, max: number) {
  const roundTo = (x: number) => {
    if (x >= 1_000_000) return Math.round(x / 100_000) * 100_000;
    if (x >= 100_000) return Math.round(x / 10_000) * 10_000;
    if (x >= 10_000) return Math.round(x / 1_000) * 1_000;
    if (x >= 1_000) return Math.round(x / 100) * 100;
    return Math.round(x);
  };
  const a = roundTo(min);
  const b = roundTo(max);
  return `${formatEmailsShort(a)}–${formatEmailsShort(b)}`;
}

export function computeAudienceSizeBuckets(campaigns: ProcessedCampaign[]): { buckets: AudienceBucket[]; limited: boolean } {
  if (!campaigns?.length) return { buckets: [], limited: true };

  const valid = campaigns.filter(c => typeof c.emailsSent === 'number' && c.emailsSent >= 0);
  const total = valid.length;

  // Hybrid threshold: P5 clamped to [100, 1000]; if < 12 campaigns, do not exclude
  let filtered = valid;
  if (total >= 12) {
    const sortedForP = [...valid].sort((a, b) => a.emailsSent - b.emailsSent);
    const p5Index = Math.max(0, Math.floor(0.05 * (sortedForP.length - 1)));
    const p5 = sortedForP[p5Index]?.emailsSent ?? 0;
    const threshold = Math.max(100, Math.min(1000, p5));
    filtered = sortedForP.filter(c => c.emailsSent >= threshold);
  }

  const sample = filtered.length;
  const limited = sample < 12;
  if (sample === 0) return { buckets: [], limited: true };

  const sorted = [...filtered].sort((a, b) => a.emailsSent - b.emailsSent);
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
    const q25 = q(0.25);
    const q50 = q(0.50);
    const q75 = q(0.75);
    boundaries.push(q25, q50, q75, max);
  } else {
    if (min === max) {
      boundaries.push(max, max, max, max);
    } else {
      for (let i = 1; i <= 4; i++) {
        const v = Math.round(min + (i * (max - min)) / 4);
        boundaries.push(v);
      }
    }
  }

  const bRanges = [
    [boundaries[0], boundaries[1]],
    [boundaries[1], boundaries[2]],
    [boundaries[2], boundaries[3]],
    [boundaries[3], boundaries[4]],
  ] as const;

  const buckets: AudienceBucket[] = bRanges.map((r, idx) => {
    const [lo, hi] = r;
    const bucketCampaigns = sorted.filter((c) => {
      const val = c.emailsSent;
      if (idx === 0) return val >= lo && val <= hi;
      return val > lo && val <= hi;
    });

    let sumRevenue = 0, sumEmails = 0, sumOrders = 0, sumOpens = 0, sumClicks = 0, sumUnsubs = 0, sumSpam = 0, sumBounces = 0;
    for (const c of bucketCampaigns) {
      sumRevenue += c.revenue || 0;
      sumEmails += c.emailsSent || 0;
      sumOrders += c.totalOrders || 0;
      sumOpens += c.uniqueOpens || 0;
      sumClicks += c.uniqueClicks || 0;
      sumUnsubs += c.unsubscribesCount || 0;
      sumSpam += c.spamComplaintsCount || 0;
      sumBounces += c.bouncesCount || 0;
    }

    const totalCampaigns = bucketCampaigns.length;
    const avgCampaignRevenue = totalCampaigns > 0 ? sumRevenue / totalCampaigns : 0;
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

    return {
      key: `${idx}`,
      rangeLabel: niceRangeLabel(lo, hi),
      rangeMin: lo,
      rangeMax: hi,
      campaignCount: totalCampaigns,
      sumRevenue, sumEmails, sumOrders, sumOpens, sumClicks, sumUnsubs, sumSpam, sumBounces,
      avgCampaignRevenue, avgCampaignEmails, aov, revenuePerEmail, openRate, clickRate, clickToOpenRate, conversionRate, unsubscribeRate, spamRate, bounceRate,
    };
  }).filter(b => b.campaignCount > 0);

  return { buckets, limited };
}
