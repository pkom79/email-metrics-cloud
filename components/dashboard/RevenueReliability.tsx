"use client";
import React, { useMemo, useState, useCallback } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';
import { Info, ShieldCheck } from 'lucide-react';

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
    const [scope, setScope] = useState<'all' | 'campaigns' | 'flows'>('all');
    const filteredCampaigns = scope === 'flows' ? [] : campaigns;
    const filteredFlows = scope === 'campaigns' ? [] : flows;
    // Build weekly aggregates (campaign + flow) and trim partial edge weeks (<7 active days) to avoid skew
    const { weeks, trimmed } = useMemo(() => {
        interface WeekRec {
            weekStart: Date;
            label: string;
            revenue: number;
            campaignRevenue: number;
            flowRevenue: number;
            emails: number;
            campaignEmails: number;
            activeDays: number; // distinct days with at least one send
            daySet: Set<string>;
        }
        if (!filteredCampaigns.length && !filteredFlows.length) return { weeks: [] as WeekRec[], trimmed: { start: false, end: false } };
        const startOfWeek = (d: Date) => {
            const dt = new Date(d);
            const day = dt.getDay(); // 0=Sun
            const diff = (day + 6) % 7; // shift to Monday start
            dt.setDate(dt.getDate() - diff);
            dt.setHours(0, 0, 0, 0);
            return dt;
        };
        const map: Record<string, WeekRec> = {};
        const add = (sentDate: Date, revenue: number | undefined, emailsSent: number | undefined, type: 'campaign' | 'flow') => {
            const ws = startOfWeek(sentDate);
            const key = ws.toISOString().slice(0, 10);
            if (!map[key]) map[key] = { weekStart: ws, label: '', revenue: 0, campaignRevenue: 0, flowRevenue: 0, emails: 0, campaignEmails: 0, activeDays: 0, daySet: new Set() };
            const bucket = map[key];
            const rev = revenue || 0;
            bucket.revenue += rev;
            if (type === 'campaign') bucket.campaignRevenue += rev; else bucket.flowRevenue += rev;
            bucket.emails += emailsSent || 0;
            if (type === 'campaign') bucket.campaignEmails += emailsSent || 0;
            bucket.daySet.add(sentDate.toISOString().slice(0, 10));
        };
        for (const c of filteredCampaigns) add(c.sentDate, c.revenue, c.emailsSent, 'campaign');
        for (const f of filteredFlows) add(f.sentDate, f.revenue, f.emailsSent, 'flow');
        let arr: WeekRec[] = Object.values(map)
            .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
            .map(w => ({ ...w, activeDays: w.daySet.size, label: w.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }));
        let start = false, end = false;
        if (arr.length && arr[0].activeDays < 7) { arr = arr.slice(1); start = true; }
        if (arr.length && arr[arr.length - 1].activeDays < 7) { arr = arr.slice(0, -1); end = true; }
        return { weeks: arr, trimmed: { start, end } };
    }, [filteredCampaigns, filteredFlows]);

    const stats = useMemo(() => {
        if (weeks.length < 3) return null; // need at least 3 data points for meaningful variability
        const totals = weeks.map(w => w.revenue);
        const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
        const variance = totals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / totals.length;
        const std = Math.sqrt(variance);
        const cv = mean > 0 ? std / mean : 0; // coefficient of variation 0..∞ (we clamp later)
        // Raw reliability
        const reliabilityRaw = (1 - Math.min(1, cv)) * 100;
        const volatilityPct = cv * 100; // direct interpretation
        // Reliability qualitative category mapping (explicit thresholds)
        // 90–100 Excellent, 80–89 Good, 65–79 OK, 50–64 Attention Needed, <50 Critical
        const rRounded = Math.round(reliabilityRaw);
        const category = rRounded >= 90 ? 'Excellent' : rRounded >= 80 ? 'Good' : rRounded >= 65 ? 'OK' : rRounded >= 50 ? 'Attention Needed' : 'Critical';
        const volatilityDisplay = (volatilityPct % 1 === 0) ? volatilityPct.toFixed(0) : volatilityPct.toFixed(1);
        const reliabilityDisplay = (volatilityPct % 1 === 0) ? Math.round(reliabilityRaw).toFixed(0) : reliabilityRaw.toFixed(1);
        const zeroCampaignWeeks = weeks.filter(w => w.campaignEmails === 0).length;
        const meanCampaignShare = weeks.reduce((s, w) => s + (w.campaignRevenue / (w.revenue || 1)), 0) / weeks.length;

        // --- Lost Campaign Revenue Estimation (simple robust flow-share model) ---
        // Use non-zero campaign weeks to derive a robust median campaign share excluding outliers.
        // --- Lost Campaign Revenue Estimation (revised: robust median absolute campaign revenue) ---
        // Rationale: previous share * flow model overstated for brands with high flow revenue. Use median non-zero campaign revenue (robust to outliers) * number of zero weeks.
        const nonZero = weeks.filter(w => w.campaignRevenue > 0);
        let lostCampaignEstimate = 0;
        if (nonZero.length >= 3 && zeroCampaignWeeks > 0) {
            const median = (vals: number[]) => {
                const srt = [...vals].sort((a, b) => a - b); const n = srt.length; if (!n) return 0; return n % 2 ? srt[(n - 1) / 2] : (srt[n / 2 - 1] + srt[n / 2]) / 2;
            };
            const campVals = nonZero.map(w => w.campaignRevenue);
            const med = median(campVals);
            const absDevs = campVals.map(v => Math.abs(v - med));
            const mad = median(absDevs) || 1e-6;
            const scale = 1.4826 * mad;
            const filtered = campVals.filter(v => Math.abs(v - med) / scale <= 3);
            const robustMedian = filtered.length >= 3 ? median(filtered) : med;
            // Guard rails – avoid extreme inflation
            const perWeek = Math.max(0, robustMedian);
            lostCampaignEstimate = perWeek * zeroCampaignWeeks;
        }
        return { mean, std, cv, reliabilityRaw, reliabilityDisplay, volatilityPct, volatilityDisplay, category, zeroCampaignWeeks, meanCampaignShare, lostCampaignEstimate };
    }, [weeks]);

    // Hooks must run before any early return to satisfy rules-of-hooks
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const onEnter = useCallback((i: number) => setHoverIndex(i), []);
    const onLeave = useCallback(() => setHoverIndex(null), []);

    if (!weeks.length) return null;

    // Chart geometry (adaptive – no horizontal scrollbar).
    const weeksCount = weeks.length;
    const h = 240; const pad = 46;
    // Base chart width capped to container-friendly size (~max dashboard width).
    const baseMax = 1100;
    const w = Math.min(baseMax, Math.max(600, weeksCount * 32));
    const maxRevenue = Math.max(...weeks.map(w => w.revenue), 1);
    const gap = weeksCount > 40 ? 2 : weeksCount > 30 ? 4 : weeksCount > 20 ? 6 : weeksCount > 12 ? 8 : 12;
    const innerWidth = w - 64; // side padding reduced since no scroll
    const barW = Math.max(4, Math.min(40, (innerWidth - gap * (weeksCount - 1)) / weeksCount));
    const xPosFor = (i: number) => 40 + i * (barW + gap);
    const usableHeight = h - pad - 70; // space for labels / band
    const meanY = (val: number) => (h - pad) - (val / maxRevenue) * usableHeight;

    const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
    const formatPct1 = (v: number) => (v * 100).toFixed(1) + '%';

    // Center the chart when it doesn't occupy full target width
    const centerChart = (() => {
        const weeksCountLocal = weeks.length;
        if (!weeksCountLocal) return false;
        // After width calc we know if we capped below baseMax; recalc with same formula
        const tentative = Math.min(1100, Math.max(600, weeksCountLocal * 32));
        return tentative < 1100; // center when not stretching to full max width
    })();

    return (
        <div className="mt-8">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Weekly Revenue Reliability</h3>
                        <div className="group relative">
                            <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                            <div className="absolute left-0 top-6 z-20 hidden group-hover:block w-80 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 space-y-2">
                                <div>
                                    <p className="text-gray-700 dark:text-gray-200 font-semibold mb-1">Definitions</p>
                                    <ul className="list-disc pl-4 space-y-0.5 text-gray-600 dark:text-gray-300">
                                        <li><span className="font-medium">Reliability</span>: 100 - Volatility (higher = steadier)</li>
                                        <li><span className="font-medium">Volatility</span>: Std Dev / Mean (as %)</li>
                                        <li><span className="font-medium">Band</span>: ±1 Std Dev around mean line</li>
                                        <li><span className="font-medium">Zero Campaign Weeks</span>: No campaign sends</li>
                                    </ul>
                                </div>
                                <div>
                                    <p className="text-gray-700 dark:text-gray-200 font-semibold mb-1">Categories</p>
                                    <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-600 dark:text-gray-300">
                                        <li>Excellent ≥90%</li>
                                        <li>Good 80–89%</li>
                                        <li>OK 65–79%</li>
                                        <li>Attention 50–64%</li>
                                        <li className="col-span-2">Critical &lt;50%</li>
                                    </ul>
                                </div>
                                <p className="text-gray-500 dark:text-gray-400">Target Excellent or Good for predictable revenue.</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <select value={scope} onChange={e => setScope(e.target.value as any)} className="appearance-none px-3 h-8 pr-8 rounded-lg border bg-white border-gray-300 text-gray-700 text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                                <option value="all">All Email</option>
                                <option value="campaigns">Campaigns</option>
                                <option value="flows">Flows</option>
                            </select>
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▼</span>
                        </div>
                    </div>
                </div>
                <div className={`pb-2 overflow-visible ${centerChart ? 'flex justify-center' : ''}`}>
                    <div className="relative" style={{ width: w, marginLeft: centerChart ? 'auto' : undefined, marginRight: centerChart ? 'auto' : undefined }}>
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
                                const x = xPosFor(i);
                                const totalH = (wk.revenue / maxRevenue) * usableHeight;
                                const campH = (wk.campaignRevenue / maxRevenue) * usableHeight;
                                const flowH = (wk.flowRevenue / maxRevenue) * usableHeight;
                                const baseY = (h - pad) - totalH;
                                const flowY = baseY;
                                const campY = flowY + (flowH - campH);
                                return (
                                    <g key={wk.label} onMouseEnter={() => onEnter(i)} onMouseLeave={onLeave} className="cursor-pointer">
                                        {scope !== 'campaigns' && <rect x={x} y={flowY} width={barW} height={Math.max(2, flowH)} rx={5} className="fill-[url(#flowGrad)] opacity-90 hover:opacity-100 transition-opacity shadow-sm" />}
                                        <rect x={x} y={campY} width={barW} height={Math.max(2, campH)} rx={5} className="fill-[url(#campGrad)] opacity-90 hover:opacity-100 transition-opacity shadow-sm" />
                                        {i === weeks.length - 1 && (
                                            <text x={x + barW / 2} y={baseY - 10} textAnchor="middle" className="fill-purple-700 dark:fill-purple-300 text-[10px] font-semibold tracking-tight">{formatCurrency(wk.revenue)}</text>
                                        )}
                                    </g>
                                );
                            })}
                            {/* Axis baseline */}
                            <line x1={0} x2={w} y1={h - pad} y2={h - pad} className="stroke-gray-300 dark:stroke-gray-700" />
                            {/* Removed extra grid lines for clarity */}
                        </svg>
                        {/* Tooltip */}
                        {hoverIndex !== null && weeks[hoverIndex] && stats && (
                            <div className="pointer-events-none absolute -top-2 left-0 text-[11px] z-30" style={{ transform: `translateX(${xPosFor(hoverIndex)}px)` }}>
                                {(() => {
                                    const wk = weeks[hoverIndex];
                                    const campShare = wk.revenue ? wk.campaignRevenue / wk.revenue : 0;
                                    const deviation = stats.mean > 0 ? ((wk.revenue - stats.mean) / stats.mean) * 100 : 0;
                                    return (
                                        <div className="translate-x-6 -translate-y-3 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-xl p-3">
                                            <p className="font-medium text-gray-800 dark:text-gray-100 mb-1">Week of {wk.label}</p>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total</span><span className="font-medium text-gray-800 dark:text-gray-100">{formatCurrency(wk.revenue)}</span></div>
                                            <div className="flex justify-between"><span className="text-purple-600 dark:text-purple-300">Campaigns</span><span className="font-medium">{formatCurrency(wk.campaignRevenue)}</span></div>
                                            {scope !== 'campaigns' && <div className="flex justify-between"><span className="text-indigo-600 dark:text-indigo-300">Flows</span><span className="font-medium">{formatCurrency(wk.flowRevenue)}</span></div>}
                                            <div className="flex justify-between mt-1"><span className="text-gray-500 dark:text-gray-400">Campaign Share</span><span>{formatPct1(campShare)}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Vs Mean</span><span className={deviation >= 0 ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400'}>{deviation >= 0 ? '+' : ''}{deviation.toFixed(1)}%</span></div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
                {stats && (() => {
                    const categoryColor = stats.category === 'Excellent' ? 'bg-green-500' :
                        stats.category === 'Good' ? 'bg-emerald-500' :
                            stats.category === 'OK' ? 'bg-amber-400' :
                                stats.category === 'Attention Needed' ? 'bg-orange-500' : 'bg-rose-500';
                    const reliabilityTooltip = (
                        <div className="space-y-2">
                            <div>
                                <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Reliability</p>
                                <p className="text-gray-600 dark:text-gray-300">Reliability = 100 - Volatility. Measures steadiness of weekly revenue (higher = more predictable).</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-gray-600 dark:text-gray-300">
                                <div className="col-span-2 font-medium text-gray-700 dark:text-gray-200">Categories</div>
                                <div>Excellent ≥90%</div>
                                <div>Good 80–89%</div>
                                <div>OK 65–79%</div>
                                <div>Attention 50–64%</div>
                                <div className="col-span-2">Critical &lt;50%</div>
                            </div>
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                                Mean {formatCurrency(stats.mean)} • Std Dev {formatCurrency(stats.std)} • Volatility {stats.volatilityDisplay}%
                            </div>
                            <div className="text-[10px] text-gray-500 dark:text-gray-400">Improve by filling send gaps, increasing automated (flow) share, smoothing spikes.</div>
                        </div>
                    );
                    return (
                        <div className={`mt-6 ${centerChart ? 'flex flex-wrap justify-center gap-3' : 'grid grid-cols-2 md:grid-cols-6 gap-3'} text-[11px]`}>
                            <StatTile label="Reliability" tooltip={reliabilityTooltip} value={`${stats.reliabilityDisplay}%`} category={stats.category} categoryColor={categoryColor} />
                            <StatTile label="Avg Weekly Revenue" tooltip="Average weekly revenue for selected scope" value={formatCurrency(stats.mean)} />
                            <StatTile label="Std Dev" tooltip="Standard deviation of weekly revenue (selected scope)" value={formatCurrency(stats.std)} />
                            {scope !== 'flows' && (
                                <StatTile label="Zero Campaign Weeks" tooltip="Weeks with no campaign sends" value={String(stats.zeroCampaignWeeks)} />
                            )}
                            {scope !== 'flows' && (
                                <StatTile label="Est. Lost Camp Rev" tooltip="Estimated lost campaign revenue (median non-zero campaign week * zero weeks)" value={formatCurrency(stats.lostCampaignEstimate)} />
                            )}
                            {scope === 'all' && (
                                <StatTile label="Campaign Share" tooltip="Average campaign revenue share of total" value={formatPct1(stats.meanCampaignShare)} />
                            )}
                        </div>
                    );
                })()}
                {/* Interpretation removed per request (tooltip now sufficient) */}
                <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gradient-to-b from-purple-400 to-purple-700" /> Campaign Revenue</div>
                    {scope !== 'campaigns' && <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gradient-to-b from-indigo-400 to-indigo-700" /> Flow Revenue</div>}
                    {stats && <div className="flex items-center gap-1"><span className="w-6 h-[2px] bg-purple-500" /> Mean (±1σ band)</div>}
                </div>
            </div>
        </div>
    );
}

// Interpretation component removed.

interface StatTileProps { label: string; value: string; tooltip: React.ReactNode; category?: string; categoryColor?: string; }
const StatTile: React.FC<StatTileProps> = ({ label, value, tooltip, category, categoryColor }) => (
    <div className="group relative">
        <div className="min-w-[170px] rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-4 flex flex-col h-full shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{label}</p>
            {category && categoryColor && (
                <div className="flex items-center gap-1 mb-2 text-[11px] font-medium">
                    <span className={`w-2 h-2 rounded-full ${categoryColor}`} />
                    <span className="text-gray-600 dark:text-gray-300">{category}</span>
                </div>
            )}
            <p className="mt-auto text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
        <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 z-40 hidden group-hover:block w-60 text-[11px] leading-snug bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2 text-gray-600 dark:text-gray-300">
            {tooltip}
        </div>
    </div>
);
