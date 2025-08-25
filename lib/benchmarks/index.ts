// Vendored unified Klaviyo benchmark system for cloud deployment (no cross-repo import)
export type BenchmarkCategory = 'Campaigns' | 'Flows' | 'Combined';
export type RawStatusKey = 'Excellent' | 'Good' | 'OK' | 'Attention_Needed' | 'Critical';
export type CanonicalStatus = 'excellent' | 'good' | 'ok' | 'attention' | 'critical';

export interface ParsedRange { min?: number; max?: number; minInclusive?: boolean; maxInclusive?: boolean; }
export interface BenchmarkSet { category: BenchmarkCategory; metric: string; ranges: Record<CanonicalStatus, ParsedRange>; order: CanonicalStatus[]; }
export interface BenchmarkResultV2 { status: CanonicalStatus; label: string; colorClass: string; hexColor: string; }

const RAW_BENCHMARKS: Record<BenchmarkCategory, Record<string, Record<RawStatusKey, string>>> = {
    Campaigns: {
        Conversion_Rate_Click_to_Purchase: { Excellent: '>=3.0%', Good: '2.0 - 2.9%', OK: '1.0 - 1.9%', Attention_Needed: '0.5 - 0.9%', Critical: '<0.5%' },
        Open_Rate: { Excellent: '>=30%', Good: '25 - 29%', OK: '20 - 24%', Attention_Needed: '15 - 19%', Critical: '<15%' },
        Click_Rate: { Excellent: '>=3.5%', Good: '2.5 - 3.4%', OK: '1.5 - 2.4%', Attention_Needed: '1.0 - 1.4%', Critical: '<1.0%' },
        Click_to_Open_Rate: { Excellent: '>=15%', Good: '12 - 14%', OK: '8 - 11%', Attention_Needed: '5 - 7%', Critical: '<5%' },
        Revenue_per_Email: { Excellent: '>= $0.25', Good: '$0.15 - $0.24', OK: '$0.08 - $0.14', Attention_Needed: '$0.04 - $0.07', Critical: '< $0.04' },
        Unsubscribe_Rate: { Excellent: '<=0.2%', Good: '0.21 - 0.3%', OK: '0.31 - 0.5%', Attention_Needed: '0.51 - 0.7%', Critical: '>0.7%' },
        Spam_Rate: { Excellent: '<=0.02%', Good: '0.021 - 0.05%', OK: '0.051 - 0.1%', Attention_Needed: '0.11 - 0.15%', Critical: '>0.15%' },
        Bounce_Rate: { Excellent: '<=0.5%', Good: '0.51 - 0.7%', OK: '0.71 - 1.0%', Attention_Needed: '1.01 - 1.5%', Critical: '>1.5%' }
    },
    Flows: {
        Conversion_Rate_Click_to_Purchase: { Excellent: '>=8.0%', Good: '6.0 - 7.9%', OK: '3.0 - 5.9%', Attention_Needed: '1.5 - 2.9%', Critical: '<1.5%' },
        Open_Rate: { Excellent: '>=50%', Good: '40 - 49%', OK: '30 - 39%', Attention_Needed: '20 - 29%', Critical: '<20%' },
        Click_Rate: { Excellent: '>=7.0%', Good: '5.0 - 6.9%', OK: '3.0 - 4.9%', Attention_Needed: '2.0 - 2.9%', Critical: '<2.0%' },
        Click_to_Open_Rate: { Excellent: '>=25%', Good: '18 - 24%', OK: '12 - 17%', Attention_Needed: '8 - 11%', Critical: '<8%' },
        Revenue_per_Email: { Excellent: '>= $1.50', Good: '$1.00 - $1.49', OK: '$0.50 - $0.99', Attention_Needed: '$0.20 - $0.49', Critical: '< $0.20' },
        Unsubscribe_Rate: { Excellent: '<=0.05%', Good: '0.051 - 0.1%', OK: '0.11 - 0.2%', Attention_Needed: '0.21 - 0.3%', Critical: '>0.3%' },
        Spam_Rate: { Excellent: '<=0.01%', Good: '0.011 - 0.03%', OK: '0.031 - 0.05%', Attention_Needed: '0.051 - 0.08%', Critical: '>0.08%' },
        Bounce_Rate: { Excellent: '<=0.2%', Good: '0.21 - 0.3%', OK: '0.31 - 0.5%', Attention_Needed: '0.51 - 0.8%', Critical: '>0.8%' }
    },
    Combined: {
        Conversion_Rate_Click_to_Purchase: { Excellent: '>=5.0%', Good: '3.5 - 4.9%', OK: '2.0 - 3.4%', Attention_Needed: '1.0 - 1.9%', Critical: '<1.0%' },
        Open_Rate: { Excellent: '>=40%', Good: '35 - 39%', OK: '25 - 34%', Attention_Needed: '18 - 24%', Critical: '<18%' },
        Click_Rate: { Excellent: '>=5.0%', Good: '3.5 - 4.9%', OK: '2.0 - 3.4%', Attention_Needed: '1.0 - 1.9%', Critical: '<1.0%' },
        Click_to_Open_Rate: { Excellent: '>=20%', Good: '15 - 19%', OK: '10 - 14%', Attention_Needed: '7 - 9%', Critical: '<7%' },
        Revenue_per_Email: { Excellent: '>= $0.50', Good: '$0.30 - $0.49', OK: '$0.15 - $0.29', Attention_Needed: '$0.08 - $0.14', Critical: '< $0.08' },
        Unsubscribe_Rate: { Excellent: '<=0.1%', Good: '0.11 - 0.2%', OK: '0.21 - 0.3%', Attention_Needed: '0.31 - 0.5%', Critical: '>0.5%' },
        Spam_Rate: { Excellent: '<=0.02%', Good: '0.021 - 0.05%', OK: '0.051 - 0.1%', Attention_Needed: '0.11 - 0.15%', Critical: '>0.15%' },
        Bounce_Rate: { Excellent: '<=0.3%', Good: '0.31 - 0.5%', OK: '0.51 - 0.7%', Attention_Needed: '0.71 - 1.0%', Critical: '>1.0%' }
    }
};

