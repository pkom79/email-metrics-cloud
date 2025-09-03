"use client";
import React, { useMemo } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';
import { Info } from 'lucide-react';

interface RevenueReliabilityProps {
    campaigns: ProcessedCampaign[];
    flows: ProcessedFlowEmail[];
    dateRange: string;
}

/*
 * Revenue Reliability Module
 * Calculates weekly revenue totals (campaigns + flows) and a reliability score:
 *  - Coefficient of Variation (CV) = stdDev / mean for last N full weeks
 *  - Score buckets: 90+ Excellent, 75-89 Strong, 60-74 Moderate, <60 Volatile
 *  - Reliability % = clamp(100 - (CV * 100 * penaltyFactor), 0, 100) with penaltyFactor scaling to keep typical CV ranges meaningful.
 * Also detects weeks with zero sends (gaps) and highlights them.
 */
export default function RevenueReliability({ campaigns, flows }: RevenueReliabilityProps) {
    const weeks = useMemo(() => {
        const all = [...campaigns, ...flows];
        if (!all.length) return [] as { weekStart: Date; label: string; revenue: number; emails: number }[];
        const weekMap: Record<string, { revenue: number; emails: number; weekStart: Date }> = {};
        const startOfWeek = (d: Date) => { const dt = new Date(d); const day = dt.getDay(); const diff = (day + 6) % 7; dt.setDate(dt.getDate() - diff); dt.setHours(0, 0, 0, 0); return dt; };
        for (const e of all) {
            const ws = startOfWeek(e.sentDate);
            const key = ws.toISOString().slice(0, 10);
            if (!weekMap[key]) weekMap[key] = { revenue: 0, emails: 0, weekStart: ws };
            weekMap[key].revenue += e.revenue || 0;
            weekMap[key].emails += e.emailsSent || 0;
        }
        return Object.values(weekMap)
            .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
            .map(w => ({ ...w, label: w.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }));
    }, [campaigns, flows]);

    const stats = useMemo(() => {
        if (weeks.length < 3) return null;
        const revs = weeks.map(w => w.revenue);
        const mean = revs.reduce((s, r) => s + r, 0) / revs.length;
        const variance = revs.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / revs.length;
        const std = Math.sqrt(variance);
        const cv = mean > 0 ? std / mean : 0; // 0..1 typically
        // Map CV to reliability: lower CV => higher score
        const penaltyFactor = 65; // tuning constant
        const rawScore = Math.max(0, Math.min(100, 100 - cv * 100 * penaltyFactor));
        const score = Math.round(rawScore);
        const bucket = score >= 90 ? 'Excellent' : score >= 75 ? 'Strong' : score >= 60 ? 'Moderate' : 'Volatile';
        const zeroWeeks = weeks.filter(w => w.emails === 0).length;
        return { mean, std, cv, score, bucket, zeroWeeks };
    }, [weeks]);

    if (!weeks.length) return null;

    // Mini bar chart dimensions
    const w = Math.max(weeks.length * 34, 360);
    const h = 140; const pad = 20;
    const maxRevenue = Math.max(...weeks.map(w => w.revenue), 1);
    const barW = 20;

    const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

    return (
        <div className="mt-8">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Weekly Revenue Reliability</h3>
                        <div className="group relative">
                            <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                            <div className="absolute left-0 top-6 z-10 hidden group-hover:block w-72 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
                                <p className="text-gray-700 dark:text-gray-200 mb-1"><span className="font-semibold">Reliability Score</span> rewards consistent weekly revenue.</p>
                                <ul className="list-disc pl-4 space-y-0.5 text-gray-600 dark:text-gray-300">
                                    <li>Score = 100 - (CV * 100 * k)</li>
                                    <li>Lower volatility (CV) = higher score.</li>
                                    <li>Gaps or zero-send weeks drag consistency.</li>
                                </ul>
                                <p className="mt-1 text-gray-500 dark:text-gray-400">Use this to judge stability before scaling spend.</p>
                            </div>
                        </div>
                    </div>
                    {stats && (
                        <div className="flex items-center gap-3 text-xs">
                            <div className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">CV {(stats.cv * 100).toFixed(1)}%</div>
                            <div className={`px-2 py-1 rounded-md font-medium ${stats.bucket === 'Excellent' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : stats.bucket === 'Strong' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : stats.bucket === 'Moderate' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{stats.score}% {stats.bucket}</div>
                            {stats.zeroWeeks > 0 && <div className="px-2 py-1 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{stats.zeroWeeks} gap{stats.zeroWeeks > 1 ? 's' : ''}</div>}
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto pb-2">
                    <svg width={w} height={h} className="min-w-full">
                        <defs>
                            <linearGradient id="revBar" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="#7e22ce" />
                                <stop offset="100%" stopColor="#9333ea" />
                            </linearGradient>
                        </defs>
                        {/* Axis baseline */}
                        <line x1={0} x2={w} y1={h - pad} y2={h - pad} className="stroke-gray-300 dark:stroke-gray-700" />
                        {weeks.map((wk, i) => {
                            const x = i * 34 + 10;
                            const barH = Math.max(2, (wk.revenue / maxRevenue) * (h - pad - 20));
                            const y = (h - pad) - barH;
                            return (
                                <g key={wk.label}>
                                    <rect x={x} y={y} width={barW} height={barH} rx={4} className="fill-[url(#revBar)] opacity-90 hover:opacity-100 cursor-pointer transition-opacity" />
                                    <text x={x + barW / 2} y={h - pad + 12} textAnchor="middle" className="fill-gray-600 dark:fill-gray-400 text-[10px] font-medium">{wk.label}</text>
                                    {i === weeks.length - 1 && (
                                        <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="fill-purple-700 dark:fill-purple-300 text-[10px] font-semibold">{formatCurrency(wk.revenue)}</text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                </div>
                {stats && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Avg Weekly Rev</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(stats.mean)}</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Std Dev</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(stats.std)}</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Reliability Score</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stats.score}%</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gray-50 dark:bg-gray-800/40"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Zero-Send Weeks</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stats.zeroWeeks}</p></div>
                    </div>
                )}
                <div className="mt-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">
                    <p><span className="font-medium text-gray-800 dark:text-gray-100">How to use:</span> Higher reliability means you can forecast and scale acquisition with more confidence. Investigate sudden drops or gaps. Aim to lift score by smoothing send cadence, optimizing triggered flows, and backfilling weak calendar weeks.</p>
                </div>
            </div>
        </div>
    );
}
