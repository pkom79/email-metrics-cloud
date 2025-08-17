"use client";
import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import Sparkline from './Sparkline';
import { getBenchmarkStatus, parseMetricValue } from '../../lib/utils/benchmarks';

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
    previousPeriod
}) => {
    const isAllTime = dateRange === 'all';

    // GOODNESS color (green/red): already computed by DataManager including negative metrics logic
    const shouldShowAsPositive = isPositive;

    // DIRECTION arrow: based purely on change sign (increase vs decrease)
    const isIncrease = change > 0;

    const benchmarkResult = metricKey ? getBenchmarkStatus(metricKey, parseMetricValue(value)) : null;
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
                return `${v.toFixed(1)}%`;
            default:
                return Math.round(v).toLocaleString('en-US');
        }
    };
    const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const trendTooltip = previousPeriod && previousValue != null
        ? `Previous period (${formatDate(previousPeriod.startDate)} – ${formatDate(previousPeriod.endDate)}): ${formatPrevValue(previousValue)}`
        : 'Change vs previous period';

    return (
        <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:shadow-lg transition-all duration-200 hover:-translate-y-1`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex-1">
                    <p className={`text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400`}>
                        {title}
                    </p>
                    {/* Reserve fixed height so sparkline rows align whether benchmark exists or not */}
                    <div className="mt-1 h-5 flex items-center">
                        {benchmarkResult && (
                            <div className="flex items-center gap-1">
                                <div
                                    className={`w-2 h-2 rounded-full ${benchmarkResult.status === 'good' ? 'bg-green-500' :
                                        benchmarkResult.status === 'ok' ? 'bg-blue-500' :
                                            benchmarkResult.status === 'attention' ? 'bg-yellow-500' :
                                                'bg-red-500'
                                        }`}
                                />
                                <span className={`text-xs font-medium ${benchmarkResult.color}`}>
                                    {benchmarkResult.label}
                                </span>
                            </div>
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
                    {!isAllTime && (
                        <div
                            className={`flex items-center text-sm font-medium ${shouldShowAsPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                            title={trendTooltip}
                            aria-label={trendTooltip}
                        >
                            {isIncrease ? (
                                <ArrowUp className="w-4 h-4 mr-1" />
                            ) : (
                                <ArrowDown className="w-4 h-4 mr-1" />
                            )}
                            {Math.abs(change).toFixed(1)}%
                        </div>
                    )}
                </div>
            </div>

            {/* Removed bottom granularity caption */}
        </div>
    );
};

export default MetricCard;
