"use client";
import React from 'react';
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import TooltipPortal from '../TooltipPortal';
import Sparkline from './Sparkline';

interface MetricCardProps {
    title: string;
    value: string;
    change: number;
    isPositive: boolean;
    dateRange: string;
    isNegativeMetric?: boolean;
    metricKey?: string;
    sparklineData?: { value: number; date: string }[];
    hideSparkline?: boolean;
    variant?: 'default' | 'stat';
    // Kept for compatibility but not rendered anymore
    granularity?: 'daily' | 'weekly' | 'monthly';
    // Previous period tooltip data
    previousValue?: number;
    previousPeriod?: { startDate: Date; endDate: Date };
    compareMode?: 'prev-period' | 'prev-year';
    category?: 'email' | 'campaign' | 'flow';
    chartType?: 'line' | 'bar';
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
    hideSparkline = false,
    variant = 'default',
    previousValue,
    previousPeriod,
    compareMode = 'prev-period',
    category,
    chartType = 'line'
}) => {
    const isAllTime = dateRange === 'all';
    const DISPLAY_EPS = 0.05; // <0.05% rounds to 0.0%

    const shouldShowAsPositive = isPositive;
    const hasInsufficientData = previousValue == null || previousPeriod == null;
    const tinyChange = Math.abs(change) < DISPLAY_EPS; // will display as 0.0%
    const isZeroDisplay = tinyChange || Math.abs(change) < 1e-9;
    const showChangeBlock = !isAllTime && !hasInsufficientData;
    const isIncrease = change > 0;

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
    const trendTooltipNode = previousPeriod && previousValue != null ? (
        <div className="text-gray-900 dark:text-gray-100">
            <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{formatDate(previousPeriod.startDate)} – {formatDate(previousPeriod.endDate)}</div>
            <div className="text-sm font-semibold tabular-nums mt-0.5">{formatPrevValue(previousValue)}</div>
        </div>
    ) : null;

    return (
        <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:shadow-lg transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.03] hover:z-20 will-change-transform origin-center`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex-1">
                    <p className={variant === 'stat'
                        ? `text-sm font-medium text-gray-500 dark:text-gray-400 mb-2`
                        : `text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400`}>
                        {title}
                    </p>
                </div>
            </div>

            {!hideSparkline && variant !== 'stat' && (
                                <Sparkline
                    isPositive={shouldShowAsPositive}
                    change={change}
                    isAllTime={isAllTime}
                    isNegativeMetric={isNegativeMetric}
                    data={sparklineData}
                    valueFormat={valueFormat}
                    hasInsufficientData={hasInsufficientData}
                    forceZeroStyle={showChangeBlock ? isZeroDisplay : true}
                    category={category}
                    chartType={chartType}
                />
            )}

            <div className="flex items-end justify-between">
                <p className={variant === 'stat'
                    ? `text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-none`
                    : `text-2xl font-bold text-gray-900 dark:text-white`}>
                    {value}
                </p>
                <div className="flex items-center gap-2">
                    {showChangeBlock && trendTooltipNode ? (
                        <TooltipPortal content={trendTooltipNode}>
                            <div
                                className={`flex items-center text-sm font-medium ${isZeroDisplay
                                    ? 'text-gray-600 dark:text-gray-400'
                                    : shouldShowAsPositive
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-red-600 dark:text-red-400'
                                    }`}
                                role="button"
                                tabIndex={0}
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
                        </TooltipPortal>
                    ) : showChangeBlock ? (
                        <div className={`flex items-center text-sm font-medium ${isZeroDisplay ? 'text-gray-600 dark:text-gray-400' : shouldShowAsPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {isZeroDisplay ? (<ArrowRight className="w-4 h-4 mr-1" />) : isIncrease ? (<ArrowUp className="w-4 h-4 mr-1" />) : (<ArrowDown className="w-4 h-4 mr-1" />)}
                            {isZeroDisplay ? '0.0' : (() => { const formatted = Math.abs(change).toFixed(1); const num = parseFloat(formatted); return num >= 1000 ? num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatted; })()}%
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Removed bottom granularity caption */}
        </div>
    );
};

export default MetricCard;
