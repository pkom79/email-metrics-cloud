"use client";
import React, { useMemo } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

interface EngagementDecayCurveProps {
    campaigns: ProcessedCampaign[];
    flows: ProcessedFlowEmail[];
    dateRange: string;
}

/** Utility format */
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

/**
 * EngagementDecayCurve
 * Aggregates daily open & click rates (campaigns + flows) within the current filtered range
 * Shows: inline mini line chart + summary of decay from early-period baseline to latest-period.
 * Baseline = average of first N days (default 7 or half of total if shorter)
 * Recent   = average of last N days (same N)
 * Decay %  = (Recent - Baseline) / Baseline (negative implies decay)
 */
export default function EngagementDecayCurve({ campaigns, flows, dateRange }: EngagementDecayCurveProps) {
    const data = useMemo(() => {
        const all = [...campaigns, ...flows];
        if (!all.length) return [] as { day: string; ts: number; openRate: number; clickRate: number }[];
        const byDay: Record<string, { opens: number; clicks: number; sent: number; ts: number }> = {};
        for (const e of all) {
            const dayKey = e.sentDate.toISOString().slice(0, 10);
            const bucket = byDay[dayKey] || { opens: 0, clicks: 0, sent: 0, ts: new Date(dayKey + 'T00:00:00Z').getTime() };
            bucket.opens += e.uniqueOpens || 0;
            bucket.clicks += e.uniqueClicks || 0;
            bucket.sent += e.emailsSent || 0;
            byDay[dayKey] = bucket;
        }
        return Object.entries(byDay)
            .map(([day, v]) => ({ day, ts: v.ts, openRate: v.sent > 0 ? (v.opens / v.sent) * 100 : 0, clickRate: v.sent > 0 ? (v.clicks / v.sent) * 100 : 0 }))
            .sort((a, b) => a.ts - b.ts);
    }, [campaigns, flows]);

    const metrics = useMemo(() => {
        if (data.length < 5) return null;
        const windowSize = Math.min(7, Math.max(2, Math.floor(data.length / 2)));
        const early = data.slice(0, windowSize);
        const late = data.slice(-windowSize);
        const avg = (arr: typeof data, key: 'openRate' | 'clickRate') => arr.reduce((s, d) => s + d[key], 0) / arr.length;
        const earlyOpen = avg(early, 'openRate');
        const lateOpen = avg(late, 'openRate');
        const earlyClick = avg(early, 'clickRate');
        const lateClick = avg(late, 'clickRate');
        const openDeltaPct = earlyOpen > 0 ? ((lateOpen - earlyOpen) / earlyOpen) * 100 : 0;
        const clickDeltaPct = earlyClick > 0 ? ((lateClick - earlyClick) / earlyClick) * 100 : 0;
        return { windowSize, earlyOpen, lateOpen, earlyClick, lateClick, openDeltaPct, clickDeltaPct };
    }, [data]);

    if (!data.length) return null;

    // Build simple inline SVG line chart (shared x scale)
    const w = 340; const h = 70; const pad = 4;
    const maxVal = Math.max(...data.map(d => Math.max(d.openRate, d.clickRate)), 1);
    const minVal = 0; // always start at zero for clarity
    const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - minVal) / (maxVal - minVal)) * (h - pad * 2);
    const buildPath = (key: 'openRate' | 'clickRate') => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[key])}`).join(' ');

    const openPath = buildPath('openRate');
    const clickPath = buildPath('clickRate');

    return (
        <div className="mb-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Engagement Decay Curve</h3>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{dateRange}</span>
                </div>
                {data.length < 5 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Not enough daily data points yet to calculate decay.</p>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <svg width={w} height={h} className="flex-shrink-0">
                        <rect x={0} y={0} width={w} height={h} rx={6} className="fill-gray-50 dark:fill-gray-800" />
                        {/* Gridlines (4 horizontal) */}
                        {[0.25, 0.5, 0.75].map(g => (
                            <line key={g} x1={pad} x2={w - pad} y1={pad + (1 - g) * (h - pad * 2)} y2={pad + (1 - g) * (h - pad * 2)} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={0.5} />
                        ))}
                        {/* Open Rate Path */}
                        <path d={openPath} className="stroke-purple-600" fill="none" strokeWidth={2} strokeLinecap="round" />
                        {/* Click Rate Path */}
                        <path d={clickPath} className="stroke-indigo-500" fill="none" strokeWidth={2} strokeLinecap="round" />
                        {/* End dots */}
                        {data.length > 1 && (
                            <>
                                <circle cx={x(0)} cy={y(data[0].openRate)} r={3} className="fill-purple-600" />
                                <circle cx={x(0)} cy={y(data[0].clickRate)} r={3} className="fill-indigo-500" />
                                <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].openRate)} r={3} className="fill-purple-600" />
                                <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].clickRate)} r={3} className="fill-indigo-500" />
                            </>
                        )}
                    </svg>
                    {metrics && (
                        <div className="flex-1 grid grid-cols-2 gap-3 text-xs">
                            <div>
                                <p className="text-gray-500 dark:text-gray-400 mb-0.5">Open Rate Baseline</p>
                                <p className="font-medium text-gray-900 dark:text-gray-100">{fmtPct(metrics.earlyOpen)}</p>
                                <p className="text-gray-500 dark:text-gray-400 mt-2 mb-0.5">Latest Avg</p>
                                <p className="font-medium text-gray-900 dark:text-gray-100">{fmtPct(metrics.lateOpen)}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-gray-400 mb-0.5">Click Rate Baseline</p>
                                <p className="font-medium text-gray-900 dark:text-gray-100">{fmtPct(metrics.earlyClick)}</p>
                                <p className="text-gray-500 dark:text-gray-400 mt-2 mb-0.5">Latest Avg</p>
                                <p className="font-medium text-gray-900 dark:text-gray-100">{fmtPct(metrics.lateClick)}</p>
                            </div>
                            <div className="col-span-2 mt-2 flex items-center gap-4">
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="inline-block w-2 h-2 rounded-full bg-purple-600" />
                                    <span className="text-gray-600 dark:text-gray-300">Open Δ {metrics.openDeltaPct.toFixed(1)}%</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                                    <span className="text-gray-600 dark:text-gray-300">Click Δ {metrics.clickDeltaPct.toFixed(1)}%</span>
                                </div>
                                <div className="text-[10px] text-gray-500 dark:text-gray-400 ml-auto">N={metrics.windowSize}d windows</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
