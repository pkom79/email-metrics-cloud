"use client";
import React, { useMemo, useState } from 'react';
import { Info, TrendingUp, TrendingDown } from 'lucide-react';
import type { ProcessedCampaign } from '../../lib/data/dataTypes';

interface EngagementDecayCurveProps {
    campaigns: ProcessedCampaign[];
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
export default function EngagementDecayCurve({ campaigns, dateRange }: EngagementDecayCurveProps) {
    const [showHelp, setShowHelp] = useState(false);
    const data = useMemo(() => {
        const all = campaigns;
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
    }, [campaigns]);

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

    // Derived stats for smoothing and benchmark
    const openValues = data.map(d => d.openRate);
    const clickValues = data.map(d => d.clickRate);
    const median = (vals: number[]) => { const s = [...vals].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const openMedian = median(openValues);
    const clickMedian = median(clickValues);
    // Simple EMA smoothing (alpha chooses responsiveness)
    const smooth = (vals: number[], alpha = 0.25) => {
        if (!vals.length) return [] as number[];
        const out: number[] = [vals[0]];
        for (let i = 1; i < vals.length; i++) out.push(alpha * vals[i] + (1 - alpha) * out[i - 1]);
        return out;
    };
    const openSmooth = smooth(openValues);
    const clickSmooth = smooth(clickValues);

    // Chart helpers (two stacked charts)
    const w = 520; const h = 80; const pad = 6;
    const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
    const yFactory = (vals: number[]) => {
        const maxVal = Math.max(...vals, 1);
        const minVal = 0;
        return (v: number) => h - pad - ((v - minVal) / (maxVal - minVal)) * (h - pad * 2);
    };
    const yOpen = yFactory(openValues);
    const yClick = yFactory(clickValues);
    const pathFrom = (vals: number[], yFn: (v: number) => number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${yFn(v)}`).join(' ');
    const pathFromSmooth = (vals: number[], yFn: (v: number) => number) => pathFrom(vals, yFn);

    // Baseline/latest window shading indexes
    const windowSize = metrics?.windowSize || 0;
    const baselineEnd = windowSize - 1;
    const latestStart = data.length - windowSize;

    return (
        <div className="mb-4">
            <div className="relative rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Campaign Engagement Trend</h3>
                        <button onClick={() => setShowHelp(s => !s)} aria-label="Explain engagement trend" className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
                            <Info className="w-3.5 h-3.5" />
                        </button>
                    </div>
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
                <div className="flex flex-col gap-6">
                    {/* Open Rate Chart */}
                    <div>
                        <div className="flex items-center justify-between mb-1"><p className="text-[11px] font-medium text-purple-700 dark:text-purple-300">Open Rate</p>{metrics && <span className="text-[10px] text-gray-500 dark:text-gray-400">Median {fmtPct(openMedian)}</span>}</div>
                        <svg width={w} height={h} className="w-full">
                            <rect x={0} y={0} width={w} height={h} rx={6} className="fill-gray-50 dark:fill-gray-800" />
                            {/* Shaded windows */}
                            {windowSize > 0 && (
                                <>
                                    <rect x={x(0)} y={0} width={x(baselineEnd) - x(0)} height={h} className="fill-purple-200/20 dark:fill-purple-500/10" />
                                    <rect x={x(latestStart)} y={0} width={x(data.length - 1) - x(latestStart)} height={h} className="fill-indigo-200/20 dark:fill-indigo-500/10" />
                                </>
                            )}
                            {/* Median line */}
                            <line x1={x(0)} x2={x(data.length - 1)} y1={yOpen(openMedian)} y2={yOpen(openMedian)} className="stroke-purple-300 dark:stroke-purple-700" strokeDasharray="4 4" strokeWidth={1} />
                            {/* Raw path (faint) */}
                            <path d={pathFrom(openValues, yOpen)} className="stroke-purple-400/40" fill="none" strokeWidth={1} />
                            {/* Smoothed path */}
                            <path d={pathFromSmooth(openSmooth, yOpen)} className="stroke-purple-600" fill="none" strokeWidth={2} strokeLinecap="round" />
                            {/* End labels */}
                            <text x={x(0) + 4} y={yOpen(openSmooth[0]) - 4} className="fill-purple-700 dark:fill-purple-300 text-[10px]">{fmtPct(openSmooth[0])}</text>
                            <text textAnchor="end" x={x(data.length - 1) - 4} y={yOpen(openSmooth[openSmooth.length - 1]) - 4} className="fill-purple-700 dark:fill-purple-300 text-[10px]">{fmtPct(openSmooth[openSmooth.length - 1])}</text>
                        </svg>
                    </div>
                    {/* Click Rate Chart */}
                    <div>
                        <div className="flex items-center justify-between mb-1"><p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">Click Rate</p>{metrics && <span className="text-[10px] text-gray-500 dark:text-gray-400">Median {fmtPct(clickMedian)}</span>}</div>
                        <svg width={w} height={h} className="w-full">
                            <rect x={0} y={0} width={w} height={h} rx={6} className="fill-gray-50 dark:fill-gray-800" />
                            {windowSize > 0 && (
                                <>
                                    <rect x={x(0)} y={0} width={x(baselineEnd) - x(0)} height={h} className="fill-indigo-200/20 dark:fill-indigo-500/10" />
                                    <rect x={x(latestStart)} y={0} width={x(data.length - 1) - x(latestStart)} height={h} className="fill-purple-200/20 dark:fill-purple-500/10" />
                                </>
                            )}
                            <line x1={x(0)} x2={x(data.length - 1)} y1={yClick(clickMedian)} y2={yClick(clickMedian)} className="stroke-indigo-300 dark:stroke-indigo-700" strokeDasharray="4 4" strokeWidth={1} />
                            <path d={pathFrom(clickValues, yClick)} className="stroke-indigo-400/40" fill="none" strokeWidth={1} />
                            <path d={pathFromSmooth(clickSmooth, yClick)} className="stroke-indigo-600" fill="none" strokeWidth={2} strokeLinecap="round" />
                            <text x={x(0) + 4} y={yClick(clickSmooth[0]) - 4} className="fill-indigo-700 dark:fill-indigo-300 text-[10px]">{fmtPct(clickSmooth[0])}</text>
                            <text textAnchor="end" x={x(data.length - 1) - 4} y={yClick(clickSmooth[clickSmooth.length - 1]) - 4} className="fill-indigo-700 dark:fill-indigo-300 text-[10px]">{fmtPct(clickSmooth[clickSmooth.length - 1])}</text>
                        </svg>
                    </div>
                    {/* Metrics summary cards */}
                    {metrics && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Open Baseline</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.earlyOpen)}</p></div>
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Open Latest</p><div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.lateOpen)}</p><span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${metrics.openDeltaPct >= 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{metrics.openDeltaPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{metrics.openDeltaPct.toFixed(1)}%</span></div></div>
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Click Baseline</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.earlyClick)}</p></div>
                            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">Click Latest</p><div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(metrics.lateClick)}</p>{(() => { const displayDelta = metrics.earlyClick < 0.1 ? null : metrics.clickDeltaPct; return displayDelta === null ? <span className="text-[10px] text-gray-400">n/a</span> : <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${displayDelta >= 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{displayDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{displayDelta.toFixed(1)}%</span>; })()}</div></div>
                            <div className="col-span-full flex items-center justify-between pt-1"><span className="text-[10px] text-gray-500 dark:text-gray-400">Shaded = baseline & latest windows (N={windowSize} days each)</span><span className="text-[10px] text-gray-400 dark:text-gray-500">Smoothed (EMA α=0.25)</span></div>
                        </div>
                    )}
                    <div className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">
                        <p className="mb-1"><span className="font-medium text-gray-800 dark:text-gray-100">Interpretation:</span> Track whether campaign engagement is eroding or improving. If open holds while click drops, focus on offer / CTA relevance. If both decline, test cadence & subject lines, and prune inactives. Improvements after list hygiene or creative changes should appear first in opens, then clicks.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
