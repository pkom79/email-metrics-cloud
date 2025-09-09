'use client';

import React, { useState } from 'react';
import SelectBase from "../ui/SelectBase";

// Lightweight, dependency-free chart placeholder to avoid external packages.
// Keeps the same props shape used by DashboardHeavy but renders a simple sparkline-like ASCII bar row.

// Local time series type (date string, current and optional previous values)
export type TimeSeriesData = { date: string; current?: number | null; previous?: number | null };

type MetricFormat = 'currency' | 'percent' | 'number';

const METRIC_OPTIONS = [
    { value: 'totalRevenue', label: 'Total Revenue', format: 'currency' },
    { value: 'averageOrderValue', label: 'Average Order Value', format: 'currency' },
    { value: 'totalOrders', label: 'Total Orders', format: 'number' },
    { value: 'conversionRate', label: 'Conversion Rate', format: 'percent' },
    { value: 'openRate', label: 'Open Rate', format: 'percent' },
    { value: 'clickRate', label: 'Click Rate', format: 'percent' },
    { value: 'clickToOpenRate', label: 'Click-to-Open Rate', format: 'percent' },
    { value: 'revenuePerEmail', label: 'Revenue per Email', format: 'currency' },
    { value: 'emailsSent', label: 'Emails Sent', format: 'number' },
    { value: 'unsubscribeRate', label: 'Unsubscribe Rate', format: 'percent' },
    { value: 'spamRate', label: 'Spam Rate', format: 'percent' },
    { value: 'bounceRate', label: 'Bounce Rate', format: 'percent' },
] as const;

interface DetailedMetricChartProps {
    data?: TimeSeriesData[];
    title?: string;
    description?: string;
    // New props for DashboardHeavy compatibility
    allSeriesData?: Record<string, TimeSeriesData[]>;
    granularity?: 'day' | 'week';
    color?: string;
}

const formatValue = (value: number, format: MetricFormat): string => {
    if (value === null || value === undefined || isNaN(value)) return '—';
    
    switch (format) {
        case 'currency':
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(value);
        case 'percent':
            return `${value.toFixed(1)}%`;
        case 'number':
            return new Intl.NumberFormat('en-US').format(Math.round(value));
        default:
            return value.toString();
    }
};

// Axis value formatting retained for future extension; currently used in labels.
const formatAxisValue = (value: number, format: MetricFormat): string => {
    if (value === null || value === undefined || isNaN(value)) return '';
    switch (format) {
        case 'currency':
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        case 'percent':
            return `${value.toFixed(0)}%`;
        case 'number':
            return new Intl.NumberFormat('en-US').format(Math.round(value));
        default:
            return String(value);
    }
};

export default function DetailedMetricChart({
    data,
    title,
    description,
    allSeriesData,
    granularity,
    color = '#8b5cf6',
}: DetailedMetricChartProps) {
    const [selectedMetric, setSelectedMetric] = useState<string>('totalRevenue');
    
    // Handle both interfaces
    const isLegacyInterface = !!data && !!title;
    const isNewInterface = !!allSeriesData;
    
    if (!isLegacyInterface && !isNewInterface) {
        return <div>No data provided</div>;
    }
    
    const selectedMetricInfo = METRIC_OPTIONS.find(m => m.value === selectedMetric);
    const format = selectedMetricInfo?.format || 'number';
    
    // Use appropriate data source
    const activeData = (isLegacyInterface ? data! : (allSeriesData![selectedMetric] || [])) as TimeSeriesData[];

    // Transform data with safe defaults
    const chartData = activeData.map(item => ({
        dateLabel: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        current: Number(item.current ?? 0) || 0,
        previous: Number(item.previous ?? 0) || 0,
    }));

    const values = chartData.map(d => d.current).filter(v => Number.isFinite(v));
    const maxValue = values.length ? Math.max(...values) : 0;

    // Simple inline legend/tooltip replacement
    const LegendRow = ({ label, value, prev }: { label: string; value: number; prev?: number }) => (
        <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{label}</span>
            <span className="tabular-nums text-gray-900 dark:text-gray-100">
                {formatValue(value, format)}{typeof prev === 'number' ? ` · prev ${formatValue(prev, format)}` : ''}
            </span>
        </div>
    );

    const renderNoData = () => (
        <div className="h-[400px] flex items-center justify-center">
            <div className="text-center">
                <div className="text-gray-400 text-lg mb-2">No data available</div>
                <div className="text-gray-500 text-sm">Try selecting a different metric or date range</div>
            </div>
        </div>
    );

    return (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            {/* Show title for legacy interface */}
            {isLegacyInterface && title && (
                <div className="mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                    {description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p>
                    )}
                </div>
            )}

            {/* Metric selector (native) for new interface */}
            {isNewInterface && (
                <div className="flex items-center justify-end mb-3">
                    <label className="sr-only" htmlFor="metric-select">Metric</label>
                    <SelectBase id="metric-select" value={selectedMetric} onChange={e => setSelectedMetric((e.target as HTMLSelectElement).value)} className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                        {METRIC_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </SelectBase>
                </div>
            )}

            {(!chartData || chartData.length === 0) ? renderNoData() : (
                <div>
                    {/* Simple bar row representation */}
                    <div className="space-y-1">
                        {chartData.slice(-24).map((d, i) => {
                            const max = maxValue || 1;
                            const pct = Math.max(0, Math.min(1, d.current / max));
                            return (
                                <div key={i} className="grid grid-cols-[80px,1fr,auto] items-center gap-2">
                                    <div className="text-[11px] text-gray-500">{d.dateLabel}</div>
                                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded">
                                        <div className="h-2 rounded" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
                                    </div>
                                    <div className="text-[11px] tabular-nums text-gray-700 dark:text-gray-200 min-w-[80px] text-right">
                                        {formatValue(d.current, format)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Summary */}
                    <div className="mt-3">
                        <LegendRow label="Latest" value={chartData[chartData.length - 1]?.current || 0} prev={chartData[chartData.length - 1]?.previous ?? undefined} />
                    </div>
                </div>
            )}
        </div>
    );
}


// Development-only post-eval probe: report the type of the exported default to the server
if (process.env.NODE_ENV === 'development') {
    try {
        const defaultType = typeof (DetailedMetricChart as any);
        try {
            void fetch('/api/debug-dashboard-shapes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ DetailedMetricChart_eval: { defaultType } })
            });
        } catch { /* ignore */ }
        // eslint-disable-next-line no-console
        console.log('DEV: DetailedMetricChart evaluated, defaultType=', defaultType);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('DEV: DetailedMetricChart eval probe failed', e);
    }
}

// Development-only named export so callers can statically import a primitive
// that reflects the module's evaluated default type. Helps debug bundler
// interop issues where the default may be wrapped in a namespace object.
// NOTE: safe to keep in development only.
export const __dev_default_type = typeof (DetailedMetricChart as any);
