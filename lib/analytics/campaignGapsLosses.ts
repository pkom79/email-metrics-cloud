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
  estimatedLostRevenue?: number; // undefined when insufficient history
  lowEffectivenessCampaigns: number; // campaigns with revenue == 0
  avgCampaignsPerWeek: number;
  // Flags/notes
  allWeeksSent: boolean;
  insufficientHistoryForEstimator: boolean; // true if <26 complete weeks or <8 non-zero in last 26
  deferredWeeksOver4: number; // count of zero-send weeks inside gaps > 4
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
      insufficientHistoryForEstimator: true,
      deferredWeeksOver4: 0,
    };
  }

  // Classification
  const isZeroSend = (w: typeof weeks[number]) => (w.campaignsSent || 0) === 0 && (w.campaignRevenue || 0) === 0;
  const isZeroRevenue = (w: typeof weeks[number]) => (w.campaignsSent || 0) > 0 && (w.campaignRevenue || 0) === 0;

  let zeroSendWeeks = 0;
  let longestGap = 0;
  let deferredWeeksOver4 = 0;
  // Detect runs among complete weeks only
  let i = 0;
  while (i < completeWeeks.length) {
    if (isZeroSend(completeWeeks[i])) {
      let j = i;
      while (j < completeWeeks.length && isZeroSend(completeWeeks[j])) j++;
      const runLen = j - i;
      zeroSendWeeks += runLen;
      if (runLen > longestGap) longestGap = runLen;
      if (runLen > 4) deferredWeeksOver4 += runLen;
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

  // Estimator gating: need at least 26 complete weeks and at least 8 non-zero weeks among last 26 complete weeks
  let estimatedLostRevenue: number | undefined = undefined;
  let insufficientHistoryForEstimator = true;
  if (totalCompleteWeeks >= 26) {
    // Consider last 26 complete weeks ending at rangeEnd
    const last26 = completeWeeks.slice(-26);
    const nonZeroWeekly = last26.map(w => w.campaignRevenue).filter(v => (v || 0) > 0) as number[];
    if (nonZeroWeekly.length >= 8) {
      insufficientHistoryForEstimator = false;
      // Cap support: 90th percentile of non-zero revenues in last 26
      const p90Cap = percentile(nonZeroWeekly, 0.9);

      // Build zero-send runs again but limited to runs length 1-4 (defer >4)
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

      let totalLost = 0;
      for (const run of runs) {
        let refs = collectRefs(run);
        if (refs.length < 3) continue; // insufficient references for this run
        refs = trimOrWinsorize(refs);
        if (!refs.length) continue;
        let expected = median(refs);
        // Cap expected by 90th percentile cap
        expected = Math.min(expected, p90Cap);
        // For multi-week gaps, same expected for each week
        totalLost += expected * run.len;
      }
      estimatedLostRevenue = totalLost;
    }
  }

  return {
    zeroCampaignSendWeeks: zeroSendWeeks,
    longestZeroSendGap: longestGap,
    pctWeeksWithCampaignsSent,
    estimatedLostRevenue,
    lowEffectivenessCampaigns,
    avgCampaignsPerWeek,
    allWeeksSent,
    insufficientHistoryForEstimator,
    deferredWeeksOver4,
  };
}
