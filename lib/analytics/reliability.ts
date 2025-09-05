import type { ProcessedCampaign, ProcessedFlowEmail } from '../data/dataTypes';

export interface WeeklyAggregate {
  weekStart: Date;
  label: string;
  totalRevenue: number;
  campaignRevenue: number;
  flowRevenue: number;
  daySet: Set<string>;
  isCompleteWeek: boolean;
}

export interface ReliabilityPoint {
  label: string;
  revenue: number;
  index: number; // revenue / median
  isAnomaly: boolean;
  zScore: number | null;
}

export interface ReliabilityResult {
  reliability: number | null; // 0-100 or null if insufficient
  trendDelta: number | null; // reliability - priorWindowReliability
  windowWeeks: number; // weeks used in computation
  points: ReliabilityPoint[];
  median: number | null;
  mad: number | null;
}

const ONE_DAY = 24 * 60 * 60 * 1000;

function startOfMonday(d: Date) {
  const dt = new Date(d);
  const day = dt.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // shift to Monday
  dt.setDate(dt.getDate() - diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function buildWeeklyAggregates(campaigns: ProcessedCampaign[], flows: ProcessedFlowEmail[]): WeeklyAggregate[] {
  if (!campaigns.length && !flows.length) return [];
  interface Bucket { totalRevenue: number; campaignRevenue: number; flowRevenue: number; daySet: Set<string>; weekStart: Date; }
  const map: Record<string, Bucket> = {};
  const add = (dt: Date, revenue: number | undefined, type: 'campaign' | 'flow') => {
    const ws = startOfMonday(dt);
    const key = ws.toISOString();
    if (!map[key]) map[key] = { totalRevenue: 0, campaignRevenue: 0, flowRevenue: 0, daySet: new Set(), weekStart: ws };
    const b = map[key];
    const r = revenue || 0;
    b.totalRevenue += r;
    if (type === 'campaign') b.campaignRevenue += r; else b.flowRevenue += r;
    b.daySet.add(dt.toISOString().slice(0,10));
  };
  for (const c of campaigns) add(c.sentDate, c.revenue, 'campaign');
  for (const f of flows) add(f.sentDate, f.revenue, 'flow');
  let weeks: WeeklyAggregate[] = Object.values(map).map(b => ({
    weekStart: b.weekStart,
    label: b.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    totalRevenue: b.totalRevenue,
    campaignRevenue: b.campaignRevenue,
    flowRevenue: b.flowRevenue,
    daySet: b.daySet,
    isCompleteWeek: false,
  }));
  weeks.sort((a,b)=> a.weekStart.getTime()-b.weekStart.getTime());
  // Fill explicit gaps
  if (weeks.length) {
    const start = weeks[0].weekStart.getTime();
    const end = weeks[weeks.length-1].weekStart.getTime();
    const ONE_WEEK = 7*ONE_DAY;
    const existing = new Set(weeks.map(w=>w.weekStart.getTime()));
    for (let t=start; t<=end; t+=ONE_WEEK) {
      if (!existing.has(t)) {
        const ws = new Date(t);
        weeks.push({ weekStart: ws, label: ws.toLocaleDateString('en-US',{month:'short',day:'numeric'}), totalRevenue:0, campaignRevenue:0, flowRevenue:0, daySet: new Set(), isCompleteWeek:false });
      }
    }
    weeks.sort((a,b)=>a.weekStart.getTime()-b.weekStart.getTime());
  }
  // Mark completeness: week fully in the past (>=7 days elapsed from start)
  const now = Date.now();
  for (const w of weeks) {
    w.isCompleteWeek = (w.weekStart.getTime() + 7*ONE_DAY) <= now;
  }
  return weeks;
}

/** Median helper */
function median(nums: number[]): number { if (!nums.length) return 0; const s=[...nums].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2? s[m] : (s[m-1]+s[m])/2; }

export interface ComputeReliabilityOptions { windowSize?: number; minWeeks?: number; scope: 'all' | 'campaigns' | 'flows'; }

export function computeReliability(weeks: WeeklyAggregate[], options: ComputeReliabilityOptions): ReliabilityResult {
  const { windowSize=12, minWeeks=4, scope } = options;
  if (!weeks.length) return { reliability: null, trendDelta: null, windowWeeks: 0, points: [], median: null, mad: null };
  // Scope revenues
  const series = weeks.map(w => scope==='campaigns'? w.campaignRevenue : scope==='flows'? w.flowRevenue : w.totalRevenue);
  const completeIdx = weeks.map((w,i)=> w.isCompleteWeek ? i : -1).filter(i=>i>=0);
  const completeSeries = completeIdx.map(i=> series[i]);
  if (completeSeries.length < minWeeks) return { reliability: null, trendDelta: null, windowWeeks: completeSeries.length, points: [], median: null, mad: null };
  const useWindow = completeSeries.slice(-windowSize);
  const med = median(useWindow.filter(n=>n>0).length ? useWindow.filter(n=>n>0) : useWindow);
  if (med <= 0) {
    return { reliability: 0, trendDelta: null, windowWeeks: useWindow.length, points: [], median: 0, mad: 0 };
  }
  const absDev = useWindow.map(v => Math.abs(v - med));
  const mad = median(absDev);
  const robustCv = mad / med; // dispersion proxy
  const k = 1.15; // calibration constant
  const raw = Math.exp(-k * robustCv);
  const reliability = Math.round(raw * 100);
  // Trend delta: preceding window of equal size just before current window (shifted by one week)
  let trendDelta: number | null = null;
  if (completeSeries.length >= useWindow.length + minWeeks) {
    const prevWindow = completeSeries.slice(-(useWindow.length+1), -1); // shift by one week
    if (prevWindow.length === useWindow.length) {
      const prevMed = median(prevWindow.filter(n=>n>0).length ? prevWindow.filter(n=>n>0) : prevWindow);
      if (prevMed > 0) {
        const prevMad = median(prevWindow.map(v=>Math.abs(v-prevMed)));
        const prevCv = prevMad / prevMed;
        const prevRaw = Math.exp(-k*prevCv);
        trendDelta = Math.round(raw*100 - prevRaw*100);
      }
    }
  }
  // Points for visualization: last up to (windowSize) + 4 context weeks
  const contextCount = Math.min(windowSize+4, weeks.length);
  const recentWeeks = weeks.slice(-contextCount);
  const recentSeries = series.slice(-contextCount);
  const scaleMed = med;
  const scaleMad = mad;
  const points: ReliabilityPoint[] = recentWeeks.map((w, idx) => {
    const revenue = recentSeries[idx];
    let z: number | null = null;
    let anomaly = false;
    if (scaleMad > 0) {
      // 1.4826 approximates normal std from MAD
      z = (revenue - scaleMed) / (1.4826 * scaleMad);
      anomaly = Math.abs(z) > 2.5;
    }
    return { label: w.label, revenue, index: scaleMed>0? revenue/scaleMed : 0, isAnomaly: anomaly, zScore: z };
  });
  return { reliability, trendDelta, windowWeeks: useWindow.length, points, median: med, mad };
}