const STATUS_MAP: Record<RawStatusKey, CanonicalStatus> = { Excellent: 'excellent', Good: 'good', OK: 'ok', Attention_Needed: 'attention', Critical: 'critical' };
const STATUS_META: Record<CanonicalStatus, { label: string; hex: string; class: string }> = {
    excellent: { label: 'Excellent', hex: '#2ECC71', class: 'text-green-500' },
    good: { label: 'Good', hex: '#27AE60', class: 'text-emerald-600' },
    ok: { label: 'OK', hex: '#F1C40F', class: 'text-yellow-500' },
    attention: { label: 'Attention Needed', hex: '#E67E22', class: 'text-orange-500' },
    critical: { label: 'Critical', hex: '#E74C3C', class: 'text-red-600' }
};
const METRIC_KEY_MAP: Record<string, string> = {
    Conversion_Rate_Click_to_Purchase: 'conversionRate', Open_Rate: 'openRate', Click_Rate: 'clickRate', Click_to_Open_Rate: 'clickToOpenRate', Revenue_per_Email: 'revenuePerEmail', Unsubscribe_Rate: 'unsubscribeRate', Spam_Rate: 'spamRate', Bounce_Rate: 'bounceRate'
};

function parseRange(str: string): ParsedRange {
    const s = str.trim();
    const numVal = (v: string) => { const cleaned = v.replace(/[%,$\s]/g, ''); const n = parseFloat(cleaned); return isNaN(n) ? undefined : n; };
    if (/^>=/.test(s)) return { min: numVal(s.slice(2)), minInclusive: true };
    if (/^<=/.test(s)) return { max: numVal(s.slice(2)), maxInclusive: true };
    if (/^>/.test(s)) return { min: numVal(s.slice(1)), minInclusive: false };
    if (/^</.test(s)) return { max: numVal(s.slice(1)), maxInclusive: false };
    const hyphen = s.match(/([$0-9.,\s%]+)-([\s$0-9.,%]+)/);
    if (hyphen) { const left = numVal(hyphen[1]); const right = numVal(hyphen[2]); return { min: left, max: right, minInclusive: true, maxInclusive: true }; }
    const single = numVal(s); if (single !== undefined) return { min: single, minInclusive: true }; return {};
}

