"use client";
// New daily benchmark implementation per spec (timezone ignored)
import { useSyncExternalStore } from 'react';
import { DataManager } from './dataManager';

export type BenchmarkTier = 'Excellent' | 'Good' | 'OK' | 'Needs Attention' | 'Critical';

export interface BenchmarkResult {
  metric: string;
  value: number;                // actual selected range value (or % for rates)
  valueType: 'currency'|'count'|'rate'|'ratio';
  tier: BenchmarkTier | null;
  diff: number | null;          // percent diff (totals/avg) or pp diff (rates)
  diffType: 'percent' | 'pp' | null;
  baseline: number | null;      // totals: range baseline; rates: % baseline
  baselineDaily?: number | null;// totals: daily mean baseline
  lookbackDays: number;
  keptDays: number;
  hiddenReason?: string;
  negativeMetric?: boolean;
  debug?: any;
}

const NEGATIVE = new Set(['unsubscribeRate','spamRate','bounceRate']);
const TOTALS = new Set(['revenue','totalOrders','emailsSent']);
const VOLATILITY_RATIOS = new Set(['avgOrderValue','revenuePerEmail']); // AOV & RPE: ratio pipeline + volatility tiering (percent diff)

// Threshold policy (adaptive for sparse datasets)
const TARGET_LOOKBACK_DAYS = 140;          // Required historical activity days (strict)
const MIN_LOOKBACK_DAYS_FOR_ANY = 140;     // Enforce strict minimum per spec
const TARGET_KEPT_DAYS = 90;               // Ideal after trimming
function requiredKeptDays(lookbackActivity: number){
  // Need 90 if we have plenty, else 60% of available, but never less than 20
  if (lookbackActivity >= TARGET_KEPT_DAYS) return TARGET_KEPT_DAYS;
  return Math.max(20, Math.ceil(lookbackActivity * 0.6));
}

// Floors and kept denominator volume requirements (ratio metrics)
const FLOORS: Record<string,{base:number; denomKey:string; numKey:string; volumeMin:number}> = {
  avgOrderValue: { base:10, denomKey:'totalOrders', numKey:'revenue', volumeMin:500 },
  conversionRate: { base:25, denomKey:'uniqueClicks', numKey:'totalOrders', volumeMin:2000 },
  openRate: { base:50, denomKey:'emailsSent', numKey:'uniqueOpens', volumeMin:10000 },
  clickRate: { base:50, denomKey:'emailsSent', numKey:'uniqueClicks', volumeMin:10000 },
  revenuePerEmail: { base:50, denomKey:'emailsSent', numKey:'revenue', volumeMin:10000 },
  clickToOpenRate: { base:25, denomKey:'uniqueOpens', numKey:'uniqueClicks', volumeMin:3000 },
  unsubscribeRate: { base:50, denomKey:'emailsSent', numKey:'unsubscribesCount', volumeMin:10000 },
  spamRate: { base:50, denomKey:'emailsSent', numKey:'spamComplaintsCount', volumeMin:10000 },
  bounceRate: { base:50, denomKey:'emailsSent', numKey:'bouncesCount', volumeMin:10000 },
};

interface DayRec {
  date: Date;
  revenue: number; emailsSent: number; totalOrders: number;
  uniqueOpens: number; uniqueClicks: number;
  unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number;
}

