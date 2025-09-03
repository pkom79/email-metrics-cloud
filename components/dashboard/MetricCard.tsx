"use client";
import React, { useMemo } from 'react';
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import Sparkline from './Sparkline';
import { useBenchmark } from '../../lib/data/benchmarking';
import { DataManager } from '../../lib/data/dataManager';

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
    // Parse numeric from formatted value (currency / percent / number)
    const numericFromFormatted = (formatted: string): number => {
        const cleaned = formatted.replace(/[$,%\s]/g, '');
        const n = parseFloat(cleaned);
        return isNaN(n) ? 0 : n;
    };
    const numericValue = metricKey ? numericFromFormatted(value) : undefined;

    // Adaptive benchmark (dynamic per-account) – anchor on last email date (end of active dataset)
    const dm = DataManager.getInstance();
    const anchor = dm.getLastEmailDate();
    const adaptiveBenchmark = useBenchmark(metricKey, anchor, anchor);
    const showAdaptive = metricKey != null && adaptiveBenchmark != null;

    const adaptiveBadge = useMemo(() => {
        if (!showAdaptive) return null;
        const b = adaptiveBenchmark;
        if (!b) return null;
        // Hidden reason – show subtle badge explaining why
        if (!b.tier) {
            return (
                <span className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-gray-50 text-gray-600 border-gray-200">
                    Benchmarking
                    <span className="pointer-events-none absolute mt-6 left-1/2 -translate-x-1/2 z-30 hidden group-hover:block w-64 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                        Adaptive benchmark not shown: {b.hiddenReason || 'insufficient history'}. Weeks: {b.sampleWeeks}. Need ≥8 for provisional, ≥12 for initial, ≥20 for stable.
                    </span>
                </span>
            );
        }
        const tierColors: Record<string, { dot: string; wrapper: string }> = {
            'Needs Review': { dot: 'bg-rose-500', wrapper: 'bg-rose-50 text-rose-700 border-rose-200' },
            'Below Average': { dot: 'bg-amber-500', wrapper: 'bg-amber-50 text-amber-700 border-amber-200' },
            'Typical': { dot: 'bg-gray-400', wrapper: 'bg-gray-50 text-gray-700 border-gray-200' },
            'Above Average': { dot: 'bg-emerald-500', wrapper: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            'Exceptional': { dot: 'bg-purple-500', wrapper: 'bg-purple-50 text-purple-700 border-purple-200' },
        };
        const c = tierColors[b.tier] || tierColors['Typical'];
        const pct = b.percentDelta != null ? b.percentDelta : null;
        return (
            <span className={`group relative inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full text-[10px] font-medium border ${c.wrapper}`}>
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                {b.tier}{b.provisional && <span className="ml-1 uppercase tracking-wide text-[9px]">(Prov.)</span>}
                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-6 z-30 hidden group-hover:block w-72 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                    <span className="font-semibold block mb-1">Adaptive Benchmark</span>
                    Baseline (trimmed mean): {b.baseline != null ? b.baseline.toFixed(2) : '—'}<br />
                    Current: {b.current != null ? b.current.toFixed(2) : '—'}<br />
                    {pct != null && <>Delta: {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%<br /></>}
                    Weeks Used: {b.sampleWeeks}{b.provisional ? ' (provisional)' : b.insufficient ? ' (limited)' : ''}.<br />
                    Interpretation: {b.tier} relative to your historical performance.
                </span>
            </span>
        );
    }, [showAdaptive, adaptiveBenchmark]);

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
                    {/* Adaptive benchmark badge (replaces legacy static tiers) */}
                    <div className="mt-1 h-5 flex items-center relative">{adaptiveBadge}</div>
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
