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
  // Row 2 — Impact & Effectiveness
  estimatedLostRevenue?: number; // undefined when insufficient data for computation
  lowEffectivenessCampaigns: number; // campaigns with revenue == 0
  avgCampaignsPerWeek: number;
  // Flags/notes
  allWeeksSent: boolean;
  insufficientWeeklyData: boolean; // true if < ceil(66%) of complete weeks have campaigns sent
  hasLongGaps: boolean; // true if there exists a zero-send run >= 5 weeks (weekly analysis insufficient for those)
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

  // Guard: if no weeks, return zeros
  if (!totalCompleteWeeks) {
    return {
      zeroCampaignSendWeeks: 0,
      longestZeroSendGap: 0,
      pctWeeksWithCampaignsSent: 0,
      estimatedLostRevenue: undefined,
      lowEffectivenessCampaigns: 0,
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
  let hasLongGaps = false;
  // Detect runs among complete weeks only
  let i = 0;
  while (i < completeWeeks.length) {
    if (isZeroSend(completeWeeks[i])) {
      let j = i;
      while (j < completeWeeks.length && isZeroSend(completeWeeks[j])) j++;
      const runLen = j - i;
      zeroSendWeeks += runLen;
      if (runLen > longestGap) longestGap = runLen;
      if (runLen > 4) hasLongGaps = true;
      i = j;
    } else {
      i++;
    }
  }

  const sentWeeks = completeWeeks.filter(w => (w.campaignsSent || 0) > 0).length;
  const pctWeeksWithCampaignsSent = totalCompleteWeeks > 0 ? (sentWeeks / totalCompleteWeeks) * 100 : 0;
  const avgCampaignsPerWeek = totalCompleteWeeks > 0 ? (completeWeeks.reduce((s,w)=> s + (w.campaignsSent || 0), 0) / totalCompleteWeeks) : 0;

  // Low-Effectiveness Campaigns: count individual campaigns with revenue==0 in the selected range
  let lowEffectivenessCampaigns = 0;
  for (const c of campaigns) {
    if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
    if (c.sentDate >= rangeStart && c.sentDate <= rangeEnd && (c.revenue || 0) === 0) lowEffectivenessCampaigns++;
  }

  const allWeeksSent = zeroSendWeeks === 0 && totalCompleteWeeks > 0;
  // Weekly sufficiency gate: require ceil(66%) of complete weeks to have at least one campaign sent
  const threshold = Math.ceil(0.66 * totalCompleteWeeks);
  const insufficientWeeklyData = sentWeeks < threshold;

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

  return {
    zeroCampaignSendWeeks: zeroSendWeeks,
    longestZeroSendGap: longestGap,
    pctWeeksWithCampaignsSent,
    estimatedLostRevenue,
    lowEffectivenessCampaigns,
    avgCampaignsPerWeek,
    allWeeksSent,
    insufficientWeeklyData,
    hasLongGaps,
  };
}
