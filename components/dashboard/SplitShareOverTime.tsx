"use client";
import React, { useMemo, useState } from 'react';
import { SplitSquareVertical } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';
import { ProcessedCampaign } from '../../lib/data/dataTypes';

type Gran = 'daily' | 'weekly' | 'monthly';
type CompareMode = 'prev-period' | 'prev-year';

interface Props {
    dateRange: string;
    granularity: Gran;
    customFrom?: string;
    customTo?: string;
    compareMode?: CompareMode;
    filteredCampaigns?: ProcessedCampaign[];
    dateRangeBoundaries?: { start: Date; end: Date } | null;
}

type Metric = 'revenue' | 'emailsSent';

const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const formatNumber = (v: number) => Math.round(v).toLocaleString('en-US');

export default function SplitShareOverTime({ dateRange, granularity, customFrom, customTo, compareMode = 'prev-period', filteredCampaigns, dateRangeBoundaries }: Props) {
    const dm = DataManager.getInstance();
    const [metric, setMetric] = useState<Metric>('revenue');

    const campaigns = filteredCampaigns || dm.getCampaigns();
    const flows = dm.getFlowEmails();

    // When using filteredCampaigns with provided boundaries, use those boundaries directly
    // This prevents DataManager from applying additional date filtering on pre-filtered data
    const { effectiveDateRange, effectiveCustomFrom, effectiveCustomTo } = useMemo(() => {
        if (!filteredCampaigns || !dateRangeBoundaries) {
            return { effectiveDateRange: dateRange, effectiveCustomFrom: customFrom, effectiveCustomTo: customTo };
        }

        // Use the exact boundaries that DashboardHeavy used for filtering
        const customFromISO = dateRangeBoundaries.start.toISOString().slice(0, 10);
        const customToISO = dateRangeBoundaries.end.toISOString().slice(0, 10);

        return {
            effectiveDateRange: 'custom',
            effectiveCustomFrom: customFromISO,
            effectiveCustomTo: customToISO
        };
    }, [filteredCampaigns, dateRangeBoundaries, dateRange, customFrom, customTo]);

    const series = useMemo(() => {
        // Debug: Show what Campaign vs Flow Split sees
        const july2025Campaigns = campaigns.filter(c => c.sentDate.getFullYear() === 2025 && c.sentDate.getMonth() === 6);
        console.log('📊 CAMPAIGN vs FLOW SPLIT DATA:', {
            totalCampaigns: campaigns.length,
            july2025Count: july2025Campaigns.length,
            july2025Dates: july2025Campaigns.map(c => c.sentDate.toISOString().slice(0, 10)),
            filteredCampaignsProvided: !!filteredCampaigns,
            filteredCampaignsLength: filteredCampaigns?.length || 0,
            usingFiltered: campaigns === filteredCampaigns,
            usingUnfiltered: campaigns === dm.getCampaigns()
        });

        // Build campaign-only and flow-only series with compare; always aggregate all flows
        console.log('📊 Calling getMetricTimeSeriesWithCompare with:', {
            campaignCount: campaigns.length,
            dateRange,
            effectiveDateRange,
            effectiveCustomFrom,
            effectiveCustomTo,
            granularity,
            metric,
            campaignsReference: campaigns === dm.getCampaigns() ? 'SAME_REF' : 'DIFFERENT_REF'
        });
        const camp = dm.getMetricTimeSeriesWithCompare(campaigns as any, [], metric, effectiveDateRange, granularity, compareMode, effectiveCustomFrom, effectiveCustomTo);
        const flo = dm.getMetricTimeSeriesWithCompare([], flows as any, metric, effectiveDateRange, granularity, compareMode, effectiveCustomFrom, effectiveCustomTo);
        const primaryLen = Math.min(camp.primary.length, flo.primary.length);

        // Compute date boundaries for detecting incomplete weeks
        let rangeStart: Date | null = null;
        let rangeEnd: Date | null = null;
        if (effectiveDateRange === 'custom' && effectiveCustomFrom && effectiveCustomTo) {
            rangeStart = new Date(effectiveCustomFrom + 'T00:00:00');
            rangeEnd = new Date(effectiveCustomTo + 'T23:59:59');
        }

        const items = [] as {
            label: string;
            // Anchor ISO date for accurate tooltip formatting (provided by DataManager)
            iso?: string | null;
            rangeLabel?: string; // Explicit range label (e.g., "Nov 3–9, 2024")
            isIncomplete?: boolean; // True if this is a partial week/month
            campVal: number; flowVal: number; total: number;
            campPct: number; flowPct: number;
            cmpCampVal?: number; cmpFlowVal?: number; cmpTotal?: number;
            cmpCampPct?: number; cmpFlowPct?: number;
            cmpLabel?: string; cmpIso?: string | null;
            cmpRangeLabel?: string;
            cmpIsIncomplete?: boolean;
        }[];

        for (let i = 0; i < primaryLen; i++) {
            const c = camp.primary[i]?.value ?? 0;
            const f = flo.primary[i]?.value ?? 0;
            const total = c + f;
            const campPct = total > 0 ? (c / total) * 100 : 0;
            const flowPct = total > 0 ? (f / total) * 100 : 0;
            const label = camp.primary[i]?.date || flo.primary[i]?.date || '';
            // Prefer ISO from either series (exists in DataManager output even if not typed)
            const iso = (camp.primary[i] as any)?.iso || (flo.primary[i] as any)?.iso || null;

            // Generate explicit range label for weekly granularity
            let rangeLabel: string | undefined = undefined;
            let isIncomplete = false;
            if (granularity === 'weekly' && iso) {
                const d = new Date(iso);
                if (!isNaN(d.getTime())) {
                    const boundaries = dm.getWeekBoundaries(d);
                    rangeLabel = boundaries.rangeLabel;
                    console.log('🏷️ Generated rangeLabel:', { iso, rangeLabel, label, monday: boundaries.monday.toISOString().slice(0,10), sunday: boundaries.sunday.toISOString().slice(0,10) });
                    // Check if this week is incomplete (first or last in range)
                    if (rangeStart && rangeEnd) {
                        isIncomplete = !boundaries.isCompleteWeek(rangeStart, rangeEnd);
                    }
                }
            } else {
                console.log('⚠️ NOT generating rangeLabel:', { granularity, iso, hasIso: !!iso });
            }

            const row: any = { label, iso, rangeLabel, isIncomplete, campVal: c, flowVal: f, total, campPct, flowPct };

            if (camp.compare && flo.compare) {
                const cc = camp.compare[i]?.value ?? 0;
                const ff = flo.compare[i]?.value ?? 0;
                const t = cc + ff;
                row.cmpCampVal = cc; row.cmpFlowVal = ff; row.cmpTotal = t;
                row.cmpCampPct = t > 0 ? (cc / t) * 100 : 0;
                row.cmpFlowPct = t > 0 ? (ff / t) * 100 : 0;
                row.cmpLabel = camp.compare[i]?.date || flo.compare[i]?.date || undefined;
                row.cmpIso = (camp.compare[i] as any)?.iso || (flo.compare[i] as any)?.iso || null;

                // Generate compare range label
                if (granularity === 'weekly' && row.cmpIso) {
                    const cmpDate = new Date(row.cmpIso);
                    if (!isNaN(cmpDate.getTime())) {
                        const cmpBoundaries = dm.getWeekBoundaries(cmpDate);
                        row.cmpRangeLabel = cmpBoundaries.rangeLabel;
                        // Compare period doesn't need incomplete detection (it's historical)
                    }
                }
            }
            items.push(row);
        }
        return items;
    }, [dm, campaigns, flows, metric, effectiveDateRange, effectiveCustomFrom, effectiveCustomTo, granularity, compareMode]);

    if (!campaigns.length && !flows.length) return null;

    // Chart dimensions
    const VIEW_W = 850;
    const VIEW_H = 160;
    const PADDING_L = 30;
    const PADDING_R = 20;
    const innerW = VIEW_W - PADDING_L - PADDING_R;
    const barGap = 2;
    const barW = series.length > 0 ? Math.max(2, Math.floor((innerW - (series.length - 1) * barGap) / series.length)) : 0;

    const valueFormatter = (v: number) => (metric === 'revenue' ? formatCurrency(v) : formatNumber(v));

    return (
        <div className="mt-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"><SplitSquareVertical className="w-5 h-5 text-purple-600" /> Campaign vs Flow Split Over Time</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Metric:</span>
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => setMetric('revenue')} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${metric === 'revenue' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Revenue</button>
                            <button onClick={() => setMetric('emailsSent')} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${metric === 'emailsSent' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Emails Sent</button>
                        </div>
                    </div>
                </div>
                {series.length === 0 ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">No data for the selected range.</div>
                ) : (
                    <BarShareChart
                        data={series}
                        barW={barW}
                        barGap={barGap}
                        viewW={VIEW_W}
                        viewH={VIEW_H}
                        paddingL={PADDING_L}
                        paddingR={PADDING_R}
                        valueFormatter={valueFormatter}
                        showCompare={Boolean(series[0]?.cmpCampPct != null)}
                        metric={metric}
                        granularity={granularity}
                    />
                )}
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-indigo-600" /><span>Campaigns</span></div>
                    <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /><span>Flows</span></div>
                </div>
            </div>
        </div>
    );
}

