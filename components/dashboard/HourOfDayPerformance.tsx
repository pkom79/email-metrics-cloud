"use client";
import React, { useState, useMemo } from 'react';
import { Clock } from 'lucide-react';
import SelectBase from "../ui/SelectBase";
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

    const rawHourData = useMemo(() => dataManager.getCampaignPerformanceByHourOfDay(filteredCampaigns, selectedMetric), [filteredCampaigns, selectedMetric, dataManager]);
    const negativeMetrics = useMemo(() => ['unsubscribeRate', 'spamRate', 'bounceRate'] as const, []);
    const minCampaignsRequired = useMemo(() => {
        const totalAll = DataManager.getInstance().getCampaigns().length;
        if (!totalAll) return 0;
        return Math.min(12, Math.max(3, Math.ceil(totalAll * 0.05)));
    }, []);
    const hourOfDayData = useMemo(() => {
        const arr = [...rawHourData];
        if (negativeMetrics.includes(selectedMetric as any)) arr.sort((a, b) => a.value - b.value); else arr.sort((a, b) => b.value - a.value);
        return arr;
    }, [rawHourData, selectedMetric, negativeMetrics]);

    // Match color scheme logic from DayOfWeekPerformance so colors stay consistent across charts
    const getColorScheme = (metric: string) => {
        // All bars use indigo color for campaign performance section
        return { primary: '#6366f1', secondary: '#6366f1', light: '#6366f1' };
    };
    const currentColorScheme = getColorScheme(selectedMetric);

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
                        <SelectBase
                            value={selectedMetric}
                            onChange={(e) => setSelectedMetric((e.target as HTMLSelectElement).value)}
                            className="px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                        >
                            {metricOptions.map(metric => (
                                <option key={metric.value} value={metric.value}>
                                    {metric.label}
                                </option>
                            ))}
                        </SelectBase>
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
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        Campaign Performance by Hour of Day
                        <span className="relative group inline-flex items-center">
                            <span className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-gray-200 text-gray-600 text-[10px] font-medium cursor-pointer group-hover:bg-gray-300">i</span>
                            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-6 z-30 hidden group-hover:block w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                                <span className="font-semibold block mb-1">What is this?</span>
                                Aggregates campaign performance by send hour (local time) across the selected range so you can spot hourly engagement or revenue concentration.
                                <br /><br /><span className="font-semibold">Best Hour logic:</span> Winner only if top hour ≥1.8 MAD above median AND has ≥ {minCampaignsRequired} campaigns (dynamic threshold = ceil(5% of all campaigns, capped at 12, floor 3). Current threshold: {minCampaignsRequired}). Otherwise we show &quot;No clear winner&quot; to avoid random spikes.
                            </span>
                        </span>
                    </h3>
                </div>
                <div className="relative">
                    <SelectBase
                        value={selectedMetric}
                        onChange={(e) => setSelectedMetric((e.target as HTMLSelectElement).value)}
                        className="px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
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
                        viewBox={`0 0 800 ${chartHeight + 60}`}
                        onMouseLeave={() => setHoveredBar(null)}
                    >
                        <defs>
                            <linearGradient id={`hourBarGradient-${selectedMetric}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor={currentColorScheme.primary} stopOpacity={0.9} />
                                <stop offset="50%" stopColor={currentColorScheme.secondary} stopOpacity={0.9} />
                                <stop offset="100%" stopColor={currentColorScheme.light} stopOpacity={0.7} />
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
                                        fill={currentColorScheme.primary}
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
                            className="absolute z-20 p-3 rounded-lg shadow-xl border text-sm pointer-events-none backdrop-blur-sm bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 transform -translate-x-1/2 -translate-y-full"
                            style={{
                                left: `${(labelWidth + (hoveredBar.value / (maxValue || 1)) * (800 - labelWidth - 60) / 2) / 8}%`,
                                top: `${startY + (hourOfDayData.findIndex(d => d.hourLabel === hoveredBar.hourLabel) * (barHeight + barSpacing)) + barHeight / 2 - 20}px`
                            }}
                        >
                            <div className="font-semibold mb-1">{hoveredBar.hourLabel}</div>
                            <div className="font-medium mb-1" style={{ color: currentColorScheme.primary }}>
                                {formatMetricValue(hoveredBar.value, selectedMetric)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {hoveredBar.campaignCount} campaign{hoveredBar.campaignCount !== 1 ? 's' : ''} sent
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {(() => {
                                    const formatted = hoveredBar.percentageOfTotal.toFixed(1);
                                    const num = parseFloat(formatted);
                                    return num >= 1000 ? num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatted;
                                })()}% of all campaigns
                            </div>
                        </div>
                    )}
                </div>

                {/* Summary stats (no separator to match DayOfWeek) */}
                <div className="mt-4 flex flex-wrap justify-center gap-6 text-xs pb-4">
                    {(() => {
                        const activeHours = hourOfDayData.length;
                        const totalCampaigns = filteredCampaigns.length;
                        const vals = hourOfDayData.map(d => d.value);
                        const n = vals.length; const median = (() => { const s = [...vals].sort((a, b) => a - b); return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; })();
                        const absDevs = vals.map(v => Math.abs(v - median));
                        const mad = (() => { const s = [...absDevs].sort((a, b) => a - b); return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; })();
                        const scale = mad * 1.4826 || 1e-6;
                        const best = hourOfDayData.reduce((m, d) => d.value > m.value ? d : m, hourOfDayData[0]);
                        const z = (best.value - median) / scale;
                        const significant = z >= 1.8 && best.campaignCount >= minCampaignsRequired; // dynamic threshold
                        const peakVal = Math.max(...vals, 0);
                        return (
                            <>
                                <div className="min-w-[110px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Active Hours</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100 tabular-nums">{activeHours}</p>
                                </div>
                                <div className="min-w-[140px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Best Hour (stat)</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100">{significant ? best.hourLabel : 'No clear winner'}</p>
                                </div>
                                <div className="min-w-[120px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Highest Value</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100">{formatMetricValue(peakVal, selectedMetric)}</p>
                                </div>
                                <div className="min-w-[130px] text-center">
                                    <p className="text-gray-500 dark:text-gray-400 mb-1">Total Campaigns</p>
                                    <p className="font-semibold text-xl text-gray-900 dark:text-gray-100 tabular-nums">{totalCampaigns}</p>
                                </div>
                            </>
                        );
                    })()}
                </div>
            </div>
        </section>
    );
};

export default HourOfDayPerformance;
