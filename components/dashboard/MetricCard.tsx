"use client";
import React from 'react';
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
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
    // Kept for compatibility but not rendered anymore
    granularity?: 'daily' | 'weekly' | 'monthly';
    // Previous period tooltip data
    previousValue?: number;
    previousPeriod?: { startDate: Date; endDate: Date };
    compareMode?: 'prev-period' | 'prev-year';
    category?: 'email' | 'campaign' | 'flow';
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
    category
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
                category={category}
            />

            <div className="flex items-end justify-between">
                <p className={`text-2xl font-bold text-gray-900 dark:text-white`}>
                    {value}
                </p>
                <div className="flex items-center gap-2">
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
