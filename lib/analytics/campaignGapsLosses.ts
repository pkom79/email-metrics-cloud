import type { ProcessedCampaign, ProcessedFlowEmail } from '../data/dataTypes';
import { buildWeeklyAggregatesInRange } from './reliability';

export interface GapsLossesInputs {
  campaigns: ProcessedCampaign[];
  flows: ProcessedFlowEmail[];
  rangeStart: Date;
  rangeEnd: Date;
}

export interface GapsLossesResult {
  // Row 1 — Consistency & Gaps
  zeroCampaignSendWeeks: number;
  longestZeroSendGap: number;
  pctWeeksWithCampaignsSent: number; // 0-100
  // Explicit counts for tooltip "X of Y weeks"
  weeksWithCampaignsSent: number; // numerator (based on raw-campaign UTC buckets)
  weeksInRangeFull: number;       // denominator (full weeks fully within range)
  // Lists for tooltips
  zeroSendWeekStarts?: string[];      // ISO YYYY-MM-DD of week starts (complete weeks only)
  longestGapWeekStarts?: string[];    // ISO YYYY-MM-DD for the longest zero-send run (complete weeks only)
  // Row 2 — Impact & Effectiveness
  estimatedLostRevenue?: number; // undefined when insufficient data for computation
  lowEffectivenessCampaigns: number; // campaigns with revenue == 0
  zeroRevenueCampaigns?: number;     // alias for UI label
  zeroRevenueCampaignDetails?: { date: string; title: string }[]; // for tooltip list
  avgCampaignsPerWeek: number;
  totalCampaignsInFullWeeks?: number; // for tooltip explanation
  // Flags/notes
  allWeeksSent: boolean;
  insufficientWeeklyData: boolean; // true if < ceil(66%) of weeks in the selected range have campaigns sent
  hasLongGaps: boolean; // true if there exists a zero-send run >= 5 weeks (weekly analysis insufficient for those)
  // Hint: if we detect a very long zero-campaign stretch, surface as potential CSV export gap guidance
  suspectedCsvCoverageGap?: { weeks: number; start: string; end: string } | null;
}

// Percentile helper (p in [0,1]) using sorted copy; linear interpolation
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const arr = [...values].sort((a,b)=>a-b);
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  const w = idx - lo;
  return arr[lo] * (1 - w) + arr[hi] * w;
}

function median(values: number[]): number { if (!values.length) return 0; const s=[...values].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2? s[m] : (s[m-1]+s[m])/2; }

