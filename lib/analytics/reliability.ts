import type { ProcessedCampaign, ProcessedFlowEmail } from '../data/dataTypes';

export interface WeeklyAggregate {
  weekStart: Date;
  label: string;
  totalRevenue: number;
  campaignRevenue: number;
  flowRevenue: number;
  // New: count of distinct campaign sends within the week (not emails sent)
  campaignsSent?: number;
  daySet: Set<string>;
  isCompleteWeek: boolean;
}

export interface MonthlyAggregate {
  monthStart: Date;
  label: string;
  totalRevenue: number;
  campaignRevenue: number;
  flowRevenue: number;
  daySet: Set<string>;
  isCompleteMonth: boolean;
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
  zeroCampaignWeeks?: number; // count of genuine zero campaign weeks in analysis range
  estLostCampaignRevenue?: number; // conservative estimate of revenue lost due to zero campaign weeks
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
  interface Bucket { totalRevenue: number; campaignRevenue: number; flowRevenue: number; daySet: Set<string>; weekStart: Date; campaignCount: number; }
  const map: Record<string, Bucket> = {};
  const add = (dt: Date, revenue: number | undefined, type: 'campaign' | 'flow') => {
    const ws = startOfMonday(dt);
    const key = ws.toISOString();
    if (!map[key]) map[key] = { totalRevenue: 0, campaignRevenue: 0, flowRevenue: 0, daySet: new Set(), weekStart: ws, campaignCount: 0 };
    const b = map[key];
    const r = revenue || 0;
    b.totalRevenue += r;
    if (type === 'campaign') { b.campaignRevenue += r; b.campaignCount += 1; } else { b.flowRevenue += r; }
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
    campaignsSent: b.campaignCount,
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
  weeks.push({ weekStart: ws, label: ws.toLocaleDateString('en-US',{month:'short',day:'numeric'}), totalRevenue:0, campaignRevenue:0, flowRevenue:0, campaignsSent: 0, daySet: new Set(), isCompleteWeek:false });
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

/** Build a continuous sequence of full Monday-start weeks between startDate and endDate (inclusive) using raw sends; does NOT fabricate zero weeks beyond needed timeline. */
export function buildWeeklyAggregatesInRange(
  campaigns: ProcessedCampaign[],
  flows: ProcessedFlowEmail[],
  startDate: Date,
  endDate: Date
): WeeklyAggregate[] {
  if (endDate < startDate) return [];
  const startMonday = startOfMonday(startDate);
  // Ensure end boundary covers entire last week
  const endMonday = startOfMonday(endDate);
  const ONE_WEEK = 7 * ONE_DAY;
  // Completeness should be evaluated relative to the selected range end, not the current time
  const completeBoundaryMs = new Date(endDate).setHours(23, 59, 59, 999);
  // Aggregate raw sends first by canonical Monday key
  interface Bucket { totalRevenue: number; campaignRevenue: number; flowRevenue: number; daySet: Set<string>; weekStart: Date; campaignCount: number; }
  const map: Record<string, Bucket> = {};
  const add = (dt: Date, revenue: number | undefined, type: 'campaign' | 'flow') => {
    if (dt < startMonday || dt > endDate) return; // outside
    const ws = startOfMonday(dt);
    if (ws < startMonday || ws > endMonday) return;
    const key = ws.toISOString();
    if (!map[key]) map[key] = { totalRevenue: 0, campaignRevenue: 0, flowRevenue: 0, daySet: new Set(), weekStart: ws, campaignCount: 0 };
    const b = map[key];
    const r = revenue || 0;
    b.totalRevenue += r;
    if (type === 'campaign') { b.campaignRevenue += r; b.campaignCount += 1; } else { b.flowRevenue += r; }
    b.daySet.add(dt.toISOString().slice(0,10));
  };
  for (const c of campaigns) add(c.sentDate, c.revenue, 'campaign');
  for (const f of flows) add(f.sentDate, f.revenue, 'flow');
  const weeks: WeeklyAggregate[] = [];
  for (let t = startMonday.getTime(); t <= endMonday.getTime(); t += ONE_WEEK) {
    const ws = new Date(t);
    const key = ws.toISOString();
  if (map[key]) {
      const b = map[key];
      weeks.push({
        weekStart: b.weekStart,
        label: b.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        totalRevenue: b.totalRevenue,
        campaignRevenue: b.campaignRevenue,
        flowRevenue: b.flowRevenue,
        campaignsSent: b.campaignCount,
        daySet: b.daySet,
    isCompleteWeek: (b.weekStart.getTime() + 7*ONE_DAY - 1) <= completeBoundaryMs
      });
    } else {
      // Only include a zero week if it lies wholly within range; genuine zero (no sends of either type)
      weeks.push({
        weekStart: ws,
        label: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        totalRevenue: 0,
        campaignRevenue: 0,
        flowRevenue: 0,
        campaignsSent: 0,
        daySet: new Set(),
    isCompleteWeek: (ws.getTime() + 7*ONE_DAY - 1) <= completeBoundaryMs
      });
    }
  }
  return weeks;
}

function startOfMonth(d: Date) {
  const dt = new Date(d);
  dt.setDate(1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isCompleteMonth(monthStart: Date): boolean {
  const now = new Date();
  const nextMonth = new Date(monthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return nextMonth <= now;
}

export function buildMonthlyAggregatesInRange(
  campaigns: ProcessedCampaign[],
  flows: ProcessedFlowEmail[],
  startDate: Date,
  endDate: Date
): MonthlyAggregate[] {
  if (endDate < startDate) return [];
  
  const startMonth = startOfMonth(startDate);
  const endMonth = startOfMonth(endDate);
  
  // Aggregate raw sends by canonical month key
  interface Bucket { totalRevenue: number; campaignRevenue: number; flowRevenue: number; daySet: Set<string>; monthStart: Date; }
  const map: Record<string, Bucket> = {};
  
  const add = (dt: Date, revenue: number | undefined, type: 'campaign' | 'flow') => {
    if (dt < startDate || dt > endDate) return; // outside range
    const ms = startOfMonth(dt);
    if (ms < startMonth || ms > endMonth) return;
    const key = ms.toISOString();
    if (!map[key]) map[key] = { totalRevenue: 0, campaignRevenue: 0, flowRevenue: 0, daySet: new Set(), monthStart: ms };
    const b = map[key];
    const r = revenue || 0;
    b.totalRevenue += r;
    if (type === 'campaign') b.campaignRevenue += r; else b.flowRevenue += r;
    b.daySet.add(dt.toISOString().slice(0,10));
  };
  
  for (const c of campaigns) add(c.sentDate, c.revenue, 'campaign');
  for (const f of flows) add(f.sentDate, f.revenue, 'flow');
  
  const months: MonthlyAggregate[] = [];
  let current = new Date(startMonth);
  
  while (current <= endMonth) {
    const key = current.toISOString();
    if (map[key]) {
      const b = map[key];
      months.push({
        monthStart: b.monthStart,
        label: b.monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        totalRevenue: b.totalRevenue,
        campaignRevenue: b.campaignRevenue,
        flowRevenue: b.flowRevenue,
        daySet: b.daySet,
        isCompleteMonth: isCompleteMonth(b.monthStart)
      });
    } else {
      // Include zero month if it's complete and within range
      months.push({
        monthStart: new Date(current),
        label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        totalRevenue: 0,
        campaignRevenue: 0,
        flowRevenue: 0,
        daySet: new Set(),
        isCompleteMonth: isCompleteMonth(current)
      });
    }
    
    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }
  
  return months;
}

/** Median helper */
function median(nums: number[]): number { if (!nums.length) return 0; const s=[...nums].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2? s[m] : (s[m-1]+s[m])/2; }

export interface ComputeReliabilityOptions { windowSize?: number; minPeriods?: number; scope: 'all' | 'campaigns' | 'flows'; }

type PeriodAggregate = WeeklyAggregate | MonthlyAggregate;

export function computeReliability(periods: PeriodAggregate[], options: ComputeReliabilityOptions): ReliabilityResult {
  const { windowSize=12, minPeriods=4, scope } = options;
  if (!periods.length) return { reliability: null, trendDelta: null, windowWeeks: 0, points: [], median: null, mad: null };
  
  // Scope revenues
  const series = periods.map(p => scope==='campaigns'? p.campaignRevenue : scope==='flows'? p.flowRevenue : p.totalRevenue);
  
  // DEBUG: Log basic info
  console.log('🔍 Revenue Reliability Debug:');
  console.log(`  Total periods: ${periods.length}, Scope: ${scope}, WindowSize: ${windowSize}`);
  console.log(`  Full series revenues:`, series);
  console.log(`  Revenue range: min=${Math.min(...series)}, max=${Math.max(...series)}, sum=${series.reduce((a,b) => a+b, 0)}`);
  
  // Get complete periods
  const completeIdx = periods.map((p,i)=> {
    const isComplete = 'isCompleteWeek' in p ? p.isCompleteWeek : p.isCompleteMonth;
    return isComplete ? i : -1;
  }).filter(i=>i>=0);
  
  const completeSeries = completeIdx.map(i=> series[i]);
  console.log(`  Complete periods: ${completeSeries.length}/${periods.length}`);
  console.log(`  Complete series revenues:`, completeSeries);
  
  if (completeSeries.length < minPeriods) return { reliability: null, trendDelta: null, windowWeeks: completeSeries.length, points: [], median: null, mad: null };
  
  // Start with the most recent `windowSize` complete periods
  let useWindow = completeSeries.slice(-windowSize);
  console.log(`  Analysis window (last ${windowSize}):`, useWindow);

  // If the recent window contains too few non-zero values, expand backward to include earlier complete periods
  const desiredNonZero = Math.min(3, Math.max(1, Math.floor(windowSize / 4))); // aim for at least a few non-zero observations
  let nonZeroCount = useWindow.filter(n => n > 0).length;
  if (nonZeroCount < desiredNonZero && completeSeries.length > useWindow.length) {
    // Expand the window backward until we have enough non-zero values or we exhaust the series
    let startIdx = Math.max(0, completeSeries.length - windowSize) - 1;
    while (startIdx >= 0 && nonZeroCount < desiredNonZero) {
      if (completeSeries[startIdx] > 0) nonZeroCount++;
      startIdx--;
    }
    const newStart = Math.max(0, startIdx + 1);
    useWindow = completeSeries.slice(newStart);
    console.log(`  Expanded analysis window to include earlier data. New window length: ${useWindow.length}, nonZeroCount: ${nonZeroCount}`);
  }

  const positiveValues = useWindow.filter(n => n > 0);
  let valuesForMedian = positiveValues.length ? positiveValues : useWindow;

  // If median would be zero but there is meaningful revenue elsewhere in the complete series,
  // fall back to using the most recent non-zero values across the whole completeSeries (best-effort)
  if (valuesForMedian.length && valuesForMedian.every(v => v === 0) && completeSeries.some(v => v > 0)) {
    const lastNonZeros = completeSeries.filter(v => v > 0);
    // Use up to `windowSize` most recent non-zero values
    const fallback = lastNonZeros.slice(-Math.min(lastNonZeros.length, windowSize));
    if (fallback.length) {
      console.log(`  Falling back to last ${fallback.length} non-zero values across the series for median calc:`, fallback);
      valuesForMedian = fallback;
    }
  }
  console.log(`  Values for median calculation:`, valuesForMedian);
  
  const med = median(valuesForMedian);
  console.log(`  Calculated median: ${med}`);
  
  if (med <= 0) {
    return { reliability: 0, trendDelta: null, windowWeeks: useWindow.length, points: [], median: 0, mad: 0 };
  }
  
  const absDev = useWindow.map(v => Math.abs(v - med));
  console.log(`  Absolute deviations from median:`, absDev);
  
  const mad = median(absDev);
  console.log(`  Calculated MAD: ${mad}`);
  
  const robustCv = mad / med; // dispersion proxy
  console.log(`  Robust CV (MAD/median): ${robustCv}`);
  
  const k = 1.15; // calibration constant
  const raw = Math.exp(-k * robustCv);
  const reliability = Math.round(raw * 100);
  console.log(`  Final reliability score: ${reliability}%`);
  
  // Trend delta: preceding window of equal size just before current window (shifted by one period)
  let trendDelta: number | null = null;
  if (completeSeries.length >= useWindow.length + minPeriods) {
    const prevWindow = completeSeries.slice(-(useWindow.length+1), -1); // shift by one period
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
  
  // Points for visualization: last up to (windowSize) + 4 context periods
  const contextCount = Math.min(windowSize+4, periods.length);
  const recentPeriods = periods.slice(-contextCount);
  const recentSeries = series.slice(-contextCount);
  const scaleMed = med;
  const scaleMad = mad;
  const points: ReliabilityPoint[] = recentPeriods.map((p, idx) => {
    const revenue = recentSeries[idx];
    let z: number | null = null;
    let anomaly = false;
    if (scaleMad > 0) {
      // 1.4826 approximates normal std from MAD
      z = (revenue - scaleMed) / (1.4826 * scaleMad);
      anomaly = Math.abs(z) > 2.5;
    }
    return { label: p.label, revenue, index: scaleMed>0? revenue/scaleMed : 0, isAnomaly: anomaly, zScore: z };
  });
  
  // Zero campaign period analysis (only meaningful when scope is campaigns or all)
  let zeroWeeks = 0;
  let lostRev = 0;
  if (options.scope === 'campaigns' || options.scope === 'all') {
    // Build campaign revenue list aligned with periods
    const campaignSeries = periods.map(p => p.campaignRevenue);
    // Identify indices of zero campaign periods that are complete
    const zeroIdx = periods.map((p,i)=> {
      const isComplete = 'isCompleteWeek' in p ? p.isCompleteWeek : p.isCompleteMonth;
      return (isComplete && p.campaignRevenue === 0) ? i : -1;
    }).filter(i=>i>=0);
    
    // For each zero period ensure there exists at least one non-zero campaign period in total period to avoid skew if no campaigns ever
    const anyCampaign = campaignSeries.some(v=>v>0);
    if (anyCampaign) {
      zeroWeeks = zeroIdx.length;
      // Precompute nearest non-zero neighbors for each zero period
      const nonZeroIndices = campaignSeries.map((v,i)=> v>0? i : -1).filter(i=>i>=0);
      for (const zi of zeroIdx) {
        // Find prev
        let prevIdx: number | null = null; 
        for (let i=nonZeroIndices.length-1;i>=0;i--) { 
          if (nonZeroIndices[i] < zi) { prevIdx = nonZeroIndices[i]; break; } 
        }
        let nextIdx: number | null = null; 
        for (let i=0;i<nonZeroIndices.length;i++) { 
          if (nonZeroIndices[i] > zi) { nextIdx = nonZeroIndices[i]; break; } 
        }
        let estimate = 0;
        if (prevIdx != null && nextIdx != null) {
          estimate = 0.75 * ((campaignSeries[prevIdx] + campaignSeries[nextIdx]) / 2);
        } else if (prevIdx != null) {
          estimate = 0.75 * campaignSeries[prevIdx];
        } else if (nextIdx != null) {
          estimate = 0.75 * campaignSeries[nextIdx];
        }
        lostRev += estimate;
      }
    }
  }
  return { reliability, trendDelta, windowWeeks: useWindow.length, points, median: med, mad, zeroCampaignWeeks: zeroWeeks, estLostCampaignRevenue: lostRev>0? lostRev : undefined };
}
