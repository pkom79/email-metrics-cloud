"use client";
import React, { useState, useMemo } from 'react';
import { CalendarFold } from 'lucide-react';
import InfoTooltipIcon from "../InfoTooltipIcon";
import SelectBase from "../ui/SelectBase";
import { ProcessedCampaign } from '../../lib/data/dataTypes';
import { DataManager } from '../../lib/data/dataManager';

interface DayOfWeekPerformanceProps {
    filteredCampaigns: ProcessedCampaign[];
    dateRange: string;
}

const DayOfWeekPerformance: React.FC<DayOfWeekPerformanceProps> = ({
    filteredCampaigns,
    dateRange
}) => {
    const [selectedMetric, setSelectedMetric] = useState('revenue');
    const [hoveredBar, setHoveredBar] = useState<{ day: string; value: number; campaignCount: number } | null>(null);

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

    const rawDayOfWeekData = useMemo(() => dataManager.getCampaignPerformanceByDayOfWeek(filteredCampaigns, selectedMetric), [filteredCampaigns, selectedMetric, dataManager]);

    // Determine dynamic minimum campaigns: 5% of total campaigns (rounded up) capped at 10, floor 3
    const minCampaignsRequired = useMemo(() => {
        // Use total campaigns across full dataset (not just filtered range) for threshold scaling
        const totalAll = DataManager.getInstance().getCampaigns().length;
        if (!totalAll) return 0;
        return Math.min(10, Math.max(3, Math.ceil(totalAll * 0.05))); // cap 10, floor 3
    }, []);

    // Sort so that for negative metrics (unsubscribe/spam/bounce rate) lowest is on top for fast scanning
    const negativeMetrics = useMemo(() => ['unsubscribeRate', 'spamRate', 'bounceRate'] as const, []);
    const dayOfWeekData = useMemo(() => {
        const arr = [...rawDayOfWeekData];
        if (negativeMetrics.includes(selectedMetric as any)) arr.sort((a, b) => a.value - b.value); else arr.sort((a, b) => b.value - a.value);
        return arr;
    }, [rawDayOfWeekData, selectedMetric, negativeMetrics]);

    const formatMetricValue = (value: number, metric: string): string => {
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) {
            return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        } else if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) {
            const formatted = value < 0.01 && value > 0 ? value.toFixed(3) : value.toFixed(2);
            const num = parseFloat(formatted);
            return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: value < 0.01 && value > 0 ? 3 : 2, maximumFractionDigits: value < 0.01 && value > 0 ? 3 : 2 })}%` : `${formatted}%`;
        } else {
            return value.toLocaleString('en-US');
        }
    };

    const maxValue = Math.max(...dayOfWeekData.map(d => d.value), 0);
    const chartHeight = 320;
    const barHeight = 30;
    const barSpacing = 10;
    const startY = 40;
    const labelWidth = 50;

    const getColorScheme = (metric: string) => {
        // All bars use indigo color for campaign performance section
        return { primary: '#6366f1', secondary: '#6366f1', light: '#6366f1' };
    };

    const currentColorScheme = getColorScheme(selectedMetric);

    return (
        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <CalendarFold className="w-5 h-5 text-purple-600" />
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Campaign Performance by Day of Week
                        <InfoTooltipIcon placement="top" content={(
                            <div className="leading-snug">
                                <p className="font-semibold mb-1">What</p>
                                <p>Compare results by weekday.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>We group campaigns by the day they were sent and show the metric you chose.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Send more on the days that consistently win. If there is no clear pattern, test a couple of days.</p>
                                <p className="mt-2 text-gray-500 dark:text-gray-400">Note: If your account uses send time per recipient in Klaviyo, results may be skewed and might not match Klaviyo. Sometimes we don’t have a clear winner because the best day doesn’t have enough campaigns, or the difference from normal activity isn’t big enough. Short ranges, uneven sending, or mixed audiences can also blur the signal.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="relative min-w-0 w-full sm:w-auto">
                    <SelectBase
                        value={selectedMetric}
                        onChange={(e) => setSelectedMetric((e.target as HTMLSelectElement).value)}
                        className="w-full sm:w-auto px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    >
                        {metricOptions.map(metric => (
                            <option key={metric.value} value={metric.value}>
                                {metric.label}
                            </option>
                        ))}
                    </SelectBase>
                </div>
            </div>

            <div className="px-6 pb-4">
                <div className="relative w-full">
                    <svg
                        width="100%"
                        height={chartHeight + 60}
                        stopColor={currentColorScheme.primary}
                        viewBox={`0 0 800 ${chartHeight + 60}`}
                        onMouseLeave={() => setHoveredBar(null)}
                    >
                        <defs>
                            <linearGradient id={`barGradient-${selectedMetric}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor={currentColorScheme.primary} stopOpacity={0.9} />
                                <stop offset="50%" stopColor={currentColorScheme.secondary} stopOpacity={0.9} />
                                <stop offset="100%" stopColor={currentColorScheme.light} stopOpacity={0.7} />
                            </linearGradient>
                            <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.1" />
                            </filter>
                        </defs>

                        {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                            const x = labelWidth + (ratio * (800 - labelWidth - 40));
                            const value = maxValue * ratio;
                            return (
                                <g key={index}>
                                    {/* Removed x-axis notch lines; keep labels */}
                                    <text x={x} y={chartHeight + 35} textAnchor="middle" className="text-xs fill-gray-500">
                                        {formatMetricValue(value, selectedMetric)}
                                    </text>
                                    {ratio > 0 && (
                                        <line x1={x} y1={startY} x2={x} y2={chartHeight + 15} stroke="#f3f4f6" strokeWidth={1} strokeDasharray="2,2" />
                                    )}
                                </g>
                            );
                        })}

                        {dayOfWeekData.map((data, index) => {
                            const y = startY + (index * (barHeight + barSpacing));
                            const barWidth = maxValue > 0 ? (data.value / maxValue) * (800 - labelWidth - 60) : 0;
                            const x = labelWidth;

                            return (
                                <g key={data.day}>
                                    <rect
                                        x={x}
                                        y={y}
                                        width={Math.max(barWidth, 2)}
                                        height={barHeight}
                                        fill={data.campaignCount === 0 ? '#e5e7eb' : currentColorScheme.primary}
                                        className="cursor-pointer transition-all duration-200 hover:opacity-90"
                                        filter={data.campaignCount > 0 ? 'url(#dropShadow)' : 'none'}
                                        rx="4"
                                        ry="4"
                                        onMouseEnter={() => setHoveredBar({ day: data.day, value: data.value, campaignCount: data.campaignCount })}
                                    />

                                    <text x={labelWidth - 10} y={y + barHeight / 2 + 4} textAnchor="end" className="text-sm font-medium fill-gray-700">
                                        {data.day}
                                    </text>
                                </g>
                            );
                        })}

                        <line x1={labelWidth} y1={startY} x2={labelWidth} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                        <line x1={labelWidth} y1={chartHeight + 15} x2={800 - 40} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                    </svg>

                    {hoveredBar && (
                        <div
                            className="absolute z-20 p-3 rounded-lg shadow-xl border text-sm pointer-events-none backdrop-blur-sm bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 transform -translate-x-1/2 -translate-y-full"
                            style={{
                                left: `${(labelWidth + (hoveredBar.value / (maxValue || 1)) * (800 - labelWidth - 60) / 2) / 8}%`,
                                top: `${startY + (dayOfWeekData.findIndex(d => d.day === hoveredBar.day) * (barHeight + barSpacing)) + barHeight / 2 - 20}px`
                            }}
                        >
                            <div className="font-semibold mb-1">{hoveredBar.day}</div>
                            <div className="font-medium" style={{ color: currentColorScheme.primary }}>
                                {formatMetricValue(hoveredBar.value, selectedMetric)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {hoveredBar.campaignCount === 0 ? 'No campaigns sent' : `${hoveredBar.campaignCount} campaign${hoveredBar.campaignCount !== 1 ? 's' : ''} sent`}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-6 text-xs pb-4">
                    {(() => {
                        const totalCampaigns = filteredCampaigns.length;
                        const vals = dayOfWeekData.map(d => d.value);
                        const n = vals.length;
                        const median = (() => { const s = [...vals].sort((a, b) => a - b); return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; })();
                        const absDevs = vals.map(v => Math.abs(v - median));
                        const mad = (() => { const s = [...absDevs].sort((a, b) => a - b); return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; })();
                        const scale = mad * 1.4826 || 1e-6; // approx std
                        const isNegative = negativeMetrics.includes(selectedMetric as any);
                        const best = isNegative
                            ? dayOfWeekData.reduce((min, d) => d.value < min.value ? d : min, dayOfWeekData[0])
                            : dayOfWeekData.reduce((max, d) => d.value > max.value ? d : max, dayOfWeekData[0]);
                        const z = ((isNegative ? (median - best.value) : (best.value - median)) / scale);
                        const significant = z >= 1.5 && best.campaignCount >= minCampaignsRequired; // dynamic threshold
                        return (
                            <>
                                <div className="min-w-[120px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Total Campaigns</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100 tabular-nums">{totalCampaigns}</p>
                                </div>
                                <div className="min-w-[140px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Best Day</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100">{significant ? best.day : 'No clear winner'}</p>
                                </div>
                                <div className="min-w-[120px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Best Value</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100">{formatMetricValue(best.value, selectedMetric)}</p>
                                </div>
                            </>
                        );
                    })()}
                </div>
            </div>
        </section>
    );
};

export default DayOfWeekPerformance;
