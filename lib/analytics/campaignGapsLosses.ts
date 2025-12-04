import type { ProcessedCampaign, ProcessedFlowEmail } from '../data/dataTypes';
import { buildWeeklyAggregatesInRange } from './reliability';

export interface GapsLossesInputs {
  campaigns: ProcessedCampaign[];
  flows: ProcessedFlowEmail[];
  rangeStart: Date;
  rangeEnd: Date;
}

export interface GapsLossesResult {
  // Row 1 – Consistency & Gaps
  zeroCampaignSendWeeks: number;
  longestZeroSendGap: number;
  pctWeeksWithCampaignsSent: number; // 0-100
  // Explicit counts for tooltip "X of Y weeks"
  weeksWithCampaignsSent: number; // numerator (based on raw-campaign UTC buckets)
  weeksInRangeFull: number;       // denominator (full weeks fully within range)
  // Lists for tooltips
  zeroSendWeekStarts?: string[];      // ISO YYYY-MM-DD of week starts (complete weeks only)
  longestGapWeekStarts?: string[];    // ISO YYYY-MM-DD for the longest zero-send run (complete weeks only)
  // Row 2 – Impact & Effectiveness
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
  let zeroWeekOverride: string[] | null = null;
  let longestGapOverride: string[] | null = null;
  let suspectedCsvCoverageGap: { weeks: number; start: string; end: string } | null = null;