export function computeCampaignGapsAndLosses({ campaigns, flows, rangeStart, rangeEnd }: GapsLossesInputs): GapsLossesResult {
  // Build Monday-start weekly aggregates over selected range
  const weeks = buildWeeklyAggregatesInRange(campaigns, flows, rangeStart, rangeEnd);
  const completeWeeks = weeks.filter(w => w.isCompleteWeek);
  const totalCompleteWeeks = completeWeeks.length;
  const totalWeeksInRange = weeks.length;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  try {
    // eslint-disable-next-line no-console
  console.debug('[CampaignGaps&Losses] inputs', { rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), weeks: weeks.length, campaigns: campaigns.length });
  } catch {}
  // Weeks fully contained within the selected range (exclude partial first/last week segments)
  const fullInRangeWeeks = weeks.filter(w => {
    const weekStartMs = w.weekStart.getTime();
    const weekEndMs = weekStartMs + 7 * ONE_DAY - 1;
    return weekStartMs >= rangeStart.getTime() && weekEndMs <= rangeEnd.getTime();
  });

  // Guard: if no weeks, return zeros
  if (!totalWeeksInRange) {
    return {
      zeroCampaignSendWeeks: 0,
      longestZeroSendGap: 0,
      pctWeeksWithCampaignsSent: 0,
  weeksWithCampaignsSent: 0,
  weeksInRangeFull: 0,
      estimatedLostRevenue: undefined,
  lowEffectivenessCampaigns: 0,
  zeroRevenueCampaigns: 0,
      avgCampaignsPerWeek: 0,
      allWeeksSent: false,
  insufficientWeeklyData: true,
  hasLongGaps: false,
    };
  }

  // Classification
  const isZeroSend = (w: typeof weeks[number]) => (w.campaignsSent || 0) === 0 && (w.campaignRevenue || 0) === 0;
  const isZeroRevenue = (w: typeof weeks[number]) => (w.campaignsSent || 0) > 0 && (w.campaignRevenue || 0) === 0;

  let zeroSendWeeks = 0;
  let longestGap = 0;
  let longestGapStartIdx: number | null = null;
  let hasLongGaps = false;
  // Detect runs among complete weeks only
  let i = 0;
  while (i < completeWeeks.length) {
    if (isZeroSend(completeWeeks[i])) {
      let j = i;
      while (j < completeWeeks.length && isZeroSend(completeWeeks[j])) j++;
      const runLen = j - i;
      zeroSendWeeks += runLen;
      if (runLen > longestGap) { longestGap = runLen; longestGapStartIdx = i; }
      if (runLen > 4) hasLongGaps = true;
      i = j;
    } else {
      i++;
    }
  }

  // For coverage metrics and gating, evaluate against full weeks completely inside the selected range.
  const coverageDenom = fullInRangeWeeks.length;
  const sentWeeksAllAgg = fullInRangeWeeks.filter(w => (w.campaignsSent || 0) > 0).length;
  // We'll compute an alternate sent-weeks count directly from raw campaigns (defined below) and prefer it for coverage
  let sentWeeksAll = sentWeeksAllAgg;
  let pctWeeksWithCampaignsSent = coverageDenom > 0 ? (sentWeeksAll / coverageDenom) * 100 : 0;
  const totalCampaignsInFullWeeks = fullInRangeWeeks.reduce((s,w)=> s + (w.campaignsSent || 0), 0);
  const avgCampaignsPerWeek = coverageDenom > 0 ? (totalCampaignsInFullWeeks / coverageDenom) : 0;
  // Debug: surface coverage math to help diagnose gating issues in the field
  try {
    // eslint-disable-next-line no-console
  const sample = fullInRangeWeeks.map(w => ({ label: w.label, start: w.weekStart.toISOString().slice(0,10), sent: (w.campaignsSent||0) > 0, rev: w.campaignRevenue||0 }));
  // Alternate sent-week computation directly from raw campaigns, using UTC Monday buckets to align with weekly aggregator
  const ONE_WEEK = 7 * ONE_DAY;
  const startMonday = new Date(rangeStart);
  const startDayUTC = startMonday.getUTCDay();
  const startDiffUTC = (startDayUTC + 6) % 7;
  startMonday.setUTCDate(startMonday.getUTCDate() - startDiffUTC);
  startMonday.setUTCHours(0,0,0,0);
  const endMonday = new Date(rangeEnd);
  const endDayUTC = endMonday.getUTCDay();
  const endDiffUTC = (endDayUTC + 6) % 7;
  endMonday.setUTCDate(endMonday.getUTCDate() - endDiffUTC);
  endMonday.setUTCHours(0,0,0,0);
  const altMap: Record<string, number> = {};
    let campaignsInRange = 0;
    for (const c of campaigns) {
      if (!(c.sentDate instanceof Date)) continue;
      const dt = c.sentDate;
      if (dt < rangeStart || dt > rangeEnd) continue;
      campaignsInRange++;
  const ws = new Date(dt);
  const dayUTC = ws.getUTCDay();
  const diffUTC = (dayUTC + 6) % 7; // to Monday in UTC
  ws.setUTCDate(ws.getUTCDate() - diffUTC);
  ws.setUTCHours(0,0,0,0);
      if (ws < startMonday || ws > endMonday) continue;
      const key = ws.toISOString();
      altMap[key] = (altMap[key] || 0) + 1;
    }
  const altWeeks = fullInRangeWeeks.map(w => ({ key: w.weekStart.toISOString(), sent: (altMap[w.weekStart.toISOString()]||0) > 0, count: (altMap[w.weekStart.toISOString()]||0) }));
  const altSentWeeks = altWeeks.filter(w => w.sent).length;
  const mismatches = fullInRangeWeeks.filter(w => ((w.campaignsSent||0)>0) !== ((altMap[w.weekStart.toISOString()]||0)>0)).map(w => w.weekStart.toISOString().slice(0,10));
  // Prefer raw-campaign-derived count for gating and display to avoid aggregation inconsistencies
  sentWeeksAll = altSentWeeks;
  pctWeeksWithCampaignsSent = coverageDenom > 0 ? (sentWeeksAll / coverageDenom) * 100 : 0;
    console.debug('[CampaignGaps&Losses] coverage', { coverageDenom, sentWeeksAll, pctWeeksWithCampaignsSent: Number(pctWeeksWithCampaignsSent.toFixed?.(2) ?? pctWeeksWithCampaignsSent), totalWeeksInRange, totalCompleteWeeks });
    console.debug('[CampaignGaps&Losses] coverageWeeks', sample);
    // Build a tiny histogram: how many weeks had N campaigns (within full in-range weeks)
    const hist: Record<string, number> = { '0': 0 };
    for (const w of altWeeks) {
      const n = w.count || 0;
      const key = String(n);
      hist[key] = (hist[key] || 0) + 1;
    }
  console.debug('[CampaignGaps&Losses] altSentWeeks', { altSentWeeks, campaignsInRange, coverageDenom, hist, mismatches, weeksWithCounts: altWeeks.map(w => ({ start: w.key.slice(0,10), count: w.count })) });
  } catch {}

  // Low-Effectiveness Campaigns: count individual campaigns with revenue==0 in the selected range
  let lowEffectivenessCampaigns = 0;
  const zeroRevenueCampaignDetails: { date: string; title: string }[] = [];
  for (const c of campaigns) {
    if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
    if (c.sentDate >= rangeStart && c.sentDate <= rangeEnd && (c.revenue || 0) === 0) {
      lowEffectivenessCampaigns++;
      const dateIso = new Date(c.sentDate).toISOString();
      const title = (c.campaignName || c.subject || '').toString();
      zeroRevenueCampaignDetails.push({ date: dateIso, title });
    }
  }
  // Sort details by date desc for display
  zeroRevenueCampaignDetails.sort((a,b)=> (b.date.localeCompare(a.date)));

  const allWeeksSent = coverageDenom > 0 && fullInRangeWeeks.every(w => (w.campaignsSent || 0) > 0);
  // Weekly sufficiency gate: require ceil(66%) of full-in-range weeks to have at least one campaign sent
  const threshold = Math.ceil(0.66 * coverageDenom);
  const insufficientWeeklyData = sentWeeksAll < threshold;

  // Cap support: 90th percentile of non-zero campaign revenue within the selected range (complete weeks only)
  const nonZeroWeeklyInRange = completeWeeks.map(w => w.campaignRevenue).filter(v => (v || 0) > 0) as number[];
  const p90Cap = percentile(nonZeroWeeklyInRange, 0.9);

  // Build zero-send runs again but consider only runs length 1-4 for loss estimation (>=5 flagged via hasLongGaps)
  type Run = { startIdx: number; len: number };
  const runs: Run[] = [];
  let a = 0;
  while (a < completeWeeks.length) {
    if (isZeroSend(completeWeeks[a])) {
      let b = a; while (b < completeWeeks.length && isZeroSend(completeWeeks[b])) b++;
      const len = b - a;
      if (len >= 1 && len <= 4) runs.push({ startIdx: a, len });
      a = b;
    } else a++;
  }

  // Helper to collect reference weeks around a run
  function collectRefs(run: Run): number[] {
    const need = run.len === 1 ? 2 : 4; // per side
    const refs: number[] = [];
    // before
    let collectedBefore = 0;
    for (let k = run.startIdx - 1; k >= 0 && collectedBefore < need; k--) {
      const wk = completeWeeks[k];
      if ((wk.campaignsSent || 0) > 0 && (wk.campaignRevenue || 0) > 0) { refs.push(wk.campaignRevenue); collectedBefore++; }
    }
    // after
    let collectedAfter = 0;
    for (let k = run.startIdx + run.len; k < completeWeeks.length && collectedAfter < need; k++) {
      const wk = completeWeeks[k];
      if ((wk.campaignsSent || 0) > 0 && (wk.campaignRevenue || 0) > 0) { refs.push(wk.campaignRevenue); collectedAfter++; }
    }
    return refs;
  }

  function trimOrWinsorize(values: number[]): number[] {
    if (values.length >= 5) {
      const q1 = percentile(values, 0.25);
      const q3 = percentile(values, 0.75);
      const iqr = q3 - q1;
      const lo = q1 - 3 * iqr;
      const hi = q3 + 3 * iqr;
      return values.filter(v => v >= lo && v <= hi);
    } else {
      const p10 = percentile(values, 0.10);
      const p90 = percentile(values, 0.90);
      return values.map(v => Math.min(Math.max(v, p10), p90));
    }
  }

  let estimatedLostRevenue: number | undefined = 0;
  for (const run of runs) {
    let refs = collectRefs(run);
    if (refs.length < 3) continue; // insufficient references for this run
    refs = trimOrWinsorize(refs);
    if (!refs.length) continue;
    let expected = median(refs);
    // Cap expected by 90th percentile cap within selected range
    expected = Math.min(expected, p90Cap);
    // For multi-week gaps, same expected for each week
    estimatedLostRevenue += expected * run.len;
  }
  // If nothing computed, keep as undefined rather than 0
  if (estimatedLostRevenue === 0) estimatedLostRevenue = undefined;

  // Suspected CSV coverage gap hint: if we observe an exceptionally long consecutive zero-campaign stretch
  // (e.g., >= 10 weeks) inside the selected range, surface a guidance hint for users to re-export CSV.
  let suspectedCsvCoverageGap: { weeks: number; start: string; end: string } | null = null;
  if (longestGap >= 10 && longestGapStartIdx != null) {
    const startW = completeWeeks[longestGapStartIdx]?.weekStart;
    const endW = completeWeeks[longestGapStartIdx + longestGap - 1]?.weekStart;
    if (startW && endW) {
      const endLabel = new Date(endW); endLabel.setDate(endLabel.getDate() + 6);
      suspectedCsvCoverageGap = {
        weeks: longestGap,
        start: startW.toISOString().slice(0, 10),
        end: endLabel.toISOString().slice(0, 10),
      };
      try {
        // eslint-disable-next-line no-console
        console.warn('[CampaignGaps&Losses] Detected long zero-campaign stretch', suspectedCsvCoverageGap);
      } catch {}
    }
  }

  // Build lists for tooltips
  const zeroSendWeekStarts = completeWeeks.filter(w => isZeroSend(w)).map(w => w.weekStart.toISOString().slice(0,10));
  const longestGapWeekStarts = ((): string[] => {
    if (longestGapStartIdx == null || longestGap <= 0) return [];
    const out: string[] = [];
    for (let k = longestGapStartIdx; k < longestGapStartIdx + longestGap && k < completeWeeks.length; k++) {
      out.push(completeWeeks[k].weekStart.toISOString().slice(0,10));
    }
    return out;
  })();

  return {
    zeroCampaignSendWeeks: zeroSendWeeks,
    longestZeroSendGap: longestGap,
    pctWeeksWithCampaignsSent,
  weeksWithCampaignsSent: sentWeeksAll,
  weeksInRangeFull: coverageDenom,
    estimatedLostRevenue,
  lowEffectivenessCampaigns,
  zeroRevenueCampaigns: lowEffectivenessCampaigns,
  zeroRevenueCampaignDetails,
    avgCampaignsPerWeek,
  totalCampaignsInFullWeeks,
    allWeeksSent,
    insufficientWeeklyData,
    hasLongGaps,
    suspectedCsvCoverageGap,
  zeroSendWeekStarts,
  longestGapWeekStarts,
  };
}
