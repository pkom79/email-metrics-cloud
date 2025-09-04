"use client";
import React from 'react';
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import Sparkline from './Sparkline';
import { parseMetricValue } from '../../lib/utils/benchmarks'; // still used for conversionRate special case
import { useBenchmark } from '../../lib/data/benchmarking';
import { getMetricDefinition } from '../../lib/data/metricDefinitions';

interface MetricCardProps {
    title: string;
    value: string;
    change: number;
    isPositive: boolean;
    dateRange: string;
    isNegativeMetric?: boolean;
    metricKey?: string;
    sparklineData?: { value: number; date: string }[];
    // Kept for compatibility but not rendered anymore
    granularity?: 'daily' | 'weekly' | 'monthly';
    // Previous period tooltip data
    previousValue?: number;
    previousPeriod?: { startDate: Date; endDate: Date };
    compareMode?: 'prev-period' | 'prev-year';
    benchmarkCategory?: 'Campaigns' | 'Flows' | 'Combined';
}

const MetricCard: React.FC<MetricCardProps> = ({
    title,
    value,
    change,
    isPositive,
    dateRange,
    isNegativeMetric = false,
    metricKey,
    sparklineData = [],
    previousValue,
    previousPeriod,
    compareMode = 'prev-period',
    benchmarkCategory = 'Campaigns'
}) => {
    const isAllTime = dateRange === 'all';
    const DISPLAY_EPS = 0.05; // <0.05% rounds to 0.0%

    const shouldShowAsPositive = isPositive;
    const hasInsufficientData = previousValue == null || previousPeriod == null;
    const tinyChange = Math.abs(change) < DISPLAY_EPS; // will display as 0.0%
    const isZeroDisplay = tinyChange || Math.abs(change) < 1e-9;
    const showChangeBlock = !isAllTime && !hasInsufficientData;
    const isIncrease = change > 0;
    // Derive current selected range boundaries from sparkline data (first/last points)
    // Anchor should be the range END so we look back from the most recent visible period.
    // Using start caused zero historical weeks when viewing a recent short range (e.g., 30d) because all weeks are >= anchor.
    // Memoize derived range bounds; avoid creating new Date objects if underlying iso strings unchanged
    const [rangeStart, rangeEnd] = React.useMemo(() => {
        if (!sparklineData || !sparklineData.length) return [undefined, undefined] as [Date | undefined, Date | undefined];
        const firstRaw: any = sparklineData[0];
        const lastRaw: any = sparklineData[sparklineData.length - 1];
        const firstIso = firstRaw.iso || firstRaw.date;
        const lastIso = lastRaw.iso || lastRaw.date;
        // Use cached refs on window to compare and reuse objects (lightweight global cache acceptable for client-only component)
        if (typeof window !== 'undefined') {
            const cache = (window as any).__MC_RANGE_CACHE__ || ((window as any).__MC_RANGE_CACHE__ = {});
            const prev = cache[metricKey || title];
            if (prev && prev.firstIso === firstIso && prev.lastIso === lastIso) {
                return [prev.start, prev.end];
            }
            const start = new Date(firstIso);
            const end = new Date(lastIso);
            cache[metricKey || title] = { firstIso, lastIso, start, end };
            return [start, end];
        }
        return [new Date(firstIso), new Date(lastIso)];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sparklineData, metricKey, title]);
    // Adaptive benchmarking: pass the actual visible range (start/end) so "current" aggregates that range.
    // We previously advanced an anchor +7d which caused current aggregation to resolve to an empty week (future) => 0 values & -100% deltas.
    const adaptive = useBenchmark(metricKey, rangeStart, rangeEnd);
    if (typeof window !== 'undefined') {
        (window as any).__metricCardRenders = ((window as any).__metricCardRenders || 0) + 1;
        if ((window as any).__metricCardRenders % 200 === 0) {
            console.warn('[MetricCard] High render count', { count: (window as any).__metricCardRenders, metricKey, rangeStart, rangeEnd });
        }
    }
    if (typeof window !== 'undefined' && metricKey) {
        // @ts-ignore
        if (window.__BENCH_DEBUG__ !== false) console.debug('[AdaptiveBenchmark]', metricKey, { rangeStart, rangeEnd, tier: adaptive?.tier, hiddenReason: adaptive?.hiddenReason });
    }
    const numericValue = metricKey === 'conversionRate' ? parseMetricValue(value) : undefined;

    const getValueFormat = () => {
        if (!metricKey) return 'number';
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metricKey)) return 'currency';
        if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metricKey)) return 'percentage';
        return 'number';
    };
    const valueFormat = getValueFormat();

    const formatPrevValue = (v?: number) => {
        if (v == null) return '';
        switch (valueFormat) {
            case 'currency':
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
            case 'percentage':
                const formatted = v.toFixed(1);
                const num = parseFloat(formatted);
                return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
            default:
                return Math.round(v).toLocaleString('en-US');
        }
    };
    const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const label = compareMode === 'prev-year' ? 'Same period last year' : 'Previous period';
    const trendTooltip = previousPeriod && previousValue != null
        ? `${label} (${formatDate(previousPeriod.startDate)} – ${formatDate(previousPeriod.endDate)}): ${formatPrevValue(previousValue)}`
        : `Change vs ${label.toLowerCase()}`;

    return (
        <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:shadow-lg transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.03] hover:z-20 will-change-transform origin-center`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex-1">
                    <p className={`text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400`}>
                        {title}
                    </p>
                    {/* Adaptive benchmark badge (reserved 20px height) */}
                    <div className="mt-1 h-5 flex items-center">
                        {adaptive && (
                            (() => {
                                if (!adaptive.tier) {
                                    return (
                                        <span className="group relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-gray-50 text-gray-600 border-gray-200">
                                            Benchmarks
                                            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-5 z-30 hidden group-hover:block w-64 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                                                Benchmark hidden. {adaptive.hiddenReason || 'Insufficient history'}.
                                            </span>
                                        </span>
                                    );
                                }
                                const tierColors: Record<string, string> = {
                                    'Critical': 'bg-rose-50 text-rose-700 border-rose-200',
                                    'Needs Attention': 'bg-amber-50 text-amber-700 border-amber-200',
                                    'OK': 'bg-gray-50 text-gray-700 border-gray-200',
                                    'Good': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                    'Excellent': 'bg-purple-50 text-purple-700 border-purple-200',
                                };
                                const cls = tierColors[adaptive.tier] || 'bg-gray-50 text-gray-700 border-gray-200';
                                const pct = adaptive.diff != null && adaptive.diffType === 'percent' ? adaptive.diff : null;
                                const definition = getMetricDefinition(metricKey);
                                // For totals we normalize display of baseline to daily mean if baselineDaily available so user isn't confused by day-count differences
                                const displayBaseline = (() => {
                                    if (adaptive.baseline == null) return '—';
                                    if (!metricKey) return adaptive.baseline.toFixed(2);
                                    if (['revenue', 'totalOrders', 'emailsSent'].includes(metricKey) && adaptive.baselineDaily) {
                                        // Show both range baseline and daily mean
                                        return `${new Intl.NumberFormat('en-US', { style: metricKey === 'revenue' ? 'currency' : 'decimal', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(adaptive.baseline)} (Daily avg ${metricKey === 'revenue' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(adaptive.baselineDaily) : adaptive.baselineDaily.toFixed(1)})`;
                                    }
                                    if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metricKey)) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(adaptive.baseline);
                                    if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metricKey)) return adaptive.baseline.toFixed(2);
                                    return adaptive.baseline.toFixed(2);
                                })();
                                return (
                                    <span className={`group relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
                                        {adaptive.tier}
                                        {pct != null && <span className="tabular-nums">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>}
                                        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-5 z-30 hidden group-hover:block w-72 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                                            <span className="font-semibold block mb-1">Benchmark</span>
                                            Baseline: {displayBaseline}<br />
                                            {adaptive.diff != null && adaptive.diffType === 'percent' && <>Difference vs benchmark: {adaptive.diff >= 0 ? '+' : ''}{adaptive.diff.toFixed(1)}%</>}
                                            {adaptive.diff != null && adaptive.diffType === 'pp' && <>Difference vs benchmark: {adaptive.diff >= 0 ? '+' : ''}{adaptive.diff.toFixed(1)} pp</>}<br />
                                            {definition && <span className="block mt-1 text-gray-600">{definition}</span>}
                                            {adaptive.hiddenReason && <span className="text-gray-600">{adaptive.hiddenReason}</span>}
                                        </span>
                                    </span>
                                );
                            })()
                        )}
                    </div>
                </div>
            </div>

            <Sparkline
                isPositive={shouldShowAsPositive}
                change={change}
                isAllTime={isAllTime}
                isNegativeMetric={isNegativeMetric}
                data={sparklineData}
                valueFormat={valueFormat as any}
                hasInsufficientData={hasInsufficientData}
                forceZeroStyle={showChangeBlock ? isZeroDisplay : true /* if we hide arrow treat as purple */}
            />

            <div className="flex items-end justify-between">
                <p className={`text-2xl font-bold text-gray-900 dark:text-white`}>
                    {value}
                </p>
                <div className="flex items-center gap-2">
                    {metricKey === 'conversionRate' && numericValue !== undefined && numericValue > 100 && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border border-purple-200 text-purple-700 bg-purple-50 dark:border-purple-700 dark:text-purple-200 dark:bg-purple-900/30`}>
                            Includes view-through
                        </span>
                    )}
                    {showChangeBlock && (
                        <div
                            className={`flex items-center text-sm font-medium ${isZeroDisplay
                                ? 'text-gray-600 dark:text-gray-400'
                                : shouldShowAsPositive
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}
                            title={trendTooltip}
                            aria-label={trendTooltip}
                        >
                            {isZeroDisplay ? (
                                <ArrowRight className="w-4 h-4 mr-1" />
                            ) : isIncrease ? (
                                <ArrowUp className="w-4 h-4 mr-1" />
                            ) : (
                                <ArrowDown className="w-4 h-4 mr-1" />
                            )}
                            {isZeroDisplay ? '0.0' : (() => {
                                const formatted = Math.abs(change).toFixed(1);
                                const num = parseFloat(formatted);
                                return num >= 1000 ? num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatted;
                            })()}%
                        </div>
                    )}
                </div>
            </div>

            {/* Removed bottom granularity caption */}
        </div>
    );
};

export default MetricCard;