  // REVISED LOGIC: Include weeks in gap analysis if their Monday start falls within the selected range,
  // regardless of whether the full week is within range. The isCompleteWeek flag is only used for
  // revenue estimation quality, not for gap detection.
  // 
  // This fixes the issue where a campaign sent on 7/21 (Monday) was being excluded because the week
  // 7/21-27 extended beyond the selected range end date.
  const fullInRangeWeeks = weeks.filter(w => {
    const weekStartMs = w.weekStart.getTime();
    const weekStart = w.weekStart;
    
    // A week is included if its Monday start date falls within the selected range
    const isInRange = weekStart >= rangeStart && weekStart <= rangeEnd;
    
    return isInRange;
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
  // REVISED: Detect runs among ALL weeks whose Monday falls in range (not just complete weeks)
  // This ensures we count gaps correctly even for weeks that extend beyond the range end
  let i = 0;
  while (i < fullInRangeWeeks.length) {
    if (isZeroSend(fullInRangeWeeks[i])) {
      let j = i;
      while (j < fullInRangeWeeks.length && isZeroSend(fullInRangeWeeks[j])) j++;
      const runLen = j - i;
      zeroSendWeeks += runLen;
      if (runLen > longestGap) { longestGap = runLen; longestGapStartIdx = i; }
      // Flag presence of long gaps (>=5 weeks). We do not gate UI on this anymore, but we surface the flag.
      if (runLen >= 5) hasLongGaps = true;
      // We no longer gate on long gaps; keep computing longestGap for display only.
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
  let allWeeksSent = coverageDenom > 0 && sentWeeksAll >= coverageDenom;
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
    let julyWeeks = 0;
    
    // Log campaigns for debugging
    const campaignDates: string[] = [];
    for (const c of campaigns) {
      if (!(c.sentDate instanceof Date)) continue;
      campaignDates.push(c.sentDate.toISOString().slice(0,10));
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

    // Build a tiny histogram: how many weeks had N campaigns (within full in-range weeks)
    const hist: Record<string, number> = { '0': 0 };
    for (const w of altWeeks) {
      const n = w.count || 0;
      const key = String(n);
      hist[key] = (hist[key] || 0) + 1;
    }
    const zeroWeeksFromAlt = altWeeks.filter(w => !w.sent);
    
    // Always set allWeeksSent=false if the alt calculation finds any zero weeks
    if (zeroWeeksFromAlt.length > 0) {
      allWeeksSent = false;
    }
    
    // CRITICAL FIX: ALWAYS use the alternative calculation because it directly buckets
    // campaigns by UTC Monday, which is more accurate than the weekly aggregation.
    // The weekly aggregation can miss campaigns due to timezone/date issues.

    
    // ALWAYS use the alternative calculation - it's the source of truth
    // It directly buckets campaigns by UTC Monday which is more accurate than aggregation
    zeroSendWeeks = zeroWeeksFromAlt.length;
    if (zeroWeeksFromAlt.length > 0) {
      zeroWeekOverride = zeroWeeksFromAlt.map(w => w.key.slice(0, 10));
    } else {
      zeroWeekOverride = null;
    }

    // Calculate longest gap from alt calculation
    let bestLen = 0;
    let bestStart = -1;
    let runLen = 0;
    let runStart = -1;
    altWeeks.forEach((w, idx) => {
      if (!w.sent) {
        if (runLen === 0) runStart = idx;
        runLen += 1;
        if (runLen > bestLen) {
          bestLen = runLen;
          bestStart = runStart;
        }
      } else {
        runLen = 0;
        runStart = -1;
      }
    });

    if (bestLen > 0 && bestStart >= 0) {
      longestGap = bestLen;  // Use alt calculation result directly
      if (bestLen >= 5) hasLongGaps = true;
      longestGapOverride = altWeeks.slice(bestStart, bestStart + bestLen).map(w => w.key.slice(0, 10));

      if (bestLen >= 10) {
        const startIso = altWeeks[bestStart].key.slice(0, 10);
        const endDate = new Date(altWeeks[bestStart + bestLen - 1].key);
        const endInclusive = new Date(endDate); endInclusive.setUTCDate(endInclusive.getUTCDate() + 6);
        const fallbackGap: { weeks: number; start: string; end: string } = {
          weeks: bestLen,
          start: startIso,
          end: endInclusive.toISOString().slice(0, 10),
        };
        let currentWeeks = 0;
        if (suspectedCsvCoverageGap) {
          currentWeeks = (suspectedCsvCoverageGap as { weeks: number; start: string; end: string }).weeks;
        }
        if (!suspectedCsvCoverageGap || fallbackGap.weeks > currentWeeks) {
          suspectedCsvCoverageGap = fallbackGap;
        }
      }
    } else {
      longestGap = 0;
      longestGapOverride = null;
    }
  } catch {}

  // Low-Effectiveness Campaigns: count individual campaigns with revenue==0 in COMPLETE weeks only
  let lowEffectivenessCampaigns = 0;
  const zeroRevenueCampaignDetails: { date: string; title: string }[] = [];
  
  // Helper to check if a date falls in a complete week
  const isInCompleteWeek = (date: Date): boolean => {
    const ws = new Date(date);
    const dayUTC = ws.getUTCDay();
    const diffUTC = (dayUTC + 6) % 7;
    ws.setUTCDate(ws.getUTCDate() - diffUTC);
    ws.setUTCHours(0,0,0,0);
    const weekIso = ws.toISOString().slice(0,10);
    return fullInRangeWeeks.some(w => w.weekStart.toISOString().slice(0,10) === weekIso);
  };
  
  for (const c of campaigns) {
    if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
    if (c.sentDate >= rangeStart && c.sentDate <= rangeEnd && (c.revenue || 0) === 0 && isInCompleteWeek(c.sentDate)) {
      lowEffectivenessCampaigns++;
      const dateIso = new Date(c.sentDate).toISOString();
      const title = (c.campaignName || c.subject || '').toString();
      zeroRevenueCampaignDetails.push({ date: dateIso, title });
    }
  }
  // Sort details by date desc for display
  zeroRevenueCampaignDetails.sort((a,b)=> (b.date.localeCompare(a.date)));

  // Fix: allWeeksSent should be false if there are any zero-send weeks
  allWeeksSent = (coverageDenom > 0 && sentWeeksAll >= coverageDenom) && zeroSendWeeks === 0;
  // Weekly sufficiency gate: require ceil(66%) of full-in-range weeks to have at least one campaign sent
  const threshold = Math.ceil(0.66 * coverageDenom);
  const insufficientWeeklyData = sentWeeksAll < threshold;

  // Cap support: 75th percentile of non-zero campaign revenue within the selected range (complete weeks only)
  const nonZeroWeeklyInRange = completeWeeks.map(w => w.campaignRevenue).filter(v => (v || 0) > 0) as number[];
  const p75Cap = percentile(nonZeroWeeklyInRange, 0.75);

  // Build runs for loss estimation over weeks with zero campaign revenue (includes zero-send and zero-revenue weeks).
  // We'll treat 1–4 week runs with the original local-median approach, and >=5 week runs with a conservative
  // weekly estimator (±8-week window, p40, p75 cap, min 4 refs, decay beyond week 12).
  type Run = { startIdx: number; len: number };
  const runsForEstimate: Run[] = [];
  let a = 0;
  while (a < completeWeeks.length) {
    const isZeroRev = (completeWeeks[a].campaignRevenue || 0) === 0;
    if (isZeroRev) {
      let b = a; while (b < completeWeeks.length && ((completeWeeks[b].campaignRevenue || 0) === 0)) b++;
      const len = b - a;
      runsForEstimate.push({ startIdx: a, len });
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
  // Global fallback median when local refs are insufficient
  const globalMedian = median(nonZeroWeeklyInRange);
  const ONE_WEEK = 7 * ONE_DAY;
  for (const run of runsForEstimate) {
    if (run.len >= 1 && run.len <= 4) {
      // Short gaps: original approach with trimming/winsorization and median
      let refs = collectRefs(run);
      if (refs.length < 3) {
        if (globalMedian > 0) {
          const expected = Math.min(globalMedian, p75Cap);
          estimatedLostRevenue += expected * run.len;
        }
        continue; // insufficient localized references
      }
      refs = trimOrWinsorize(refs);
      if (!refs.length) {
        if (globalMedian > 0) {
          const expected = Math.min(globalMedian, p75Cap);
          estimatedLostRevenue += expected * run.len;
        }
        continue;
      }
      let expected = median(refs);
      // Cap expected by 75th percentile cap within selected range
      expected = Math.min(expected, p75Cap);
      estimatedLostRevenue += expected * run.len;
    } else if (run.len >= 5) {
      // Long gaps: per-week conservative estimate using ±8-week local window, p40, p75 cap,
      // require at least 4 refs; otherwise fall back to global median of non-zero weeks.
      for (let offset = 0; offset < run.len; offset++) {
        const weekIdx = run.startIdx + offset;
        // Collect references from window [weekIdx-8, weekIdx+8], excluding zero weeks (by definition), using non-zero campaignRevenue
        const windowRefs: number[] = [];
        const lo = Math.max(0, weekIdx - 8);
        const hi = Math.min(completeWeeks.length - 1, weekIdx + 8);
        for (let k = lo; k <= hi; k++) {
          if (k >= run.startIdx && k < run.startIdx + run.len) continue; // skip inside the gap
          const wk = completeWeeks[k];
          const v = wk.campaignRevenue || 0;
          if (v > 0) windowRefs.push(v);
        }
        let expected: number | null = null;
        if (windowRefs.length >= 4) {
          // Use p40 of local references
          expected = percentile(windowRefs, 0.40);
        } else if (globalMedian > 0) {
          // Fallback to global median of non-zero weeks in range
          expected = globalMedian;
        }
        if (expected == null || expected <= 0) continue;
        // Cap at p75 cap for safety
        expected = Math.min(expected, p75Cap);
        // Apply conservative decay beyond week 12 within a continuous gap (week index within run is 1-based)
        const posInRun = offset + 1;
        let decay = 1;
        if (posInRun > 12) decay = Math.pow(0.95, posInRun - 12);
        estimatedLostRevenue += expected * decay;
      }
    }
  }
  // If nothing computed, keep as undefined rather than 0
  if (estimatedLostRevenue === 0) estimatedLostRevenue = undefined;

  // Suspected CSV coverage gap hint: if we observe an exceptionally long consecutive zero-campaign stretch
  // (e.g., >= 10 weeks) inside the selected range, surface a guidance hint for users to re-export CSV.
  // REVISED: Use fullInRangeWeeks
  if (longestGap >= 10 && longestGapStartIdx != null) {
    const startW = fullInRangeWeeks[longestGapStartIdx]?.weekStart;
    const endW = fullInRangeWeeks[longestGapStartIdx + longestGap - 1]?.weekStart;
    if (startW && endW) {
      const endLabel = new Date(endW); endLabel.setDate(endLabel.getDate() + 6);
      const candidate = {
        weeks: longestGap,
        start: startW.toISOString().slice(0, 10),
        end: endLabel.toISOString().slice(0, 10),
      };
      if (!suspectedCsvCoverageGap || candidate.weeks > suspectedCsvCoverageGap.weeks) {
        suspectedCsvCoverageGap = candidate;
        try {
          // eslint-disable-next-line no-console
          console.warn('[CampaignGaps&Losses] Detected long zero-campaign stretch', suspectedCsvCoverageGap);
        } catch {}
      }
    }
  }

  // Build lists for tooltips - use formatted week range labels instead of ISO dates
  // REVISED: Use fullInRangeWeeks (all weeks whose Monday is in range) not just completeWeeks
  let zeroSendWeekStarts = fullInRangeWeeks.filter(w => isZeroSend(w)).map(w => w.label);
  if (zeroWeekOverride) {
    // Convert ISO dates to formatted labels
    zeroSendWeekStarts = zeroWeekOverride.map(iso => {
      const weekMonday = new Date(iso);
      const matchingWeek = weeks.find(w => w.weekStart.toISOString().slice(0,10) === iso);
      return matchingWeek ? matchingWeek.label : iso;
    });
  }
  let longestGapWeekStarts = ((): string[] => {
    if (longestGapStartIdx == null || longestGap <= 0) return [];
    const out: string[] = [];
    // REVISED: Use fullInRangeWeeks for gap display
    for (let k = longestGapStartIdx; k < longestGapStartIdx + longestGap && k < fullInRangeWeeks.length; k++) {
      out.push(fullInRangeWeeks[k].label);
    }
    return out;
  })();
  if (longestGapOverride) {
    // Convert ISO dates to formatted labels
    longestGapWeekStarts = longestGapOverride.map(iso => {
      const matchingWeek = weeks.find(w => w.weekStart.toISOString().slice(0,10) === iso);
      return matchingWeek ? matchingWeek.label : iso;
    });
  }

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
