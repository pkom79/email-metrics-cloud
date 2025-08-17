"use client";
import React, { useState, useMemo } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import { ProcessedCampaign } from '../../lib/data/dataTypes';
import { DataManager } from '../../lib/data/dataManager';

interface HourOfDayPerformanceProps {
    filteredCampaigns: ProcessedCampaign[];
    dateRange: string;
}

const HourOfDayPerformance: React.FC<HourOfDayPerformanceProps> = ({
    filteredCampaigns,
    dateRange
}) => {
    const [selectedMetric, setSelectedMetric] = useState('revenue');
    const [hoveredBar, setHoveredBar] = useState<{
        hourLabel: string;
        value: number;
        campaignCount: number;
        percentageOfTotal: number;
    } | null>(null);

    const dataManager = DataManager.getInstance();

    const metricOptions = [
        { value: 'revenue', label: 'Total Revenue' },
        { value: 'avgOrderValue', label: 'Average Order Value' },
        { value: 'revenuePerEmail', label: 'Revenue per Email' },
        { value: 'openRate', label: 'Open Rate' },
        { value: 'clickRate', label: 'Click Rate' },
        { value: 'clickToOpenRate', label: 'Click-to-Open Rate' },
        { value: 'emailsSent', label: 'Emails Sent' },
        { value: 'totalOrders', label: 'Total Orders' },
        { value: 'conversionRate', label: 'Conversion Rate' },
        { value: 'unsubscribeRate', label: 'Unsubscribe Rate' },
        { value: 'spamRate', label: 'Spam Rate' },
        { value: 'bounceRate', label: 'Bounce Rate' }
    ];

    const hourOfDayData = useMemo(() => {
        return dataManager.getCampaignPerformanceByHourOfDay(filteredCampaigns, selectedMetric);
    }, [filteredCampaigns, selectedMetric, dataManager]);

    const formatMetricValue = (value: number, metric: string): string => {
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) {
            return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        } else if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) {
            return value < 0.01 && value > 0
                ? `${value.toFixed(3)}%`
                : `${value.toFixed(2)}%`;
        } else {
            return value.toLocaleString('en-US');
        }
    };

    const maxValue = Math.max(...hourOfDayData.map(d => d.value), 0);
    const chartHeight = Math.max(200, hourOfDayData.length * 35 + 40);
    const barHeight = 25;
    const barSpacing = 10;
    const startY = 40;
    const labelWidth = 60;

    // Empty state card
    if (hourOfDayData.length === 0) {
        return (
            <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
                <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Clock className="w-5 h-5 text-purple-600" />
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            Campaign Performance by Hour of Day
                        </h3>
                    </div>
                    <div className="relative">
                        <select
                            value={selectedMetric}
                            onChange={(e) => setSelectedMetric(e.target.value)}
                            className="appearance-none px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                        >
                            {metricOptions.map(metric => (
                                <option key={metric.value} value={metric.value}>
                                    {metric.label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                    </div>
                </div>

                <div className="px-6 pb-6">
                    <div className="text-center py-12">
                        <Clock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <h4 className="text-base font-semibold mb-2 text-gray-600 dark:text-gray-300">
                            No campaigns sent in this period
                        </h4>
                        <p className="text-sm text-gray-400 dark:text-gray-500">
                            Try adjusting your date range to see hourly performance data
                        </p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-purple-600" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Campaign Performance by Hour of Day
                    </h3>
                </div>
                <div className="relative">
                    <select
                        value={selectedMetric}
                        onChange={(e) => setSelectedMetric(e.target.value)}
                        className="appearance-none px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    >
                        {metricOptions.map(metric => (
                            <option key={metric.value} value={metric.value}>
                                {metric.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                </div>
            </div>

            <div className="px-6 pb-4">
                <div className="relative w-full">
                    <svg
                        width="100%"
                        height={chartHeight + 60}
                        viewBox={`0 0 800 ${chartHeight + 60}`}
                        onMouseLeave={() => setHoveredBar(null)}
                    >
                        <defs>
                            <linearGradient id={`hourBarGradient-${selectedMetric}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                <stop offset="50%" stopColor="#a78bfa" stopOpacity={0.9} />
                                <stop offset="100%" stopColor="#c4b5fd" stopOpacity={0.7} />
                            </linearGradient>
                            <filter id="hourDropShadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.1" />
                            </filter>
                        </defs>

                        {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                            const x = labelWidth + (ratio * (800 - labelWidth - 40));
                            const value = maxValue * ratio;
                            return (
                                <g key={index}>
                                    <line x1={x} y1={chartHeight + 15} x2={x} y2={chartHeight + 20} stroke="#9ca3af" strokeWidth={1} />
                                    <text x={x} y={chartHeight + 35} textAnchor="middle" className="text-xs fill-gray-500">
                                        {formatMetricValue(value, selectedMetric)}
                                    </text>
                                    {ratio > 0 && (
                                        <line x1={x} y1={startY} x2={x} y2={chartHeight + 15} stroke="#f3f4f6" strokeWidth={1} strokeDasharray="2,2" />
                                    )}
                                </g>
                            );
                        })}

                        {hourOfDayData.map((data, index) => {
                            const y = startY + (index * (barHeight + barSpacing));
                            const barWidth = maxValue > 0 ? (data.value / maxValue) * (800 - labelWidth - 60) : 0;
                            const x = labelWidth;

                            return (
                                <g key={`${data.hour}-${data.hourLabel}`}>
                                    <rect
                                        x={x}
                                        y={y}
                                        width={Math.max(barWidth, 2)}
                                        height={barHeight}
                                        fill={`url(#hourBarGradient-${selectedMetric})`}
                                        className="cursor-pointer transition-all duration-200 hover:opacity-90"
                                        filter="url(#hourDropShadow)"
                                        rx="4"
                                        ry="4"
                                        onMouseEnter={() => setHoveredBar({
                                            hourLabel: data.hourLabel,
                                            value: data.value,
                                            campaignCount: data.campaignCount,
                                            percentageOfTotal: data.percentageOfTotal
                                        })}
                                    />

                                    <text x={labelWidth - 10} y={y + barHeight / 2 + 4} textAnchor="end" className="text-sm font-medium fill-gray-700">
                                        {data.hourLabel}
                                    </text>
                                </g>
                            );
                        })}

                        <line x1={labelWidth} y1={startY} x2={labelWidth} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                        <line x1={labelWidth} y1={chartHeight + 15} x2={800 - 40} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                    </svg>

                    {hoveredBar && (
                        <div
                            className="absolute z-10 p-3 rounded-lg shadow-xl border text-sm pointer-events-none backdrop-blur-sm bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 transform -translate-x-1/2 -translate-y-full"
                            style={{
                                left: `${(labelWidth + (hoveredBar.value / (maxValue || 1)) * (800 - labelWidth - 60) / 2) / 8}%`,
                                top: `${startY + (hourOfDayData.findIndex(d => d.hourLabel === hoveredBar.hourLabel) * (barHeight + barSpacing)) + barHeight / 2 - 20}px`
                            }}
                        >
                            <div className="font-semibold mb-1">{hoveredBar.hourLabel}</div>
                            <div className="font-medium mb-1" style={{ color: '#8b5cf6' }}>
                                {formatMetricValue(hoveredBar.value, selectedMetric)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {hoveredBar.campaignCount} campaign{hoveredBar.campaignCount !== 1 ? 's' : ''} sent
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {hoveredBar.percentageOfTotal.toFixed(1)}% of all campaigns
                            </div>
                        </div>
                    )}
                </div>

                {/* Summary stats (no separator to match DayOfWeek) */}
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm px-1 pb-4">
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Active Hours</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">{hourOfDayData.length}</p>
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Best Hour</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">{hourOfDayData.length > 0 ? hourOfDayData[0].hourLabel : 'N/A'}</p>
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Peak Value</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">{formatMetricValue(Math.max(...hourOfDayData.map(d => d.value), 0), selectedMetric)}</p>
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Total Campaigns</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">{hourOfDayData.reduce((sum, d) => sum + d.campaignCount, 0)}</p>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HourOfDayPerformance;
