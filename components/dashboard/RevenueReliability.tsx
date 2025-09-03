"use client";
import React, { useMemo, useState, useCallback } from 'react';
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
    // Build weekly aggregates with separate campaign & flow revenue
    const weeks = useMemo(() => {
        if (!campaigns.length && !flows.length) return [] as {
            weekStart: Date;
            label: string;
            revenue: number;
            campaignRevenue: number;
            flowRevenue: number;
            emails: number;
        }[];
        const startOfWeek = (d: Date) => {
            const dt = new Date(d);
            const day = dt.getDay(); // 0=Sun
            const diff = (day + 6) % 7; // shift to Monday start
            dt.setDate(dt.getDate() - diff);
            dt.setHours(0, 0, 0, 0);
            return dt;
        };
        interface Bucket { revenue: number; campaignRevenue: number; flowRevenue: number; emails: number; weekStart: Date; }
        const map: Record<string, Bucket> = {};
        const add = (sentDate: Date, revenue: number | undefined, emailsSent: number | undefined, kind: 'campaign' | 'flow') => {
            const ws = startOfWeek(sentDate);
            const key = ws.toISOString().slice(0, 10);
            if (!map[key]) map[key] = { revenue: 0, campaignRevenue: 0, flowRevenue: 0, emails: 0, weekStart: ws };
            const bucket = map[key];
            const rev = revenue || 0;
            bucket.revenue += rev;
            if (kind === 'campaign') bucket.campaignRevenue += rev; else bucket.flowRevenue += rev;
            bucket.emails += emailsSent || 0;
        };
        for (const c of campaigns) add(c.sentDate, c.revenue, c.emailsSent, 'campaign');
        for (const f of flows) add(f.sentDate, f.revenue, f.emailsSent, 'flow');
        return Object.values(map)
            .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
            .map(w => ({ ...w, label: w.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }));
    }, [campaigns, flows]);

    const stats = useMemo(() => {
        if (weeks.length < 3) return null; // need at least 3 data points for meaningful variability
        const totals = weeks.map(w => w.revenue);
        const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
        const variance = totals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / totals.length;
        const std = Math.sqrt(variance);
        const cv = mean > 0 ? std / mean : 0; // coefficient of variation 0..∞ (we clamp later)
        // Simpler reliability: Reliability = (1 - min(1, CV)) * 100
        const reliability = Math.round((1 - Math.min(1, cv)) * 100);
        const volatilityPct = cv * 100; // direct interpretation
        const bucket = reliability >= 90 ? 'Excellent' : reliability >= 75 ? 'Strong' : reliability >= 60 ? 'Needs Work' : 'Volatile';
        const zeroWeeks = weeks.filter(w => w.emails === 0).length;
        const meanCampaignShare = weeks.reduce((s, w) => s + (w.campaignRevenue / (w.revenue || 1)), 0) / weeks.length;
        return { mean, std, cv, reliability, volatilityPct, bucket, zeroWeeks, meanCampaignShare };
    }, [weeks]);

    if (!weeks.length) return null;

    // Chart geometry
    const w = Math.max(weeks.length * 40, 420);
    const h = 170; const pad = 28;
    const maxRevenue = Math.max(...weeks.map(w => w.revenue), 1);
    const barW = 22;
    const meanY = (val: number) => (h - pad) - (val / maxRevenue) * (h - pad - 30);

    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const onEnter = useCallback((i: number) => setHoverIndex(i), []);
    const onLeave = useCallback(() => setHoverIndex(null), []);

    const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
    const formatPct1 = (v: number) => (v * 100).toFixed(1) + '%';

    return (
        <div className="mt-8">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Weekly Revenue Reliability</h3>
                        <div className="group relative">
                            <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                            <div className="absolute left-0 top-6 z-20 hidden group-hover:block w-80 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3">
                                <p className="text-gray-700 dark:text-gray-200 mb-1"><span className="font-semibold">What is Reliability?</span> Consistency of weekly total email revenue (campaigns + flows).</p>
                                <ul className="list-disc pl-4 space-y-0.5 text-gray-600 dark:text-gray-300">
                                    <li><span className="font-medium">Volatility %</span> = Coefficient of Variation (std dev / mean).</li>
                                    <li><span className="font-medium">Reliability</span> = 100 - min(100, Volatility %).</li>
                                    <li>Lower volatility → easier forecasting & scaling.</li>
                                    <li>Zero‑send gaps inflate volatility.</li>
                                </ul>
                                <p className="mt-1 text-gray-500 dark:text-gray-400">Aim for ≥75. Improve by smoothing send cadence & strengthening evergreen flow revenue.</p>
                            </div>
                        </div>
                    </div>
                    {stats && (
                        <div className="flex items-center gap-3 text-xs">
                            <div className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">Volatility {stats.volatilityPct.toFixed(1)}%</div>
                            <div className={`px-2 py-1 rounded-md font-medium ${stats.bucket === 'Excellent' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : stats.bucket === 'Strong' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : stats.bucket === 'Needs Work' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{stats.reliability}% {stats.bucket}</div>
                            <div className="px-2 py-1 rounded-md bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{(stats.meanCampaignShare * 100).toFixed(0)}% Campaigns</div>
                            {stats.zeroWeeks > 0 && <div className="px-2 py-1 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{stats.zeroWeeks} gap{stats.zeroWeeks > 1 ? 's' : ''}</div>}
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto pb-2">
                    <div className="relative inline-block" style={{ width: w }}>
                        <svg width={w} height={h} className="block">
                            <defs>
                                <linearGradient id="campGrad" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0%" stopColor="#a855f7" />
                                    <stop offset="100%" stopColor="#7e22ce" />
                                </linearGradient>
                                <linearGradient id="flowGrad" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0%" stopColor="#6366f1" />
                                    <stop offset="100%" stopColor="#4338ca" />
                                </linearGradient>
                                <linearGradient id="stdBand" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0%" stopColor="#9333ea11" />
                                    <stop offset="100%" stopColor="#6366f111" />
                                </linearGradient>
                            </defs>
                            {/* Std dev band (mean ± 1 std) */}
                            {stats && stats.std > 0 && (
                                (() => {
                                    const top = Math.max(stats.mean + stats.std, 0);
                                    const bottom = Math.max(stats.mean - stats.std, 0);
                                    const yTop = meanY(top);
                                    const yBottom = meanY(bottom);
                                    return <rect x={0} y={yTop} width={w} height={Math.max(4, yBottom - yTop)} className="fill-[url(#stdBand)]" />;
                                })()
                            )}
                            {/* Mean line */}
                            {stats && (
                                <line x1={0} x2={w} y1={meanY(stats.mean)} y2={meanY(stats.mean)} className="stroke-purple-500 dark:stroke-purple-400" strokeDasharray="4 3" strokeWidth={1} />
                            )}
                            {/* Bars */}
                            {weeks.map((wk, i) => {
                                const xPos = i * 40 + 10;
                                const totalH = (wk.revenue / maxRevenue) * (h - pad - 30);
                                const campH = (wk.campaignRevenue / maxRevenue) * (h - pad - 30);
                                const flowH = (wk.flowRevenue / maxRevenue) * (h - pad - 30);
                                const baseY = (h - pad) - totalH;
                                const flowY = baseY; // bottom segment
                                const campY = flowY + (flowH - campH); // stacked above flow
                                return (
                                    <g key={wk.label} onMouseEnter={() => onEnter(i)} onMouseLeave={onLeave} className="cursor-pointer">
                                        {/* Flow segment */}
                                        <rect x={xPos} y={flowY} width={barW} height={Math.max(2, flowH)} rx={3} className="fill-[url(#flowGrad)] opacity-90 hover:opacity-100 transition-opacity" />
                                        {/* Campaign segment */}
                                        <rect x={xPos} y={campY} width={barW} height={Math.max(2, campH)} rx={3} className="fill-[url(#campGrad)] opacity-90 hover:opacity-100 transition-opacity" />
                                        {/* Week label */}
                                        <text x={xPos + barW / 2} y={h - pad + 12} textAnchor="middle" className="fill-gray-600 dark:fill-gray-400 text-[10px] font-medium">{wk.label}</text>
                                        {/* Total label for last week */}
                                        {i === weeks.length - 1 && (
                                            <text x={xPos + barW / 2} y={baseY - 6} textAnchor="middle" className="fill-purple-700 dark:fill-purple-300 text-[10px] font-semibold">{formatCurrency(wk.revenue)}</text>
                                        )}
                                    </g>
                                );
                            })}
                            {/* Axis baseline */}
                            <line x1={0} x2={w} y1={h - pad} y2={h - pad} className="stroke-gray-300 dark:stroke-gray-700" />
                        </svg>
                        {/* Tooltip */}
                        {hoverIndex !== null && weeks[hoverIndex] && stats && (
                            <div className="pointer-events-none absolute -top-2 left-0 text-[11px]" style={{ transform: `translateX(${hoverIndex * 40 + 0}px)` }}>
                                {(() => {
                                    const wk = weeks[hoverIndex];
                                    const campShare = wk.revenue ? wk.campaignRevenue / wk.revenue : 0;
                                    const deviation = stats.mean > 0 ? ((wk.revenue - stats.mean) / stats.mean) * 100 : 0;
                                    return (
                                        <div className="translate-x-4 -translate-y-2 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3">
                                            <p className="font-medium text-gray-800 dark:text-gray-100 mb-1">Week of {wk.label}</p>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total</span><span className="font-medium text-gray-800 dark:text-gray-100">{formatCurrency(wk.revenue)}</span></div>
                                            <div className="flex justify-between"><span className="text-purple-600 dark:text-purple-300">Campaigns</span><span className="font-medium">{formatCurrency(wk.campaignRevenue)}</span></div>
                                            <div className="flex justify-between"><span className="text-indigo-600 dark:text-indigo-300">Flows</span><span className="font-medium">{formatCurrency(wk.flowRevenue)}</span></div>
                                            <div className="flex justify-between mt-1"><span className="text-gray-500 dark:text-gray-400">Campaign Share</span><span>{formatPct1(campShare)}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Vs Mean</span><span className={deviation >= 0 ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400'}>{deviation >= 0 ? '+' : ''}{deviation.toFixed(1)}%</span></div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
                {stats && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gradient-to-br from-gray-50 to-white dark:from-gray-800/40 dark:to-gray-800/10"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Avg Weekly Revenue</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(stats.mean)}</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gradient-to-br from-gray-50 to-white dark:from-gray-800/40 dark:to-gray-800/10"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Std Dev</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(stats.std)}</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-purple-900/5"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Reliability</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stats.reliability}%</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-indigo-900/5"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Volatility</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stats.volatilityPct.toFixed(1)}%</p></div>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 bg-gradient-to-br from-rose-50 to-white dark:from-rose-900/20 dark:to-rose-900/5"><p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Zero-Send Weeks</p><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stats.zeroWeeks}</p></div>
                    </div>
                )}
                <div className="mt-4 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 space-y-1">
                    <p><span className="font-medium text-gray-800 dark:text-gray-100">Interpretation:</span> Volatility shows how far weeks swing from average. Reliability is simply the remaining stability (100 - volatility). A high reliability score means your revenue engine is predictable enough to justify scaling paid acquisition or inventory planning.</p>
                    <p className="text-gray-500 dark:text-gray-400">Improve reliability by: (1) Filling calendar gaps with evergreen campaigns, (2) Lifting automated (flow) share to cushion dips, (3) Smoothing large seasonal spikes with segmented pre-launch build-up, (4) Pruning underperforming send batches that create noisy peaks.</p>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gradient-to-b from-purple-400 to-purple-700" /> Campaign Revenue</div>
                    <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gradient-to-b from-indigo-400 to-indigo-700" /> Flow Revenue</div>
                    {stats && <div className="flex items-center gap-1"><span className="w-6 h-[2px] bg-purple-500" /> Mean (±1σ shaded)</div>}
                </div>
            </div>
        </div>
    );
}
