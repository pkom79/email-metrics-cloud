"use client";
import React, { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import InfoTooltipIcon from "../InfoTooltipIcon";
import SelectBase from "../ui/SelectBase";
import { DataManager } from "../../lib/data/dataManager";
import { getConsentSplitMetrics, formatConsentMetricValue, ConsentSplitMetric } from "../../lib/analytics/consentSplitMetrics";

interface Props { dateRange: string; customFrom?: string; customTo?: string; referenceDate?: Date }

export default function SubscribedVsNotSubscribed({ dateRange, customFrom, customTo, referenceDate }: Props) {
    const dm = DataManager.getInstance();
    const [metric, setMetric] = useState<ConsentSplitMetric>("count");
    const [hovered, setHovered] = useState<{
        key: string;
        value: number;
        sampleSize: number;
        percentOfGroup?: number | null;
        idx: number;
    } | null>(null);

    const range = useMemo(() => {
        // Reuse DataManager logic to compute start/end dates analogous to other modules
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
            if (dateRange === 'all') {
                const subs = dm.getSubscribers();
                if (!subs.length) return null;
                const dates = subs.map(s => s.profileCreated.getTime());
                const min = Math.min(...dates), max = Math.max(...dates);
                return { start: new Date(min), end: new Date(max) };
            }
            const days = parseInt(String(dateRange).replace('d', '')) || 30;
            const anchor = referenceDate ? new Date(referenceDate) : dm.getLastEmailDate();
            const end = new Date(anchor); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            return { start, end };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, dm, referenceDate]);

    const filteredSubs = useMemo(() => {
        const all = dm.getSubscribers();
        if (!range) return all;
        // Filter by profileCreated inside range; this addresses large imports outside focus window
        return all.filter(s => s.profileCreated >= range.start && s.profileCreated <= range.end);
    }, [dm, range]);

    const anchor = useMemo(() => (referenceDate ? new Date(referenceDate) : (dm.getLastEmailDate() || new Date())), [dm, referenceDate]);
    const split = useMemo(() => getConsentSplitMetrics(filteredSubs, metric, anchor), [filteredSubs, metric, anchor]);

    const periodLabel = useMemo(() => {
        if (!range) return '';
        // Friendly label depending on dateRange
        if (dateRange.endsWith('d')) {
            const days = parseInt(dateRange.replace('d', '')) || 30;
            return `Created in the last ${days} days`;
        }
        const from = range.start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const to = range.end.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        return `Created between ${from} – ${to}`;
    }, [range, dateRange]);

    if (!filteredSubs.length) return null;

    // Prepare chart values
    const maxValue = Math.max(...split.groups.map(g => g.value), 0);
    const chartHeight = 150; const barH = 30; const spacing = 12; const startY = 40; const labelW = 130; const width = 800;

    return (
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <BarChart3 className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        Subscribed vs Not Subscribed
                        <InfoTooltipIcon placement="top" content={(
                            <div className="leading-snug">
                                <p className="font-semibold mb-1">What</p>
                                <p>Compare Subscribed vs Not Subscribed profiles by size, value, and engagement.</p>
                                <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                                    <li>Subscribed: gave explicit consent for email marketing.</li>
                                    <li>Not Subscribed: often from imports or integrations (e.g. Shopify). If not suppressed, they can still receive emails.</li>
                                </ul>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>Last engagement uses the most recent open or click. Profile creation follows the selected time range.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Shows whether Subscribed profiles drive more value than Not Subscribed.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="relative">
                    <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value as ConsentSplitMetric)} className="px-3 h-9 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                        <option value="count">Count</option>
                        <option value="buyers">Buyers</option>
                        <option value="nonBuyers">Non-Buyers</option>
                        <option value="repeatBuyers">Repeat Buyers</option>
                        <option value="ltvBuyers">LTV Buyers</option>
                        <option value="ltvAll">LTV All</option>
                        <option value="totalRevenue">Total Revenue</option>
                        <option value="engaged30">Engaged in Last 30 days</option>
                        <option value="engaged60">Engaged in Last 60 days</option>
                        <option value="engaged90">Engaged in Last 90 days</option>
                    </SelectBase>
                </div>
            </div>

            <div className="px-6 -mt-2 mb-2">
                {periodLabel && <p className="text-xs text-gray-600 dark:text-gray-400">{periodLabel}</p>}
            </div>

            <div className="px-6 pb-5">
                <div className="relative w-full">
                    <svg width="100%" height={chartHeight + 60} viewBox={`0 0 ${width} ${chartHeight + 60}`} onMouseLeave={() => setHovered(null)}>
                        <defs>
                            <linearGradient id="svns-bar" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.95} />
                                <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.75} />
                            </linearGradient>
                            <filter id="svns-shadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.1" />
                            </filter>
                        </defs>

                        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                            const x = labelW + ratio * (width - labelW - 40);
                            const val = maxValue * ratio;
                            return (
                                <g key={i}>
                                    <text x={x} y={chartHeight + 35} textAnchor="middle" className="text-xs fill-gray-500 tabular-nums">{formatConsentMetricValue(metric, val)}</text>
                                    {ratio > 0 && <line x1={x} y1={startY} x2={x} y2={chartHeight + 15} stroke="#f3f4f6" strokeWidth={1} strokeDasharray="2,2" />}
                                </g>
                            );
                        })}

                        {split.groups.map((g, idx) => {
                            const y = startY + idx * (barH + spacing);
                            const w = maxValue > 0 ? (g.value / maxValue) * (width - labelW - 60) : 0;
                            return (
                                <g key={g.key}>
                                    <rect
                                        x={labelW}
                                        y={y}
                                        width={Math.max(w, 2)}
                                        height={barH}
                                        fill="url(#svns-bar)"
                                        rx="4"
                                        ry="4"
                                        filter="url(#svns-shadow)"
                                        className="cursor-pointer transition-opacity hover:opacity-90"
                                        onMouseEnter={() => setHovered({ key: g.key, value: g.value, sampleSize: g.sampleSize, percentOfGroup: g.percentOfGroup ?? null, idx })}
                                    >
                                        <title>
                                            {`${g.key} • ${formatConsentMetricValue(metric, g.value)} • ${g.sampleSize.toLocaleString()} profiles${g.percentOfGroup != null ? ` • ${(g.percentOfGroup).toFixed(1)}% of group` : ''}`}
                                        </title>
                                    </rect>
                                    <text x={labelW - 10} y={y + barH / 2 + 4} textAnchor="end" className="text-sm font-medium fill-gray-700 dark:fill-gray-300">{g.key}</text>
                                </g>
                            );
                        })}

                        <line x1={labelW} y1={startY} x2={labelW} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                        <line x1={labelW} y1={chartHeight + 15} x2={width - 40} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                    </svg>

                    {hovered && (
                        (() => {
                            const barWidth = maxValue > 0 ? (hovered.value / maxValue) * (width - labelW - 60) : 0;
                            const leftPercent = ((labelW + (barWidth / 2)) / (width / 100));
                            const topPx = startY + (hovered.idx * (barH + spacing)) + (barH / 2) - 20;
                            return (
                                <div
                                    className="absolute z-20 p-3 rounded-lg shadow-xl border text-sm pointer-events-none backdrop-blur-sm bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 transform -translate-x-1/2 -translate-y-full"
                                    style={{ left: `${leftPercent}%`, top: `${topPx}px` }}
                                >
                                    <div className="font-semibold mb-1">{hovered.key}</div>
                                    <div className="font-medium text-purple-600 dark:text-purple-400">{formatConsentMetricValue(metric, hovered.value)}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {hovered.sampleSize.toLocaleString()} profiles{hovered.percentOfGroup != null ? ` • ${hovered.percentOfGroup.toFixed(1)}% of group` : ''}
                                    </div>
                                </div>
                            );
                        })()
                    )}
                </div>
            </div>
        </section>
    );
}
