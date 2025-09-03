"use client";
import { DataManager } from './dataManager';
import { useSyncExternalStore } from 'react';

/**
 * Benchmark tier labels in ascending performance order (0 = poorest, 4 = strongest)
 */
export type BenchmarkTier = 'Needs Review' | 'Below Average' | 'Typical' | 'Above Average' | 'Exceptional';

export interface BenchmarkComputation {
  tier: BenchmarkTier | null;          // null if insufficient history
  baseline: number | null;             // trimmed mean baseline
  current: number | null;              // current period aggregate value
  percentDelta: number | null;         // (current - baseline)/baseline * 100
  sampleWeeks: number;                 // weeks actually used for baseline
  totalWeeksConsidered: number;        // raw weeks in lookback window before exclusions
  insufficient: boolean;               // true if < 20 usable weeks
  note?: string;                       // optional UI note (e.g. "Limited history")
  thresholds?: {                       // numeric cut points to display in tooltip
    typicalLow: number; typicalHigh: number; // Typical inclusive range
    aboveAvg: number;                  // Above Average lower bound
    exceptional: number;               // Exceptional lower bound
  };
  provisional?: boolean;               // shown when we have >= minProvisional but < full threshold
  hiddenReason?: string;               // explanation if tier null
}

// Direction metadata: metrics where lower is better
const LOWER_IS_BETTER = new Set(['unsubscribeRate','spamRate','bounceRate']);

// Extract numeric from weekly metric series excluding the most recent partial week (if ongoing)
function getHistoricalWeeks(metricKey: string) {
  const dm = DataManager.getInstance();
  const weeks = dm.getWeeklyMetricSeries(metricKey).sort((a,b)=>a.weekStart.getTime()-b.weekStart.getTime());
  if (!weeks.length) return [] as { weekStart: Date; value: number }[];
  // Consider a week partial if it's the latest week and it's not "complete" yet (heuristic: lastEmailDate within this week but < weekStart+6d end-of-day)
  const lastEmailDate = dm.getLastEmailDate();
  const last = weeks[weeks.length-1];
  const weekEnd = new Date(last.weekStart); weekEnd.setDate(weekEnd.getDate()+6); weekEnd.setHours(23,59,59,999);
  if (lastEmailDate < weekEnd) {
    // treat as partial and drop
    weeks.pop();
  }
  return weeks;
}

/**
 * Compute adaptive benchmark tier for a metric relative to a target (current viewing range ending week).
 * Window: take up to 52 weeks immediately preceding the current viewed window start (or last complete week),
 * but at least 10 weeks; require >=20 weeks to show a tier.
 * Trim: remove lowest 10% and highest 10% of values (floor counts) before baseline calculation.
 */