function BarShareChart({
    data,
    barW,
    barGap,
    viewW,
    viewH,
    paddingL,
    paddingR,
    valueFormatter,
    showCompare,
    metric,
    granularity,
}: {
    data: { label: string; iso?: string | null; rangeLabel?: string; isIncomplete?: boolean; campVal: number; flowVal: number; total: number; campPct: number; flowPct: number; cmpCampVal?: number; cmpFlowVal?: number; cmpTotal?: number; cmpCampPct?: number; cmpFlowPct?: number; cmpLabel?: string; cmpIso?: string | null; cmpRangeLabel?: string; cmpIsIncomplete?: boolean; }[];
    barW: number; barGap: number; viewW: number; viewH: number; paddingL: number; paddingR: number;
    valueFormatter: (v: number) => string; showCompare: boolean; metric: Metric; granularity: Gran;
}) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const H = 120; // drawing height inside viewBox
    const innerW = viewW - paddingL - paddingR;

    const xFor = (i: number) => paddingL + i * (barW + barGap);
    const yForPct = (pct: number) => Math.max(0, H - (pct / 100) * H);

    const active = hoverIdx != null ? data[hoverIdx] : null;

    return (
        <div className="relative" role="img" aria-label="Campaign vs Flow split over time">
            <svg width="100%" viewBox={`0 0 ${viewW} ${H + 40}`} className="block select-none" aria-label="Campaign vs Flow Split Over Time">
                {/* 50% guide removed by request */}
                {/* bars */}
                {data.map((d, i) => {
                    const x = xFor(i);
                    const hCamp = Math.max(0, (d.campPct / 100) * H);
                    const hFlow = Math.max(0, (d.flowPct / 100) * H);
                    const yCamp = yForPct(d.campPct);
                    const yFlow = yCamp - hFlow; // flow stacked above campaigns
                    return (
                        <g key={i}>
                            {/* campaigns segment (bottom) */}
                            <rect x={x} y={yCamp} width={barW} height={hCamp} fill="#6366F1" rx={1} />
                            {/* flows segment (top) */}
                            <rect x={x} y={yFlow} width={barW} height={hFlow} fill="#10B981" rx={1} />
                            {/* hover zone */}
                            <rect x={x} y={0} width={barW} height={H + 30} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
                        </g>
                    );
                })}
                {/* x-axis labels (sparse: ~6 ticks) */}
                {(() => {
                    const count = Math.min(6, data.length);
                    const nodes: React.ReactNode[] = [];
                    for (let i = 0; i < count; i++) {
                        const idx = Math.round((i / (count - 1)) * (data.length - 1));
                        const x = xFor(idx) + barW / 2;
                        nodes.push(<text key={i} x={x} y={H + 18} textAnchor="middle" fontSize={11} className="fill-gray-600 dark:fill-gray-400">{data[idx].label}</text>);
                    }
                    return nodes;
                })()}
            </svg>

            {active && (
                <div className="pointer-events-none absolute z-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700" style={{
                    left: `${((xFor(hoverIdx!) + barW / 2) / viewW) * 100}%`,
                    top: `${((yForPct(0)) / (H + 40)) * 100}%`,
                    transform: 'translate(-50%, 0)'
                }}>
                    <div className="font-medium mb-1 text-gray-900 dark:text-gray-100">
                        {(() => {
                            console.log('📍 Tooltip rendering:', { rangeLabel: active.rangeLabel, iso: active.iso, label: active.label, hasRangeLabel: !!active.rangeLabel });
                            if (active.rangeLabel) return active.rangeLabel;
                            // Use ISO anchor from DataManager when available to avoid parsing short labels (e.g., "Oct 01" -> year 2001)
                            const baseIso = active.iso;
                            if (baseIso) {
                                const d = new Date(baseIso);
                                if (!isNaN(d.getTime())) {
                                    if (granularity === 'daily') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                    if (granularity === 'monthly') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                                    // weekly: iso represents week end; compute Monday start
                                    const day = d.getDay();
                                    const diffToMon = day === 0 ? -6 : (1 - day);
                                    const mon = new Date(d); mon.setDate(mon.getDate() + diffToMon);
                                    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
                                    const start = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                    const sameMonth = mon.getMonth() === sun.getMonth();
                                    return sameMonth
                                        ? `${start}–${sun.getDate()}, ${sun.getFullYear()}`
                                        : `${start}–${sun.toLocaleDateString('en-US', { month: 'short' })} ${sun.getDate()}, ${sun.getFullYear()}`;
                                }
                            }
                            // Fallback to parsing label (legacy) if iso not available
                            const s = active.label;
                            const d = new Date(s);
                            if (granularity === 'daily') return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            if (granularity === 'monthly') return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                            if (isNaN(d.getTime())) return s;
                            const day = d.getDay();
                            const diffToMon = day === 0 ? -6 : (1 - day);
                            const mon = new Date(d); mon.setDate(mon.getDate() + diffToMon);
                            const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
                            const start = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const sameMonth = mon.getMonth() === sun.getMonth();
                            return sameMonth ? `${start}–${sun.getDate()}, ${sun.getFullYear()}` : `${start}–${sun.toLocaleDateString('en-US', { month: 'short' })} ${sun.getDate()}, ${sun.getFullYear()}`;
                        })()}
                        {active.isIncomplete && <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">• Incomplete week</span>}
                    </div>
                    <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 items-center">
                        <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#6366F1' }} /> Campaigns</div>
                        <div className="tabular-nums text-right">{active.campPct.toFixed(1)}% • {valueFormatter(active.campVal)}</div>
                        <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#10B981' }} /> Flows</div>
                        <div className="tabular-nums text-right">{active.flowPct.toFixed(1)}% • {valueFormatter(active.flowVal)}</div>
                        <div className="text-gray-500 col-span-2 border-t border-gray-200 dark:border-gray-700 mt-1 pt-1">Total: {valueFormatter(active.total)}</div>
                    </div>
                    {showCompare && typeof active.cmpCampPct === 'number' && typeof active.cmpFlowPct === 'number' && (
                        <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-700">
                            <div className="font-semibold mb-0.5 text-gray-900 dark:text-gray-100">
                                {active.cmpRangeLabel || (() => {
                                    // Prefer compare ISO when available
                                    const cmpIso = active.cmpIso;
                                    if (cmpIso) {
                                        const d = new Date(cmpIso);
                                        if (!isNaN(d.getTime())) {
                                            if (granularity === 'daily') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                            if (granularity === 'monthly') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                                            const day = d.getDay();
                                            const diffToMon = day === 0 ? -6 : (1 - day);
                                            const mon = new Date(d); mon.setDate(mon.getDate() + diffToMon);
                                            const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
                                            const start = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                            const sameMonth = mon.getMonth() === sun.getMonth();
                                            return sameMonth
                                                ? `${start}–${sun.getDate()}, ${sun.getFullYear()}`
                                                : `${start}–${sun.toLocaleDateString('en-US', { month: 'short' })} ${sun.getDate()}, ${sun.getFullYear()}`;
                                        }
                                    }
                                    // Fallback to label if no iso
                                    const s = active.cmpLabel || active.label;
                                    const d = new Date(s);
                                    if (granularity === 'daily') return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                    if (granularity === 'monthly') return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                                    if (isNaN(d.getTime())) return s;
                                    const day = d.getDay();
                                    const diffToMon = day === 0 ? -6 : (1 - day);
                                    const mon = new Date(d); mon.setDate(mon.getDate() + diffToMon);
                                    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
                                    const start = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                    const sameMonth = mon.getMonth() === sun.getMonth();
                                    return sameMonth ? `${start}–${sun.getDate()}, ${sun.getFullYear()}` : `${start}–${sun.toLocaleDateString('en-US', { month: 'short' })} ${sun.getDate()}, ${sun.getFullYear()}`;
                                })()}
                            </div>
                            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 items-center">
                                <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#6366F1' }} /> Campaigns</div>
                                <div className="tabular-nums text-right">{active.cmpCampPct!.toFixed(1)}% • {valueFormatter(active.cmpCampVal || 0)}</div>
                                <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#10B981' }} /> Flows</div>
                                <div className="tabular-nums text-right">{active.cmpFlowPct!.toFixed(1)}% • {valueFormatter(active.cmpFlowVal || 0)}</div>
                                <div className="text-gray-500 col-span-2">Total: {valueFormatter(active.cmpTotal || 0)}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