function buildSets(): BenchmarkSet[] {
    const sets: BenchmarkSet[] = [];
    (Object.keys(RAW_BENCHMARKS) as BenchmarkCategory[]).forEach(category => {
        const metrics = RAW_BENCHMARKS[category];
        Object.entries(metrics).forEach(([rawMetricKey, rawStatusMap]) => {
            const internalKey = METRIC_KEY_MAP[rawMetricKey] || rawMetricKey;
            const ranges: Record<CanonicalStatus, ParsedRange> = { excellent: {}, good: {}, ok: {}, attention: {}, critical: {} };
            Object.entries(rawStatusMap).forEach(([rawStatus, rangeStr]) => { const canonical = STATUS_MAP[rawStatus as RawStatusKey]; ranges[canonical] = parseRange(rangeStr); });
            sets.push({ category, metric: internalKey, ranges, order: ['excellent', 'good', 'ok', 'attention', 'critical'] });
        });
    });
    return sets;
}

const ALL_SETS = buildSets();
const LOOKUP: Record<BenchmarkCategory, Record<string, BenchmarkSet>> = { Campaigns: {}, Flows: {}, Combined: {} };
for (const set of ALL_SETS) LOOKUP[set.category][set.metric] = set;

function inRange(value: number, r: ParsedRange): boolean {
    if (r.min !== undefined) { if (r.minInclusive ? value < r.min : value <= r.min) return false; }
    if (r.max !== undefined) { if (r.maxInclusive ? value > r.max : value >= r.max) return false; }
    return true;
}

function isLowerBetter(category: BenchmarkCategory, metric: string): boolean {
    const raw = RAW_BENCHMARKS[category];
    const originalKey = Object.keys(METRIC_KEY_MAP).find(k => METRIC_KEY_MAP[k] === metric) || metric;
    const excellentStr = raw?.[originalKey]?.Excellent;
    return !!excellentStr && /^<=/.test(excellentStr.trim());
}

const LOWER_BETTER_CACHE = new Set<string>();

export function getBenchmarkStatusV2(metricKey: string, value: number, category: BenchmarkCategory = 'Campaigns'): BenchmarkResultV2 | null {
    const metricSet = LOOKUP[category][metricKey];
    if (!metricSet) return null;
    const cacheKey = category + ':' + metricKey;
    let lower = LOWER_BETTER_CACHE.has(cacheKey);
    if (!lower && isLowerBetter(category, metricKey)) { LOWER_BETTER_CACHE.add(cacheKey); lower = true; }
    for (const status of metricSet.order) {
        if (inRange(value, metricSet.ranges[status])) { const meta = STATUS_META[status]; return { status, label: meta.label, colorClass: meta.class, hexColor: meta.hex }; }
    }
    return null;
}

export interface LegacyBenchmarkResult { status: 'good' | 'ok' | 'attention' | 'critical' | 'excellent'; label: string; color: string; hexColor?: string; }
const ENABLE_V2 = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BENCHMARKS_V2 === '1';

export function getBenchmarkStatus(metricKey: string, value: number, category: BenchmarkCategory = 'Campaigns'): LegacyBenchmarkResult | null {
    const v2 = getBenchmarkStatusV2(metricKey, value, category);
    if (!v2) return null;
    if (!ENABLE_V2) {
        if (v2.status === 'excellent') { return { status: 'good', label: 'Good', color: 'text-green-600 dark:text-green-400', hexColor: v2.hexColor }; }
        const legacyColorMap: Record<string, string> = { good: 'text-green-600 dark:text-green-400', ok: 'text-blue-600 dark:text-blue-400', attention: 'text-yellow-600 dark:text-yellow-400', critical: 'text-red-600 dark:text-red-400' };
        return { status: v2.status, label: v2.label, color: legacyColorMap[v2.status], hexColor: v2.hexColor } as LegacyBenchmarkResult;
    }
    return { status: v2.status, label: v2.label, color: v2.colorClass, hexColor: v2.hexColor } as LegacyBenchmarkResult;
}

export function parseMetricValue(formattedValue: string): number { const cleaned = formattedValue.replace(/[$,%\s]/g, ''); return parseFloat(cleaned) || 0; }
export const __debug = { RAW_BENCHMARKS, LOOKUP };
