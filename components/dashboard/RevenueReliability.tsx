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
export default function RevenueReliability({ campaigns, flows, dateRange }: RevenueReliabilityProps) {
    const [scope, setScope] = useState<'all' | 'campaigns' | 'flows'>('all');
    // Derive filtered arrays inside memoized computation blocks to avoid changing deps every render
    const { filteredCampaigns, filteredFlows } = useMemo(() => {
        return {
            filteredCampaigns: scope === 'flows' ? [] : campaigns,
            filteredFlows: scope === 'campaigns' ? [] : flows
        };
    }, [scope, campaigns, flows]);
    // Build weekly aggregates (campaign + flow) and trim partial edge weeks (<7 active days) to avoid skew
    const { weeks } = useMemo(() => {
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
        if (!filteredCampaigns.length && !filteredFlows.length) return { weeks: [] as WeekRec[] };
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

        // Fill explicit gap weeks (e.g. missed campaign weeks) so they surface as zero bars
        if (arr.length) {
            const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
            const existing = new Set(arr.map(w => w.weekStart.getTime()));
            const startTs = arr[0].weekStart.getTime();
            const endTs = arr[arr.length - 1].weekStart.getTime();
            for (let ts = startTs; ts <= endTs; ts += ONE_WEEK) {
                if (!existing.has(ts)) {
                    const ws = new Date(ts);
                    arr.push({
                        weekStart: ws,
                        label: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        revenue: 0,
                        campaignRevenue: 0,
                        flowRevenue: 0,
                        emails: 0,
                        campaignEmails: 0,
                        activeDays: 0,
                        daySet: new Set()
                    });
                }
            }
            arr.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
        }
        let start = false, end = false;
        if (arr.length && arr[0].activeDays < 7) { arr = arr.slice(1); start = true; }
        if (arr.length && arr[arr.length - 1].activeDays < 7) { arr = arr.slice(0, -1); end = true; }
        // Apply week count limit based on selected date range to avoid overcrowding for short windows
        const maxWeeksMap: Record<string, number> = { '30d': 6, '60d': 10, '90d': 14, '120d': 18, '180d': 26, '365d': 54 };
        const maxWeeks = maxWeeksMap[dateRange] || (dateRange === 'all' ? Infinity : 40);
        if (arr.length > maxWeeks) {
            // Keep most recent weeks (slice from end)
            arr = arr.slice(-maxWeeks);
        }
        return { weeks: arr };
    }, [filteredCampaigns, filteredFlows, dateRange]);

    const stats = useMemo(() => {
        if (weeks.length < 3) return null;
        const totals = weeks.map(w => w.revenue);
        const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
        if (mean === 0) return null; // all zero revenue => skip
        const variance = totals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / totals.length;
        const std = Math.sqrt(variance);
        const cv = std / mean; // coefficient of variation
        // Smooth reliability model: exponential decay – avoids hard 0 except mean=0
        const reliability = 100 * Math.exp(-cv);
        const reliabilityDisplay = reliability.toFixed(0);
        const volatilityPct = cv * 100;
        const volatilityDisplay = volatilityPct >= 10 ? volatilityPct.toFixed(0) : volatilityPct.toFixed(1);
        const zeroCampaignWeeks = weeks.filter(w => w.campaignEmails === 0).length;
        const meanCampaignShare = weeks.reduce((s, w) => s + (w.campaignRevenue / (w.revenue || 1)), 0) / weeks.length;
        const nonZeroCamp = weeks.filter(w => w.campaignRevenue > 0).map(w => w.campaignRevenue);
        const avgNonZeroCamp = nonZeroCamp.length ? nonZeroCamp.reduce((s, v) => s + v, 0) / nonZeroCamp.length : 0;
        // Conservative gap estimate: 50% of avg non-zero week per gap
        const lostCampaignEstimate = zeroCampaignWeeks * avgNonZeroCamp * 0.5;
        const r = Number(reliabilityDisplay);
        const category = r >= 85 ? 'Excellent' : r >= 70 ? 'Good' : r >= 55 ? 'OK' : r >= 40 ? 'Attention Needed' : 'Critical';
        return { mean, std, cv, reliability, reliabilityDisplay, volatilityPct, volatilityDisplay, category, zeroCampaignWeeks, meanCampaignShare, lostCampaignEstimate };
    }, [weeks]);

    // Hooks must run before any early return to satisfy rules-of-hooks
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const onEnter = useCallback((i: number) => setHoverIndex(i), []);
    const onLeave = useCallback(() => setHoverIndex(null), []);

    if (!weeks.length) return null;

    // Chart geometry (adaptive fill, equal spacing, no horizontal scroll)
    const weeksCount = weeks.length;
    const h = 240; const pad = 46;
    const baseMax = 1100; // max width for dashboard section
    const w = baseMax; // fixed container drawing width for consistent alignment
    const sidePad = 40;
    const avail = w - sidePad * 2;
    const baseGap = 6;
    // Initial bar width assumption using base gap
    let barW = weeksCount ? (avail - baseGap * (weeksCount - 1)) / weeksCount : 0;
    if (barW > 40) {
        barW = 40;
    } else if (barW < 3) {
        barW = Math.max(2, barW); // allow very narrow bars rather than introducing scroll
    }
    // Recompute gap to perfectly fill space with final barW
    const gap = weeksCount > 1 ? (avail - barW * weeksCount) / (weeksCount - 1) : 0;
    const xPosFor = (i: number) => sidePad + i * (barW + gap);
    const maxRevenue = Math.max(...weeks.map(w => w.revenue), 1);
    const usableHeight = h - pad - 70; // leave room for mean band and tooltips
    const meanY = (val: number) => (h - pad) - (val / maxRevenue) * usableHeight;

    const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
    const formatPct1 = (v: number) => (v * 100).toFixed(1) + '%';

    // Center the chart when it doesn't occupy full target width
    const centerChart = (() => {
        const weeksCountLocal = weeks.length;
        if (!weeksCountLocal) return false;
        // After width calc we know if we capped below baseMax; recalc with same formula
        // center not needed; we always use fixed width
        return false;
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
                <div className={`pb-2 overflow-visible`}>
                    <div className="relative" style={{ width: w }}>
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
                            {/* Bars (stacked campaign (purple) + flow (blue)) */}
                            {weeks.map((wk, i) => {
                                // Scope display revenues to enforce single-color bars when filtered
                                const displayCamp = scope === 'flows' ? 0 : wk.campaignRevenue;
                                const displayFlow = scope === 'campaigns' ? 0 : wk.flowRevenue;
                                const total = displayCamp + displayFlow;
                                const x = xPosFor(i);
                                const totalH = (total / maxRevenue) * usableHeight;
                                const campH = (displayCamp / maxRevenue) * usableHeight;
                                const flowH = (displayFlow / maxRevenue) * usableHeight;
                                const baseY = (h - pad) - totalH;
                                const flowY = (h - pad) - flowH; // bottom segment
                                const campY = flowY - campH; // stacked above flow
                                return (
                                    <g key={wk.label} onMouseEnter={() => onEnter(i)} onMouseLeave={onLeave} className="cursor-pointer">
                                        {/* Flows segment (blue) */}
                                        {flowH > 0 && (
                                            <rect x={x} y={flowY} width={barW} height={Math.max(2, flowH)} className="fill-[url(#flowGrad)] opacity-95 hover:opacity-100 transition-opacity shadow-sm" />
                                        )}
                                        {/* Campaigns segment (purple) */}
                                        {campH > 0 && (
                                            <rect x={x} y={campY} width={barW} height={Math.max(2, campH)} className="fill-[url(#campGrad)] opacity-95 hover:opacity-100 transition-opacity shadow-sm" />
                                        )}
                                        {/* No placeholder bars or auto labels; rely on tooltip for clarity */}
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
                                            {scope !== 'flows' && (
                                                <div className="flex justify-between"><span className="text-purple-600 dark:text-purple-300">Campaigns</span><span className="font-medium">{formatCurrency(wk.campaignRevenue)}</span></div>
                                            )}
                                            {scope !== 'campaigns' && (
                                                <div className="flex justify-between"><span className="text-indigo-600 dark:text-indigo-300">Flows</span><span className="font-medium">{formatCurrency(wk.flowRevenue)}</span></div>
                                            )}
                                            {scope === 'all' && (
                                                <div className="flex justify-between mt-1"><span className="text-gray-500 dark:text-gray-400">Campaign Share</span><span>{formatPct1(campShare)}</span></div>
                                            )}
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
                                <p className="text-gray-600 dark:text-gray-300">Reliability uses a smooth stability curve (approx exp(-CV)). Higher = steadier weekly revenue.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-gray-600 dark:text-gray-300">
                                <div className="col-span-2 font-medium text-gray-700 dark:text-gray-200">Categories</div>
                                <div>Excellent ≥85%</div>
                                <div>Good 70–84%</div>
                                <div>OK 55–69%</div>
                                <div>Attention 40–54%</div>
                                <div className="col-span-2">Critical &lt;40%</div>
                            </div>
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                                Mean {formatCurrency(stats.mean)} • Std Dev {formatCurrency(stats.std)} • Volatility {stats.volatilityDisplay}% (CV)
                            </div>
                            <div className="text-[10px] text-gray-500 dark:text-gray-400">Improve by smoothing spikes, filling send gaps, growing automated share.</div>
                        </div>
                    );
                    return (
                        <div className={`mt-6 flex flex-wrap justify-center gap-4 text-[11px]`}>
                            <StatTile label="Reliability" tooltip={reliabilityTooltip} value={`${stats.reliabilityDisplay}%`} category={stats.category} categoryColor={categoryColor} />
                            <StatTile label="Avg Weekly Revenue" tooltip="Average weekly revenue for selected scope" value={formatCurrency(stats.mean)} />
                            <StatTile label="Std Dev" tooltip="Standard deviation of weekly revenue (selected scope)" value={formatCurrency(stats.std)} />
                            {scope === 'campaigns' && stats.zeroCampaignWeeks > 0 && (
                                <StatTile label="Zero Campaign Weeks" tooltip="Weeks with no campaign sends" value={String(stats.zeroCampaignWeeks)} />
                            )}
                            {scope === 'campaigns' && stats.lostCampaignEstimate > 0 && (
                                <StatTile label="Est. Lost Camp Rev" tooltip={<span>Estimated lost campaign revenue (interpolated between surrounding non-zero weeks, capped by median; single-sided gaps decay 10% per week). Conservative vs prior method.</span>} value={formatCurrency(stats.lostCampaignEstimate)} />
                            )}
                        </div>
                    );
                })()}
                {/* Interpretation removed per request (tooltip now sufficient) */}
                <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500 dark:text-gray-400">
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
