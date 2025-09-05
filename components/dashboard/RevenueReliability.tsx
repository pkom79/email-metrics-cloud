import React, { useMemo, useState } from 'react';

// New Revenue Reliability module
// Requirements implemented:
// - Bar graph for Revenue attributed to All Emails, Campaigns, Flows
// - Segmented toggle (All / Campaigns / Flows) with active purple gradient
// - Responsive centered container (max 1100px) bars resize with bucket count
// - Trim partial leading/trailing weeks (Mon-Sun) or months; only show full buckets
// - Minimum data thresholds: monthly >= 3 full months, weekly >= 12 full weeks, daily >= 90 days
// - Show guidance message if below thresholds
// - Colors: All Emails = purple, Campaigns = blue, Flows = green
// - Placed under Email Performance Overview (invoked from DashboardHeavy)

interface SeriesPoint { value: number; date: string; iso?: string; }

export interface RevenueReliabilityProps {
    // Pre-filtered arrays passed for consistency with other modules
    campaigns: any[];
    flows: any[];
    dm: any; // DataManager instance
    dateRange: string;
    granularity: 'daily' | 'weekly' | 'monthly';
    customFrom?: string;
    customTo?: string;
}

type ViewMode = 'all' | 'campaigns' | 'flows';

export default function RevenueReliability({ campaigns, flows, dm, dateRange, granularity, customFrom, customTo }: RevenueReliabilityProps) {
    const [mode, setMode] = useState<ViewMode>('all');
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    // Build raw series (DataManager provides end-of-week iso for weekly, month label for monthly)
    const rawAll = useMemo<SeriesPoint[]>(() => (dm.getMetricTimeSeries(campaigns, flows, 'revenue', dateRange, granularity, customFrom, customTo) || []).slice(), [campaigns, flows, dm, dateRange, granularity, customFrom, customTo]);
    const rawCampaigns = useMemo<SeriesPoint[]>(() => (dm.getMetricTimeSeries(campaigns, [], 'revenue', dateRange, granularity, customFrom, customTo) || []).slice(), [campaigns, dm, dateRange, granularity, customFrom, customTo]);
    const rawFlows = useMemo<SeriesPoint[]>(() => (dm.getMetricTimeSeries([], flows, 'revenue', dateRange, granularity, customFrom, customTo) || []).slice(), [flows, dm, dateRange, granularity, customFrom, customTo]);

    // Ensure chronological order by iso (if provided)
    const sortByIso = (arr: SeriesPoint[]) => arr.sort((a, b) => (a.iso || '').localeCompare(b.iso || ''));
    sortByIso(rawAll); sortByIso(rawCampaigns); sortByIso(rawFlows);

    // Reconstruct approximate start/end boundaries used by DataManager for trimming logic
    const rangeBoundary = useMemo(() => {
        if (dateRange === 'custom' && customFrom && customTo) {
            return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
        }
        const now = new Date();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const clone = (d: Date) => new Date(d.getTime());
        const makeStart = (days: number) => { const s = clone(end); s.setDate(s.getDate() - (days - 1)); s.setHours(0, 0, 0, 0); return s; };
        switch (dateRange) {
            case '7d': return { start: makeStart(7), end };
            case '30d': return { start: makeStart(30), end };
            case '60d': return { start: makeStart(60), end };
            case '90d': return { start: makeStart(90), end };
            case '180d': return { start: makeStart(180), end };
            case '365d': return { start: makeStart(365), end };
            case 'all': {
                const allIso = rawAll.map(p => p.iso).filter(Boolean) as string[];
                if (!allIso.length) return { start: makeStart(90), end };
                let earliest = new Date(allIso[0] + 'T00:00:00');
                if (granularity === 'weekly') {
                    // earliest iso is week end (Sunday); adjust to Monday start
                    earliest = new Date(earliest); earliest.setDate(earliest.getDate() - 6);
                } else if (granularity === 'monthly') {
                    earliest = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
                }
                return { start: earliest, end };
            }
            default: return { start: makeStart(90), end };
        }
    }, [dateRange, customFrom, customTo, rawAll, granularity]);

    function mondayOf(d: Date) { const dt = new Date(d); const wd = dt.getDay(); const diff = (wd + 6) % 7; dt.setDate(dt.getDate() - diff); dt.setHours(0, 0, 0, 0); return dt; }
    function sundayOf(d: Date) { const m = mondayOf(d); const s = new Date(m); s.setDate(s.getDate() + 6); s.setHours(23, 59, 59, 999); return s; }

    // Trim partial buckets for weekly & monthly
    function trimSeries(series: SeriesPoint[]): SeriesPoint[] {
        if (!series.length) return series;
        const { start, end } = rangeBoundary;
        if (granularity === 'weekly') {
            return series.filter(p => {
                if (!p.iso) return false;
                const isoDate = new Date(p.iso + 'T00:00:00');
                const mon = new Date(isoDate); mon.setDate(mon.getDate() - 6); mon.setHours(0, 0, 0, 0);
                const sun = new Date(isoDate); sun.setHours(23, 59, 59, 999);
                return mon >= start && sun <= end;
            });
        } else if (granularity === 'monthly') {
            return series.filter(p => {
                if (!p.iso) return false;
                const first = new Date(p.iso + 'T00:00:00'); // first of month from DataManager
                const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 23, 59, 59, 999);
                return first >= start && last <= end;
            });
        }
        // daily: no trimming; threshold uses raw length
        return series;
    }

    const trimmed = useMemo(() => ({
        all: trimSeries(rawAll),
        campaigns: trimSeries(rawCampaigns),
        flows: trimSeries(rawFlows)
    }), [rawAll, rawCampaigns, rawFlows, granularity, rangeBoundary]);

    // Minimum threshold check
    // Daily uses actual span of selected date range (inclusive) rather than count of returned points
    // to avoid false negatives when some days have no data and might be omitted by DataManager.
    const meetsThreshold = useMemo(() => {
        if (granularity === 'monthly') return trimmed.all.length >= 3; // 3 full months
        if (granularity === 'weekly') return trimmed.all.length >= 12; // 12 full weeks
        if (granularity === 'daily') {
            const daySpan = Math.floor((rangeBoundary.end.getTime() - rangeBoundary.start.getTime()) / 86400000) + 1; // inclusive
            return daySpan >= 90; // 90 calendar days selected
        }
        return false;
    }, [granularity, trimmed.all.length, rangeBoundary]);

    const activeSeries = mode === 'all' ? trimmed.all : mode === 'campaigns' ? trimmed.campaigns : trimmed.flows;
    const maxVal = activeSeries.reduce((m, p) => Math.max(m, p.value), 0);

    // Layout + axes geometry
    const targetWidth = 1100;
    const leftPad = 56;
    const rightPad = 8;
    const topPad = 8;
    const bottomPad = 42;
    const innerTarget = targetWidth - leftPad - rightPad;
    const barGap = 6;
    const barCount = activeSeries.length;
    const barWidth = barCount > 0 ? Math.max(4, Math.min(36, (innerTarget - barGap * (barCount - 1)) / barCount)) : 0;
    const innerWidth = barCount > 0 ? barWidth * barCount + barGap * (barCount - 1) : innerTarget;
    const svgWidth = innerWidth + leftPad + rightPad;
    const chartHeight = 320;
    const innerHeight = chartHeight - topPad - bottomPad;

    // Y ticks
    const yTicks = useMemo(() => {
        if (maxVal <= 0) return [0];
        const desired = 5;
        const rawStep = maxVal / (desired - 1);
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / mag;
        let step: number;
        if (norm < 1.5) step = 1 * mag; else if (norm < 3.5) step = 2 * mag; else if (norm < 7.5) step = 5 * mag; else step = 10 * mag;
        const ticks: number[] = [];
        for (let v = 0; v <= maxVal * 1.001; v += step) ticks.push(v);
        if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);
        return ticks;
    }, [maxVal]);

    // X label sampling
    const xLabelStep = useMemo(() => {
        const maxLabels = 12;
        if (barCount <= maxLabels) return 1;
        return Math.ceil(barCount / maxLabels);
    }, [barCount]);

    const fillColor = mode === 'all' ? '#8b5cf6' : mode === 'campaigns' ? '#2563eb' : '#16a34a';

    return (
        <div className="mt-6">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
                <div className="px-4 py-4 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ padding: 16 }}>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Revenue Reliability</h3>
                    <div className="inline-flex rounded-lg overflow-hidden border border-purple-300 dark:border-purple-700 text-sm">
                        {(['all', 'campaigns', 'flows'] as ViewMode[]).map(v => {
                            const active = mode === v;
                            const label = v === 'all' ? 'All Emails' : v === 'campaigns' ? 'Campaigns' : 'Flows';
                            return (
                                <button
                                    key={v}
                                    onClick={() => setMode(v)}
                                    className={
                                        'px-3 py-1.5 font-medium transition-colors ' +
                                        (active
                                            ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white'
                                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-gray-700') +
                                        (v !== 'flows' ? ' border-r border-purple-300 dark:border-purple-700' : '')
                                    }
                                    style={{ fontSize: 13 }}
                                >{label}</button>
                            );
                        })}
                    </div>
                </div>
                <div className="px-4 pb-5 sm:px-6" style={{ paddingTop: 0 }}>
                    {!meetsThreshold ? (
                        <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-300">
                            {granularity === 'monthly' && <p>Select a date range that includes at least 3 full months to view Revenue Reliability.</p>}
                            {granularity === 'weekly' && <p>Select a date range that includes at least 12 full Monday–Sunday weeks to view Revenue Reliability.</p>}
                            {granularity === 'daily' && <p>Select a date range of at least 90 days to view Revenue Reliability.</p>}
                        </div>
                    ) : barCount === 0 ? (
                        <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-300">No data available for the selected filters.</div>
                    ) : (
                        <div className="overflow-x-auto relative">
                            <div className="mx-auto relative" style={{ width: Math.min(svgWidth, targetWidth) }}>
                                <svg width={Math.min(svgWidth, targetWidth)} height={chartHeight} className="block select-none">
                                    {/* Y grid & labels */}
                                    {yTicks.map((t, i) => {
                                        const h = maxVal > 0 ? (t / maxVal) * innerHeight : 0;
                                        const y = chartHeight - bottomPad - h;
                                        return (
                                            <g key={i}>
                                                <line x1={leftPad} x2={leftPad + innerWidth} y1={y} y2={y} className={i === 0 ? 'stroke-gray-300 dark:stroke-gray-700' : 'stroke-gray-200 dark:stroke-gray-800'} strokeWidth={i === 0 ? 1.2 : 1} />
                                                <text x={leftPad - 6} y={y + 4} fontSize={10} textAnchor="end" className="fill-gray-500">{formatCurrencyShort(t)}</text>
                                            </g>
                                        );
                                    })}
                                    {/* X axis */}
                                    <line x1={leftPad} x2={leftPad + innerWidth} y1={chartHeight - bottomPad} y2={chartHeight - bottomPad} className="stroke-gray-300 dark:stroke-gray-700" />
                                    {/* Bars */}
                                    {activeSeries.map((p, i) => {
                                        const h = maxVal > 0 ? (p.value / maxVal) * innerHeight : 0;
                                        const x = leftPad + i * (barWidth + barGap);
                                        const y = chartHeight - bottomPad - h;
                                        const showLabel = i % xLabelStep === 0;
                                        return (
                                            <g key={i} onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)} className="cursor-pointer">
                                                <rect x={x} y={y} width={barWidth} height={h} rx={3} fill={fillColor} />
                                                {showLabel && barWidth >= 12 && (
                                                    <text x={x + barWidth / 2} y={chartHeight - 22} textAnchor="middle" fontSize={10} className="fill-gray-600 dark:fill-gray-400">{p.date}</text>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                                {hoverIndex !== null && activeSeries[hoverIndex] && (
                                    <div className="pointer-events-none absolute inset-0" style={{ width: Math.min(svgWidth, targetWidth) }}>
                                        {(() => {
                                            const p = activeSeries[hoverIndex];
                                            const x = leftPad + hoverIndex * (barWidth + barGap) + barWidth / 2;
                                            const h = maxVal > 0 ? (p.value / maxVal) * innerHeight : 0;
                                            const y = chartHeight - bottomPad - h - 8;
                                            const rangeLabel = buildRangeLabel(p, granularity);
                                            return (
                                                <div style={{ position: 'absolute', transform: `translateX(${Math.min(Math.max(0, x - 110), (Math.min(svgWidth, targetWidth)) - 220)}px) translateY(${Math.max(0, y - 70)}px)` }} className="w-56 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-3 text-[11px] leading-snug text-gray-700 dark:text-gray-200">
                                                    <div className="font-medium mb-1">{rangeLabel}</div>
                                                    <div className="flex justify-between"><span>Revenue</span><span className="font-semibold">{formatCurrencyFull(p.value)}</span></div>
                                                    {mode === 'all' && <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">All Emails (Campaigns + Flows)</div>}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatCurrencyShort(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    return `$${Math.round(v).toLocaleString('en-US')}`;
}

function formatCurrencyFull(v: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function buildRangeLabel(p: SeriesPoint, granularity: 'daily' | 'weekly' | 'monthly'): string {
    if (!p.iso) return p.date;
    const d = new Date(p.iso + 'T00:00:00');
    if (granularity === 'daily') {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else if (granularity === 'weekly') {
        const end = d; // iso is week end
        const start = new Date(end); start.setDate(start.getDate() - 6);
        return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else { // monthly
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
}
