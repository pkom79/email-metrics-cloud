"use client";
import React, { useState } from 'react';
import { ArrowUp, ArrowDown, ArrowRight, Info } from 'lucide-react';
import Sparkline from './Sparkline';

interface BandData { low: number; high: number; median: number; bins: number; eligible: boolean }
interface MetricCardProps {
    title: string;
    value: string;
    change: number; // percent change for counts, pp diff for rates handled separately
    isPositive: boolean;
    dateRange: string;
    metricKey?: string;
    sparklineData?: { value: number; date: string }[];
    previousValue?: number;
    previousPeriod?: { startDate: Date; endDate: Date };
    compareMode?: 'prev-period' | 'prev-year';
    segment?: 'all' | 'campaigns' | 'flows';
    band?: BandData | null;
}

const RATE_KEYS = new Set(['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate']);
const rateBuffers: Record<string, number> = {
    openRate: 0.5, clickRate: 0.10, clickToOpenRate: 0.20, conversionRate: 0.20,
    unsubscribeRate: 0.05, spamRate: 0.02, bounceRate: 0.05
};
const definitions: Record<string, string> = {
    openRate: 'Percent of sent emails that were opened.',
    clickRate: 'Percent of sent emails that were clicked.',
    clickToOpenRate: 'Percent of openers who clicked.',
    conversionRate: 'Percent of clickers who placed an order.',
    revenue: 'Total attributed email revenue.',
    avgOrderValue: 'Average value of orders attributed to emails.',
    revenuePerEmail: 'Revenue divided by emails sent.',
    emailsSent: 'Total emails delivered.',
    totalOrders: 'Total attributed orders.',
    unsubscribeRate: 'Percent of sent emails that caused an unsubscribe.',
    spamRate: 'Percent of sent emails marked as spam.',
    bounceRate: 'Percent of sent emails that bounced.'
};

const MetricCard: React.FC<MetricCardProps> = ({
    title, value, change, isPositive, dateRange, metricKey, sparklineData = [], previousValue, previousPeriod, compareMode = 'prev-period', segment = 'all', band = null
}) => {
    const isAllTime = dateRange === 'all';
    const hasPrev = previousValue != null && previousPeriod != null;
    const showChange = !isAllTime && hasPrev;
    const numericCurrent = (() => { const c = value.replace(/[$,%]/g, ''); const n = parseFloat(c); return Number.isFinite(n) ? n : 0; })();
    const isRate = metricKey ? RATE_KEYS.has(metricKey) : false;
    const isIncrease = change > 0;

    const formatPrev = (v: number) => {
        if (metricKey === 'revenue' || metricKey === 'avgOrderValue' || metricKey === 'revenuePerEmail') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
        if (isRate) return `${v.toFixed(1)}%`;
        return Math.round(v).toLocaleString('en-US');
    };
    const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const label = compareMode === 'prev-year' ? 'Same period last year' : 'Previous period';
    const trendTooltip = hasPrev ? `${label} (${formatDate(previousPeriod!.startDate)} – ${formatDate(previousPeriod!.endDate)}): ${formatPrev(previousValue!)}
    `: `Change vs ${label.toLowerCase()}`;

    const classify = () => {
        if (!metricKey || !band || !band.eligible) return '–';
        let buffer = 0;
        if (isRate) buffer = rateBuffers[metricKey] || 0; else { const span = Math.max(0, band.high - band.low); buffer = Math.max(band.high * 0.05, span * 0.05); }
        if (numericCurrent > band.high + buffer) return 'Above';
        if (numericCurrent < band.low - buffer) return 'Below';
        return 'Within';
    };
    const bandStatus = classify();
    const negativeMetrics = ['unsubscribeRate', 'spamRate', 'bounceRate'];
    const deltaLine = hasPrev ? (isRate && !negativeMetrics.includes(metricKey || '') ? `${(numericCurrent - (previousValue || 0)).toFixed(1)} pp` : `${change >= 0 ? '+' : ''}${Math.abs(change).toFixed(1)}%`) : 'No prior period';

    const tooltip = metricKey && definitions[metricKey] ? [
        definitions[metricKey],
        band && band.eligible ? `Current value is ${bandStatus.toLowerCase()} the usual range.` : 'Current value has no comparison range.',
        band && band.eligible ? `Usual range: ${formatPrev(band.low)}–${formatPrev(band.high)}.` : ''
    ].filter(Boolean).join('\n') : '';

    return (
        <div className="relative group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:shadow-lg transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.03] hover:z-20">
            <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
                    {tooltip && (
                        <span className="relative">
                            <Info className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
                            <span className="invisible group-hover:visible absolute z-50 top-5 left-0 w-72 whitespace-pre-line text-xs bg-gray-900 text-white p-3 rounded-md shadow-lg border border-gray-700">{tooltip}</span>
                        </span>
                    )}
                </div>
                {band && band.eligible && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{bandStatus}</span>
                )}
            </div>
            <Sparkline
                isPositive={isPositive}
                change={change}
                isAllTime={isAllTime}
                data={sparklineData}
                valueFormat={metricKey && (metricKey === 'revenue' || metricKey === 'avgOrderValue' || metricKey === 'revenuePerEmail') ? 'currency' : (isRate ? 'percentage' : 'number')}
                hasInsufficientData={!hasPrev}
                forceZeroStyle={showChange && Math.abs(change) < 0.05}
                segment={segment}
                band={band}
                metricKey={metricKey}
            />
            <div className="flex items-end justify-between">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
                {showChange && (
                    <div className={`flex items-center text-sm font-medium ${Math.abs(change) < 0.05 ? 'text-gray-600 dark:text-gray-400' : isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} title={trendTooltip}>
                        {Math.abs(change) < 0.05 ? <ArrowRight className="w-4 h-4 mr-1" /> : isIncrease ? <ArrowUp className="w-4 h-4 mr-1" /> : <ArrowDown className="w-4 h-4 mr-1" />}
                        {isRate && !negativeMetrics.includes(metricKey || '') ? `${(numericCurrent - (previousValue || 0)).toFixed(1)}pp` : `${Math.abs(change).toFixed(1)}%`}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MetricCard;