function dayKey(d: Date){ return d.toISOString().slice(0,10); }
function buildLookback(selectedStart: Date): { start: Date; end: Date; days: Date[] } {
  const end = new Date(selectedStart); end.setDate(end.getDate()-1); end.setHours(0,0,0,0);
  const start = new Date(end); start.setDate(start.getDate()-364);
  const days: Date[] = []; const cur = new Date(start);
  while (cur <= end){ days.push(new Date(cur)); cur.setDate(cur.getDate()+1); }
  return { start, end, days };
}
function percentileFloor(values: number[], base: number){
  const v = values.filter(x=>x>0).sort((a,b)=>a-b);
  if (!v.length) return base;
  const idx = Math.floor(0.10 * v.length);
  return Math.max(base, v[Math.min(idx, v.length-1)]);
}
function median(arr: number[]){ if (!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function mad(values: number[]){ if (!values.length) return 0; const m=median(values); const dev=values.map(v=>Math.abs(v-m)); return median(dev); }
function tierTotals(pctDiff: number, Wp: number): BenchmarkTier {
  if (pctDiff >= 2*Wp*100) return 'Excellent';
  if (pctDiff >= 1*Wp*100) return 'Good';
  if (pctDiff > -1*Wp*100) return 'OK';
  if (pctDiff > -2*Wp*100) return 'Needs Attention';
  return 'Critical';
}
function tierRates(z: number): BenchmarkTier {
  if (z >= 2.0) return 'Excellent';
  if (z >= 0.5) return 'Good';
  if (z > -0.5) return 'OK';
  if (z > -2.0) return 'Needs Attention';
  return 'Critical';
}
function hidden(metric: string, lookbackDays: number, keptDays: number, reason: string, extra?: Partial<BenchmarkResult>): BenchmarkResult {
  return {
    metric,
    value: extra?.value ?? 0,
    valueType: 'rate',
    tier: null,
    diff: null,
    diffType: null,
    baseline: extra?.baseline ?? null,
    baselineDaily: null,
    lookbackDays,
    keptDays,
    hiddenReason: reason,
    negativeMetric: NEGATIVE.has(metric),
    ...extra
  };
}

function computeTotals(metric: string, rangeStart: Date, rangeEnd: Date, baselineDays: DayRec[], selectedDays: DayRec[]): BenchmarkResult {
  const lookbackDays = baselineDays.length;
  // Count actual activity days (non-zero value) as existence requirement
  const activityDays = baselineDays.filter(d => {
    if (metric==='revenue') return d.revenue>0;
    if (metric==='totalOrders') return d.totalOrders>0;
    if (metric==='emailsSent') return d.emailsSent>0;
    return false;
  }).length;
  if (activityDays < MIN_LOOKBACK_DAYS_FOR_ANY) return hidden(metric, lookbackDays, 0, `Need at least ${MIN_LOOKBACK_DAYS_FOR_ANY} look-back days`);
  const provisional = activityDays < TARGET_LOOKBACK_DAYS;
  const val = (r: DayRec) => {
    switch(metric){
      case 'revenue': return r.revenue;
      case 'totalOrders': return r.totalOrders;
      case 'emailsSent': return r.emailsSent;
      case 'avgOrderValue': return r.totalOrders>0? r.revenue/r.totalOrders:0;
      case 'revenuePerEmail': return r.emailsSent>0? r.revenue/r.emailsSent:0;
      default: return 0;
    }
  };
  const dailyVals = baselineDays.map(val).sort((a,b)=>a-b);
  let trim = Math.floor(dailyVals.length*0.10);
  // Skip trimming for very small samples (<50 days)
  if (dailyVals.length < 50) trim = 0;
  const kept = dailyVals.slice(trim, dailyVals.length-trim || dailyVals.length);
  const keptDays = kept.length;
  const reqKept = requiredKeptDays(activityDays);
  if (keptDays < reqKept) return hidden(metric, lookbackDays, keptDays, `Need at least ${reqKept} kept days (have ${keptDays})`);
  const dailyMean = kept.reduce((s,v)=>s+v,0)/keptDays;
  // Selected period
  const selDays: Date[] = []; const c=new Date(rangeStart); c.setHours(0,0,0,0); const e=new Date(rangeEnd); e.setHours(0,0,0,0);
  while (c <= e){ selDays.push(new Date(c)); c.setDate(c.getDate()+1); }
  const map = new Map([...baselineDays, ...selectedDays].map(d=>[dayKey(d.date), d] as const));
  let actualValue: number;
  if (metric==='avgOrderValue'){
    let rev=0, ord=0; for(const d of selDays){ const r=map.get(dayKey(d)); if (r){ rev+=r.revenue; ord+=r.totalOrders; } } actualValue= ord>0? rev/ord:0;
  } else if (metric==='revenuePerEmail'){
    let rev=0, em=0; for(const d of selDays){ const r=map.get(dayKey(d)); if (r){ rev+=r.revenue; em+=r.emailsSent; } } actualValue= em>0? rev/em:0;
  } else {
    actualValue = selDays.reduce((s,d)=>{ const r=map.get(dayKey(d)); return s + (r? val(r):0); },0);
  }
  const baselineRange = (metric==='avgOrderValue'||metric==='revenuePerEmail')? dailyMean : dailyMean * selDays.length;
  if (baselineRange === 0) {
    return hidden(metric, lookbackDays, keptDays, 'No activity in look-back period', { value: actualValue, baseline: baselineRange, baselineDaily: dailyMean });
  }
  const percentDiff = (actualValue - baselineRange)/baselineRange * 100;
  let tier: BenchmarkTier | null = null;
  if (percentDiff!==null){
    const relSeries = kept.filter(()=>dailyMean>0).map(v => (v - dailyMean)/dailyMean);
    const baseMAD = mad(relSeries);
    let W_base = 2*baseMAD; if (!isFinite(W_base) || W_base<=0) W_base=0.05;
    const W_period = Math.min(0.25, Math.max(0.05, W_base / Math.sqrt(selDays.length||1)));
    tier = tierTotals(percentDiff, W_period);
    if (provisional) tier = tier; // tiers still shown but flagged in debug
  }
  return {
    metric,
    value: actualValue,
    valueType: metric==='revenue'?'currency': TOTALS.has(metric)?'count':'ratio',
    tier,
  diff: percentDiff,
    diffType: 'percent',
    baseline: (metric==='avgOrderValue'||metric==='revenuePerEmail')? dailyMean : baselineRange,
    baselineDaily: (metric==='avgOrderValue'||metric==='revenuePerEmail')? null : dailyMean,
    lookbackDays,
    keptDays,
  negativeMetric: false,
  debug: { provisional, activityDays, reqKept, dailyMean, baselineRange, keptSample: kept.slice(0,5), W_note: 'See volatility calc only applied if percentDiff present', baselineDays: lookbackDays, selectedSpan: selDays.length }
  };
}

// Volatility ratio (AOV, RPE): ratio pipeline for baseline, percent diff, MAD tiers
function computeVolatilityRatio(metric: string, rangeStart: Date, rangeEnd: Date, baselineDays: DayRec[], selectedDays: DayRec[]): BenchmarkResult {
  const lookbackDays = baselineDays.length;
  const cfg = FLOORS[metric];
  if (!cfg) return hidden(metric, lookbackDays, 0, 'Unsupported metric');
  // Build raw daily numerator + denominator
  const raw = baselineDays.map(d=>({ d, num:(d as any)[cfg.numKey] as number, den:(d as any)[cfg.denomKey] as number }));
  const activityDays = raw.filter(r=>r.den>0).length;
  if (activityDays < MIN_LOOKBACK_DAYS_FOR_ANY) return hidden(metric, lookbackDays, 0, `Need at least ${MIN_LOOKBACK_DAYS_FOR_ANY} look-back days`);
  const provisional = activityDays < TARGET_LOOKBACK_DAYS;
  const denomVals = raw.filter(r=>r.den>0).map(r=>r.den);
  const floor = percentileFloor(denomVals, cfg.base);
  let filtered = raw.filter(r=>r.den >= floor && r.den>0).map(r=>({ ...r, ratio: r.num/r.den }));
  if (!filtered.length) return hidden(metric, lookbackDays, 0, 'Need at least 90 kept days and enough activity for this metric');
  // Sort by ratio, trim 10% cumulative denominator at both ends
  const sorted = [...filtered].sort((a,b)=>a.ratio - b.ratio);
  const totalDen = sorted.reduce((s,r)=>s+r.den,0);
  const trimVol = totalDen * 0.10;
  let acc=0, low=0; while(low<sorted.length && acc<trimVol){ acc+=sorted[low].den; low++; }
  acc=0; let high=sorted.length-1; while(high>=0 && acc<trimVol){ acc+=sorted[high].den; high--; }
  const kept = sorted.slice(low, high+1);
  const keptDays = kept.length; const keptDen = kept.reduce((s,r)=>s+r.den,0);
  const reqKept = requiredKeptDays(activityDays);
  if (keptDays < reqKept || keptDen < cfg.volumeMin) return hidden(metric, lookbackDays, keptDays, `Need at least ${reqKept} kept days and enough activity for this metric`);
  // Baseline ratio
  const baselineRatio = kept.reduce((s,r)=>s + r.num,0) / keptDen;
  if (baselineRatio === 0) return hidden(metric, lookbackDays, keptDays, 'No activity in look-back period');
  // Selected period aggregate
  const map = new Map([...baselineDays, ...selectedDays].map(d=>[dayKey(d.date), d] as const));
  const selDays: Date[] = []; const c=new Date(rangeStart); c.setHours(0,0,0,0); const e=new Date(rangeEnd); e.setHours(0,0,0,0);
  while(c<=e){ selDays.push(new Date(c)); c.setDate(c.getDate()+1); }
  let selNum=0, selDen=0; for(const d of selDays){ const r=map.get(dayKey(d)); if(!r) continue; selNum+=(r as any)[cfg.numKey]||0; selDen+=(r as any)[cfg.denomKey]||0; }
  const actualRatio = selDen>0? selNum/selDen : 0;
  if (selDen===0) return hidden(metric, lookbackDays, keptDays, 'no activity in this period', { value:0, baseline: baselineRatio });
  const percentDiff = baselineRatio>0? (actualRatio - baselineRatio)/baselineRatio * 100 : null;
  // Volatility tiers
  const keptRatios = kept.map(k=>k.ratio);
  const mean = keptRatios.reduce((s,v)=>s+v,0)/keptRatios.length;
  const relSeries = keptRatios.filter(()=>mean>0).map(v => (v - mean)/mean);
  const baseMAD = mad(relSeries);
  let W_base = 2*baseMAD; if(!isFinite(W_base)||W_base<=0) W_base=0.05;
  const W_period = Math.min(0.25, Math.max(0.05, W_base / Math.sqrt(selDays.length||1)));
  const tier = percentDiff==null? null : tierTotals(percentDiff, W_period);
  return {
    metric,
    value: actualRatio,
    valueType: metric==='avgOrderValue'? 'currency':'ratio',
    tier,
    diff: percentDiff,
    diffType: 'percent',
    baseline: baselineRatio,
    lookbackDays,
    keptDays,
    negativeMetric: false,
  debug: { provisional, activityDays, reqKept, floor, keptDen, W_period, baselineDays: lookbackDays, selectedSpan: selDays.length }
  };
}

function computeRateRatio(metric: string, rangeStart: Date, rangeEnd: Date, baselineDays: DayRec[], selectedDays: DayRec[]): BenchmarkResult {
  const lookbackDays = baselineDays.length;
  // Activity days requirement counts days with denominator >0
  const cfg0 = FLOORS[metric];
  const activityDays = baselineDays.filter(d => {
    if (!cfg0) return false; const den = (d as any)[cfg0.denomKey] as number; return den>0; }).length;
  if (activityDays < MIN_LOOKBACK_DAYS_FOR_ANY) return hidden(metric, lookbackDays, 0, `Need at least ${MIN_LOOKBACK_DAYS_FOR_ANY} look-back days`);
  const provisional = activityDays < TARGET_LOOKBACK_DAYS;
  const cfg = FLOORS[metric];
  if (!cfg) return hidden(metric, lookbackDays, 0, 'Unsupported metric');
  const raw = baselineDays.map(d=>({d, num:(d as any)[cfg.numKey] as number, den:(d as any)[cfg.denomKey] as number}));
  const denomVals = raw.filter(r=>r.den>0).map(r=>r.den);
  const floor = percentileFloor(denomVals, cfg.base);
  let filtered = raw.filter(r=>r.den >= floor).map(r=>({...r, ratio: r.den>0? r.num/r.den:0}));
  if (!filtered.length) return hidden(metric, lookbackDays, 0, 'Need at least 90 kept days and enough activity for this metric');
  const sorted = [...filtered].sort((a,b)=>a.ratio - b.ratio);
  const totalDen = sorted.reduce((s,r)=>s+r.den,0);
  const trimVol = totalDen * 0.10;
  let acc=0, low=0; while(low<sorted.length && acc<trimVol){ acc+=sorted[low].den; low++; }
  acc=0; let high=sorted.length-1; while(high>=0 && acc<trimVol){ acc+=sorted[high].den; high--; }
  const kept = sorted.slice(low, high+1);
  const keptDays = kept.length; const keptDen = kept.reduce((s,r)=>s+r.den,0);
  const reqKept = requiredKeptDays(activityDays);
  if (keptDays < reqKept || keptDen < cfg.volumeMin) return hidden(metric, lookbackDays, keptDays, `Need at least ${reqKept} kept days and enough activity for this metric`);
  const aggNum = kept.reduce((s,r)=>s+r.num,0); const baselineRatio = keptDen>0? aggNum/keptDen:0;
  // selected period
  const map = new Map([...baselineDays, ...selectedDays].map(d=>[dayKey(d.date), d] as const));
  const selDays: Date[] = []; const c=new Date(rangeStart); c.setHours(0,0,0,0); const e=new Date(rangeEnd); e.setHours(0,0,0,0);
  while(c<=e){ selDays.push(new Date(c)); c.setDate(c.getDate()+1); }
  let selNum=0, selDen=0; for(const d of selDays){ const r=map.get(dayKey(d)); if(!r) continue; selNum+=(r as any)[cfg.numKey]||0; selDen+=(r as any)[cfg.denomKey]||0; }
  if (selDen===0) return hidden(metric, lookbackDays, keptDays, 'no activity in this period', { baseline: baselineRatio*100, value:0 });
  const actualPct = (selNum/selDen)*100; const baselinePct = baselineRatio*100; const diffPP = actualPct - baselinePct;
  const p = baselineRatio; let se = Math.sqrt(p*(1-p)/selDen)*100; if(!isFinite(se)||se<0.1) se=0.1;
  let z = diffPP / se; if (NEGATIVE.has(metric)) z*=-1; const tier = tierRates(z);
  return { metric, value: actualPct, valueType:'rate', tier, diff: diffPP, diffType:'pp', baseline: baselinePct, lookbackDays, keptDays, negativeMetric: NEGATIVE.has(metric), debug:{ provisional, activityDays, reqKept, floor, keptDen, z, se, baselineDays: lookbackDays, selectedSpan: selDays.length } };
}

// Caches
const BMARK_VERSION = '3'; // bump to invalidate old cached results (include selected period days)
const lookbackCache = new Map<string, DayRec[]>();
const resultCache = new Map<string, BenchmarkResult>();

function compute(metric: string, start: Date, end: Date): BenchmarkResult {
  const dm = DataManager.getInstance();
  const { start: lbStart, end: lbEnd } = buildLookback(start); // lookback window ends day before selected start
  // Fetch union (lookback + selected period)
  const unionSig = `${dm.getCampaigns().length}:${dm.getFlowEmails().length}|${lbStart.toISOString()}|${end.toISOString()}`;
  let union = lookbackCache.get(unionSig);
  if (!union){
    union = dm.getDailyRecords(lbStart, end) as DayRec[];
    lookbackCache.set(unionSig, union);
  }
  const baselineDays = union.filter(d => d.date < start);
  const selectedDays = union.filter(d => d.date >= start && d.date <= end);
  if (TOTALS.has(metric)) return computeTotals(metric, start, end, baselineDays, selectedDays);
  if (VOLATILITY_RATIOS.has(metric)) return computeVolatilityRatio(metric, start, end, baselineDays, selectedDays);
  return computeRateRatio(metric, start, end, baselineDays, selectedDays);
}

// Stable empty result to avoid new object identity every render when inputs missing (prevents infinite re-render with useSyncExternalStore)
const EMPTY_BENCHMARK: BenchmarkResult = {
  metric: '', value:0, valueType:'rate', tier:null, diff:null, diffType:null, baseline:null, lookbackDays:0, keptDays:0, hiddenReason:'missing inputs', baselineDaily: null, negativeMetric: false
};

export function getBenchmark(metric: string | undefined, start?: Date, end?: Date): BenchmarkResult {
  if (!metric || !start || !end) return EMPTY_BENCHMARK;
  const dm = DataManager.getInstance();
  const key = `${BMARK_VERSION}|${metric}|${start.toISOString()}|${end.toISOString()}|${dm.getCampaigns().length}:${dm.getFlowEmails().length}`;
  const cached = resultCache.get(key);
  if (cached) {
    // Detect suspicious legacy result (tier null but not hidden for totals / volatility ratios) and recompute once
    if (cached.tier===null && !cached.hiddenReason && (TOTALS.has(metric) || VOLATILITY_RATIOS.has(metric))) {
      const fresh = compute(metric, start, end);
      resultCache.set(key, fresh);
      return fresh;
    }
    return cached;
  }
  const res = compute(metric, start, end); resultCache.set(key,res); return res;
}

export function useBenchmark(metric: string | undefined, start?: Date, end?: Date) {
  return useSyncExternalStore(
    (cb)=>{
      if (typeof window==='undefined') return ()=>{};
      const h=()=>{ resultCache.clear(); lookbackCache.clear(); cb(); };
      window.addEventListener('em:dataset-hydrated', h);
      window.addEventListener('em:dataset-persisted', h);
      return ()=>{ window.removeEventListener('em:dataset-hydrated', h); window.removeEventListener('em:dataset-persisted', h); };
    },
    ()=> getBenchmark(metric, start, end),
  ()=> ({ metric: metric||'', value:0, valueType:'rate' as const, tier:null, diff:null, diffType:null, baseline:null, lookbackDays:0, keptDays:0, hiddenReason:'SSR' })
  );
}

// Developer helper
if (typeof window !== 'undefined') {
  (window as any).__dumpBenchmark = (metric: string, start: Date, end: Date) => {
    const res = getBenchmark(metric,start,end);
    console.debug('[BenchmarkDump]', metric, start.toISOString(), end.toISOString(), res);
    return res;
  };
}
