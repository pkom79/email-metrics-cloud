"use client";
import React, { useMemo, useState } from 'react';
import { Info, TrendingUp, TrendingDown } from 'lucide-react';
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
    const [showHelp, setShowHelp] = useState(false);
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
            <div className="relative rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Engagement Decay Curve</h3>
                        <button
                            onClick={() => setShowHelp(s => !s)}
                            aria-label="Explain engagement decay"
                            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                        >
                            <Info className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-100 dark:border-purple-800">{dateRange.toUpperCase()}</span>
                </div>
                {showHelp && (
                    <div className="absolute z-10 top-10 left-4 max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-[11px] leading-relaxed shadow-lg">
                        <p className="text-gray-700 dark:text-gray-200 mb-1"><span className="font-semibold">How to read:</span> We group all emails by day and compute daily open & click rates.</p>
                        <ul className="list-disc pl-4 space-y-0.5 text-gray-600 dark:text-gray-300">
                            <li><span className="text-purple-600 font-medium">Baseline</span> = avg of first N days.</li>
                            <li><span className="text-indigo-500 font-medium">Latest</span> = avg of last N days.</li>
                            <li>Δ shows relative change vs baseline (green = improvement).</li>
                        </ul>
                        <p className="mt-1 text-gray-500 dark:text-gray-400">N scales with available data (≤7 days window).</p>
                    </div>
                )}
                {data.length < 5 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Not enough daily data points yet to calculate decay.</p>
                )}
                <div className="flex flex-col lg:flex-row lg:items-center gap-5">
                    <div className="flex flex-col gap-2">
                        <svg width={w} height={h} className="flex-shrink-0">
                            <rect x={0} y={0} width={w} height={h} rx={6} className="fill-gray-50 dark:fill-gray-800" />
                            {[0.25, 0.5, 0.75].map(g => (
                                <line key={g} x1={pad} x2={w - pad} y1={pad + (1 - g) * (h - pad * 2)} y2={pad + (1 - g) * (h - pad * 2)} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={0.5} />
                            ))}
                            <path d={openPath} className="stroke-purple-600" fill="none" strokeWidth={2.2} strokeLinecap="round" />
                            <path d={clickPath} className="stroke-indigo-500" fill="none" strokeWidth={2.2} strokeLinecap="round" />
                            {data.length > 1 && (
                                <>
                                    <circle cx={x(0)} cy={y(data[0].openRate)} r={3} className="fill-purple-600" />
                                    <circle cx={x(0)} cy={y(data[0].clickRate)} r={3} className="fill-indigo-500" />
                                    <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].openRate)} r={3} className="fill-purple-600" />
                                    <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].clickRate)} r={3} className="fill-indigo-500" />
                                </>
                            )}
                        </svg>
                        <div className="flex items-center gap-4 pl-1">
                            <div className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300"><span className="inline-block w-2 h-2 rounded-full bg-purple-600" />Open Rate</div>
                            <div className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300"><span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />Click Rate</div>
                        </div>
                    </div>
                    {metrics && (
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                            {/* Open Baseline */}
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40">
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Open Baseline</p>
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.earlyOpen)}</p>
                            </div>
                            {/* Open Latest & Delta */}
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40">
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Open Latest</p>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.lateOpen)}</p>
                                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${metrics.openDeltaPct >= 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                                        {metrics.openDeltaPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                        {metrics.openDeltaPct.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                            {/* Click Baseline */}
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40">
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Click Baseline</p>
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.earlyClick)}</p>
                            </div>
                            {/* Click Latest & Delta */}
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40">
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Click Latest</p>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.lateClick)}</p>
                                    {(() => {
                                        // Guard against tiny baselines making delta misleading
                                        const displayDelta = metrics.earlyClick < 0.1 ? null : metrics.clickDeltaPct;
                                        return displayDelta === null ? (
                                            <span className="text-[10px] text-gray-400">n/a</span>
                                        ) : (
                                            <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${displayDelta >= 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                                                {displayDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                                {displayDelta.toFixed(1)}%
                                            </span>
                                        );
                                    })()}
                                </div>
                            </div>
                            <div className="col-span-full flex items-center justify-between pt-1">
                                <span className="text-[10px] text-gray-500 dark:text-gray-400">Baseline vs latest averages | Window N={metrics.windowSize} days</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">Higher is better</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
