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
const TOTAL_STYLE_RATIO = new Set(['avgOrderValue','revenuePerEmail']);

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

function computeTotals(metric: string, rangeStart: Date, rangeEnd: Date, days: DayRec[]): BenchmarkResult {
  const lookbackDays = days.length;
  if (lookbackDays < 140) return hidden(metric, lookbackDays, 0, 'Need at least 140 look-back days');
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
  const dailyVals = days.map(val).sort((a,b)=>a-b);
  const trim = Math.floor(dailyVals.length*0.10);
  const kept = dailyVals.slice(trim, dailyVals.length-trim);
  const keptDays = kept.length;
  if (keptDays < 90) return hidden(metric, lookbackDays, keptDays, 'Need at least 90 kept days and enough activity for this metric');
  const dailyMean = kept.reduce((s,v)=>s+v,0)/keptDays;
  // Selected period
  const selDays: Date[] = []; const c=new Date(rangeStart); c.setHours(0,0,0,0); const e=new Date(rangeEnd); e.setHours(0,0,0,0);
  while (c <= e){ selDays.push(new Date(c)); c.setDate(c.getDate()+1); }
  const map = new Map(days.map(d=>[dayKey(d.date), d] as const));
  let actualValue: number;
  if (metric==='avgOrderValue'){
    let rev=0, ord=0; for(const d of selDays){ const r=map.get(dayKey(d)); if (r){ rev+=r.revenue; ord+=r.totalOrders; } } actualValue= ord>0? rev/ord:0;
  } else if (metric==='revenuePerEmail'){
    let rev=0, em=0; for(const d of selDays){ const r=map.get(dayKey(d)); if (r){ rev+=r.revenue; em+=r.emailsSent; } } actualValue= em>0? rev/em:0;
  } else {
    actualValue = selDays.reduce((s,d)=>{ const r=map.get(dayKey(d)); return s + (r? val(r):0); },0);
  }
  const baselineRange = (metric==='avgOrderValue'||metric==='revenuePerEmail')? dailyMean : dailyMean * selDays.length;
  const percentDiff = baselineRange>0? (actualValue - baselineRange)/baselineRange * 100 : null;
  let tier: BenchmarkTier | null = null;
  if (percentDiff!==null){
    const relSeries = kept.filter(()=>dailyMean>0).map(v => (v - dailyMean)/dailyMean);
    const baseMAD = mad(relSeries);
    let W_base = 2*baseMAD; if (!isFinite(W_base) || W_base<=0) W_base=0.05;
    const W_period = Math.min(0.25, Math.max(0.05, W_base / Math.sqrt(selDays.length||1)));
    tier = tierTotals(percentDiff, W_period);
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
    negativeMetric: false
  };
}

function computeRatio(metric: string, rangeStart: Date, rangeEnd: Date, days: DayRec[]): BenchmarkResult {
  const lookbackDays = days.length;
  if (lookbackDays < 140) return hidden(metric, lookbackDays, 0, 'Need at least 140 look-back days');
  const cfg = FLOORS[metric];
  if (!cfg) return hidden(metric, lookbackDays, 0, 'Unsupported metric');
  const raw = days.map(d=>({d, num:(d as any)[cfg.numKey] as number, den:(d as any)[cfg.denomKey] as number}));
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
  if (keptDays < 90 || keptDen < cfg.volumeMin) return hidden(metric, lookbackDays, keptDays, 'Need at least 90 kept days and enough activity for this metric');
  const aggNum = kept.reduce((s,r)=>s+r.num,0); const baselineRatio = keptDen>0? aggNum/keptDen:0;
  // selected period
  const map = new Map(days.map(d=>[dayKey(d.date), d] as const));
  const selDays: Date[] = []; const c=new Date(rangeStart); c.setHours(0,0,0,0); const e=new Date(rangeEnd); e.setHours(0,0,0,0);
  while(c<=e){ selDays.push(new Date(c)); c.setDate(c.getDate()+1); }
  let selNum=0, selDen=0; for(const d of selDays){ const r=map.get(dayKey(d)); if(!r) continue; selNum+=(r as any)[cfg.numKey]||0; selDen+=(r as any)[cfg.denomKey]||0; }
  if (selDen===0) return hidden(metric, lookbackDays, keptDays, 'no activity in this period', { baseline: baselineRatio*100, value:0 });
  const actualPct = (selNum/selDen)*100; const baselinePct = baselineRatio*100; const diffPP = actualPct - baselinePct;
  const p = baselineRatio; let se = Math.sqrt(p*(1-p)/selDen)*100; if(!isFinite(se)||se<0.1) se=0.1;
  let z = diffPP / se; if (NEGATIVE.has(metric)) z*=-1; const tier = tierRates(z);
  return { metric, value: actualPct, valueType:'rate', tier, diff: diffPP, diffType:'pp', baseline: baselinePct, lookbackDays, keptDays, negativeMetric: NEGATIVE.has(metric), debug:{floor, keptDen, z, se} };
}

// Caches
const lookbackCache = new Map<string, DayRec[]>();
const resultCache = new Map<string, BenchmarkResult>();

function compute(metric: string, start: Date, end: Date): BenchmarkResult {
  const dm = DataManager.getInstance();
  const { start: lbStart, end: lbEnd } = buildLookback(start);
  const sig = `${dm.getCampaigns().length}:${dm.getFlowEmails().length}|${lbStart.toISOString()}|${lbEnd.toISOString()}`;
  let daily = lookbackCache.get(sig);
  if (!daily){
    daily = dm.getDailyRecords(lbStart, lbEnd) as DayRec[];
    lookbackCache.set(sig, daily);
  }
  if (TOTALS.has(metric) || TOTAL_STYLE_RATIO.has(metric)) return computeTotals(metric, start, end, daily);
  return computeRatio(metric, start, end, daily);
}

export function getBenchmark(metric: string | undefined, start?: Date, end?: Date): BenchmarkResult {
  if (!metric || !start || !end) return { metric: metric||'', value:0, valueType:'rate', tier:null, diff:null, diffType:null, baseline:null, lookbackDays:0, keptDays:0, hiddenReason:'missing inputs' };
  const dm = DataManager.getInstance();
  const key = `${metric}|${start.toISOString()}|${end.toISOString()}|${dm.getCampaigns().length}:${dm.getFlowEmails().length}`;
  const cached = resultCache.get(key); if (cached) return cached;
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
