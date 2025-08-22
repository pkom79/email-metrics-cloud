"use client";
import React, { useState, useMemo } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
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

    const dayOfWeekData = useMemo(() => {
        return dataManager.getCampaignPerformanceByDayOfWeek(filteredCampaigns, selectedMetric);
    }, [filteredCampaigns, selectedMetric, dataManager]);

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
        const colorSchemes = {
            revenue: { primary: '#8b5cf6', secondary: '#a78bfa', light: '#c4b5fd' },
            avgOrderValue: { primary: '#06b6d4', secondary: '#67e8f9', light: '#a7f3d0' },
            revenuePerEmail: { primary: '#10b981', secondary: '#34d399', light: '#6ee7b7' },
            openRate: { primary: '#f59e0b', secondary: '#fbbf24', light: '#fde047' },
            clickRate: { primary: '#ef4444', secondary: '#f87171', light: '#fca5a5' },
            clickToOpenRate: { primary: '#8b5cf6', secondary: '#a78bfa', light: '#c4b5fd' },
            emailsSent: { primary: '#3b82f6', secondary: '#60a5fa', light: '#93c5fd' },
            totalOrders: { primary: '#10b981', secondary: '#34d399', light: '#6ee7b7' },
            conversionRate: { primary: '#f97316', secondary: '#fb923c', light: '#fdba74' },
            unsubscribeRate: { primary: '#ef4444', secondary: '#f87171', light: '#fca5a5' },
            spamRate: { primary: '#dc2626', secondary: '#ef4444', light: '#f87171' },
            bounceRate: { primary: '#991b1b', secondary: '#dc2626', light: '#ef4444' }
        } as const;

        return (colorSchemes as any)[metric] || colorSchemes.revenue;
    };

    const currentColorScheme = getColorScheme(selectedMetric);

    return (
        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-purple-600" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Day of Week</h3>
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
                                        fill={data.campaignCount === 0 ? '#e5e7eb' : `url(#barGradient-${selectedMetric})`}
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
                            className="absolute z-10 p-3 rounded-lg shadow-xl border text-sm pointer-events-none backdrop-blur-sm bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 transform -translate-x-1/2 -translate-y-full"
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

                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm px-1 pb-4">
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Total Campaigns</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">
                            {dayOfWeekData.reduce((sum, d) => sum + d.campaignCount, 0)}
                        </p>
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Best Day</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">
                            {(() => {
                                if (dayOfWeekData.length === 0) return 'N/A';
                                const best = dayOfWeekData.reduce((max, d) => (d.value > max.value ? d : max), dayOfWeekData[0]);
                                return best.value > 0 ? best.day : 'N/A';
                            })()}
                        </p>
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Peak Value</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">
                            {formatMetricValue(maxValue, selectedMetric)}
                        </p>
                    </div>
                    <div>
                        <p className="text-gray-500 dark:text-gray-400">Date Range</p>
                        <p className="font-bold text-lg text-gray-900 dark:text-gray-100">
                            {dateRange === 'all' ? 'All Time' : dateRange}
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default DayOfWeekPerformance;