export function computeBenchmark(metricKey: string | undefined, currentRangeStart?: Date, currentRangeEnd?: Date): BenchmarkComputation {
  if (!metricKey) return { tier: null, baseline: null, current: null, percentDelta: null, sampleWeeks: 0, totalWeeksConsidered: 0, insufficient: true, hiddenReason: 'No metric key' };
  const weeks = getHistoricalWeeks(metricKey);
  if (typeof window !== 'undefined' && (window as any).__BENCH_DEBUG__ !== false) {
    console.debug('[Bench] weeks total', metricKey, weeks.length, { first: weeks[0]?.weekStart, last: weeks[weeks.length-1]?.weekStart, currentRangeStart, currentRangeEnd });
  }
  if (!weeks.length) return { tier: null, baseline: null, current: null, percentDelta: null, sampleWeeks: 0, totalWeeksConsidered: 0, insufficient: true, hiddenReason: 'No weekly data' };

  // Define anchor: if currentRangeStart supplied, we only look at weeks strictly before it.
  let anchor = currentRangeStart ? new Date(currentRangeStart) : new Date();
  anchor.setHours(0,0,0,0);

  // Filter weeks strictly before anchor week start.
  let usable = weeks.filter(w => w.weekStart < anchor);
  if (typeof window !== 'undefined' && (window as any).__BENCH_DEBUG__ !== false) {
    console.debug('[Bench] usable before fallback', metricKey, usable.length, 'anchor', anchor);
  }
  // Fallback: if none, try using range end (common when viewing 'all' and anchor == earliest week)
  if (!usable.length && currentRangeEnd) {
    const altAnchor = new Date(currentRangeEnd); altAnchor.setHours(0,0,0,0); altAnchor.setDate(altAnchor.getDate()+7); // include all weeks up to end
    usable = weeks.filter(w => w.weekStart < altAnchor);
    if (typeof window !== 'undefined' && (window as any).__BENCH_DEBUG__ !== false) {
      console.debug('[Bench] fallback usable', metricKey, usable.length, 'altAnchor', altAnchor);
    }
  }
  const totalWeeksConsidered = usable.length;
  if (!usable.length) return { tier: null, baseline: null, current: null, percentDelta: null, sampleWeeks: 0, totalWeeksConsidered, insufficient: true, hiddenReason: 'No historical weeks prior to range' };

  // Take last up to 52 weeks, at least 8 provisional, 12 recommended, 20 full
  const windowWeeks = usable.slice(-52);
  const minProvisional = 8; // show a provisional badge
  const minShowTier = 12;   // compute tier but mark provisional if < full threshold
  const minFull = 20;       // mark non-provisional once >=20
  if (windowWeeks.length < minProvisional) return { tier: null, baseline: null, current: null, percentDelta: null, sampleWeeks: windowWeeks.length, totalWeeksConsidered, insufficient: true, note: 'Need more history', hiddenReason: 'Fewer than 8 weeks' };

  // Copy values for trimming
  const values = windowWeeks.map(w => w.value).filter(v => Number.isFinite(v));
  const sorted = [...values].sort((a,b)=>a-b);
  const trimCount = Math.floor(sorted.length * 0.10); // 10% tails
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  const baseline = trimmed.length ? trimmed.reduce((s,v)=>s+v,0)/trimmed.length : (values.reduce((s,v)=>s+v,0)/values.length);

  // Current value is aggregate over current viewing period (if provided) else last complete week
  let current: number | null = null;
  if (currentRangeStart && currentRangeEnd) {
    // Approximate: aggregate weekly values whose weekStart within [currentRangeStart, currentRangeEnd]
    current = weeks.filter(w => w.weekStart >= currentRangeStart && w.weekStart <= currentRangeEnd).reduce((s,w)=>s+w.value,0);
    if (!Number.isFinite(current)) current = null;
  } else {
    const lastComplete = usable[usable.length-1];
    current = lastComplete?.value ?? null;
  }

  if (baseline == null || current == null) {
    return { tier: null, baseline: baseline ?? null, current: current ?? null, percentDelta: null, sampleWeeks: windowWeeks.length, totalWeeksConsidered, insufficient: windowWeeks.length < minFull, provisional: windowWeeks.length >= minShowTier, hiddenReason: 'Missing current or baseline' };
  }

  const lowerIsBetter = LOWER_IS_BETTER.has(metricKey);
  const percentDelta = baseline === 0 ? null : ((current - baseline) / baseline) * 100;

  // Determine tier thresholds. Approach: Typical = baseline ±15%; Above Average = +15% to +35%; Exceptional > +35% (or conversely for lower-is-better with inverted logic).
  const typicalBand = 0.15; const aboveBand = 0.35;
  let tier: BenchmarkTier;
  if (lowerIsBetter) {
    // Invert logic: improvements are decreases.
    const delta = percentDelta ?? 0;
    if (delta <= -aboveBand*100) tier = 'Exceptional';
    else if (delta <= -typicalBand*100) tier = 'Above Average';
    else if (Math.abs(delta) <= typicalBand*100) tier = 'Typical';
    else if (delta < 0) tier = 'Typical'; // fallback
    else if (delta <= aboveBand*100) tier = 'Below Average';
    else tier = 'Needs Review';
  } else {
    const delta = percentDelta ?? 0;
    if (delta >= aboveBand*100) tier = 'Exceptional';
    else if (delta >= typicalBand*100) tier = 'Above Average';
    else if (Math.abs(delta) <= typicalBand*100) tier = 'Typical';
    else if (delta > -aboveBand*100) tier = 'Below Average';
    else tier = 'Needs Review';
  }

  const insufficient = windowWeeks.length < minFull;
  const thresholds = {
    typicalLow: baseline * (1 - typicalBand),
    typicalHigh: baseline * (1 + typicalBand),
    aboveAvg: baseline * (1 + typicalBand),
    exceptional: baseline * (1 + aboveBand),
  };
  const provisional = !insufficient && windowWeeks.length < minFull;
  return { tier, baseline, current, percentDelta, sampleWeeks: windowWeeks.length, totalWeeksConsidered, insufficient, provisional, thresholds };
}

/** Simple cache per metric + anchor signature (in-memory only) */
const _cache = new Map<string, BenchmarkComputation>();

// Invalidate cache on dataset hydration/persist events (permanent solution to stale tiers)
if (typeof window !== 'undefined') {
  const reset = () => _cache.clear();
  window.addEventListener('em:dataset-hydrated', reset);
  window.addEventListener('em:dataset-persisted', reset);
}

export function getBenchmark(metricKey: string | undefined, anchorStart?: Date, anchorEnd?: Date) {
  const key = `${metricKey}|${anchorStart?.toISOString()||'none'}|${anchorEnd?.toISOString()||'none'}`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const res = computeBenchmark(metricKey, anchorStart, anchorEnd);
  _cache.set(key, res);
  return res;
}
// Reactive hook: re-compute on dataset events & metric/anchor changes using useSyncExternalStore
export function useBenchmark(metricKey: string | undefined, anchorStart?: Date, anchorEnd?: Date) {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined') return () => {};
      const handler = () => cb();
      window.addEventListener('em:dataset-hydrated', handler);
      window.addEventListener('em:dataset-persisted', handler);
      return () => {
        window.removeEventListener('em:dataset-hydrated', handler);
        window.removeEventListener('em:dataset-persisted', handler);
      };
    },
    () => getBenchmark(metricKey, anchorStart, anchorEnd),
  () => ({ tier: null, baseline: null, current: null, percentDelta: null, sampleWeeks: 0, totalWeeksConsidered: 0, insufficient: true, hiddenReason: 'SSR fallback' })
  );
}
