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

interface SeriesPoint { value: number; date: string; iso?: string; endIso?: string; clusterSize?: number; }

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
        // Always respect explicit picker values if both provided (even when dateRange is 'all' or preset)
        if (customFrom && customTo) {
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

    // Build full bucket sequences (zero-filling) so we never skip days/weeks/months with zero revenue.
    const fullBuckets = useMemo(() => {
        const dateToISO = (d: Date) => d.toISOString().slice(0, 10);
        const { start, end } = rangeBoundary;

        // Maps from iso -> value for existing data
        const mapFrom = (arr: SeriesPoint[]) => {
            const m = new Map<string, number>();
            for (const p of arr) if (p.iso) m.set(p.iso, p.value);
            return m;
        };
        const mapAll = mapFrom(rawAll);
        const mapCamp = mapFrom(rawCampaigns);
        const mapFlows = mapFrom(rawFlows);

        const all: SeriesPoint[] = [];
        const campaignsSeries: SeriesPoint[] = [];
        const flowsSeries: SeriesPoint[] = [];

        if (granularity === 'daily') {
            // Adaptive clustering for long ranges; widen cluster size progressively (up to 14 days) so chart stays within width.
            const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
            const endDay = new Date(end); endDay.setHours(0, 0, 0, 0);
            const totalDays = Math.floor((endDay.getTime() - startDay.getTime()) / 86400000) + 1;
            const MAX_BARS = 120;
            const maxClusterAllowed = totalDays > 1200 ? 14 : totalDays > 600 ? 10 : totalDays > 365 ? 7 : 5;
            let clusterSize = 1;
            if (totalDays > MAX_BARS) {
                clusterSize = Math.ceil(totalDays / MAX_BARS);
                if (clusterSize < 2) clusterSize = 2;
                if (clusterSize > maxClusterAllowed) clusterSize = maxClusterAllowed;
            }
            for (let offset = 0; offset < totalDays; offset += clusterSize) {
                const cStart = new Date(startDay); cStart.setDate(cStart.getDate() + offset);
                let cEnd = new Date(cStart); cEnd.setDate(cEnd.getDate() + clusterSize - 1);
                if (cEnd > endDay) cEnd = new Date(endDay);
                let sumAll = 0, sumCamp = 0, sumFlows = 0;
                for (let d = new Date(cStart); d <= cEnd; d.setDate(d.getDate() + 1)) {
                    const iso = dateToISO(d);
                    sumAll += mapAll.get(iso) ?? 0;
                    sumCamp += mapCamp.get(iso) ?? 0;
                    sumFlows += mapFlows.get(iso) ?? 0;
                }
                const startIso = dateToISO(cStart);
                const endIso = dateToISO(cEnd);
                const label = cStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const base = { iso: startIso, endIso, date: label, clusterSize };
                all.push({ ...base, value: sumAll });
                campaignsSeries.push({ ...base, value: sumCamp });
                flowsSeries.push({ ...base, value: sumFlows });
            }
        } else if (granularity === 'weekly') {
            // Only FULL in-range Monday-Sunday weeks
            let firstMon = mondayOf(start);
            if (firstMon < start) firstMon.setDate(firstMon.getDate() + 7);
            let lastSun = sundayOf(end);
            if (lastSun > end) lastSun.setDate(lastSun.getDate() - 7);
            for (let wkStart = new Date(firstMon); wkStart <= lastSun; wkStart.setDate(wkStart.getDate() + 7)) {
                const weekEnd = new Date(wkStart); weekEnd.setDate(weekEnd.getDate() + 6);
                const iso = dateToISO(weekEnd);
                const label = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                all.push({ iso, date: label, value: mapAll.get(iso) ?? 0 });
                campaignsSeries.push({ iso, date: label, value: mapCamp.get(iso) ?? 0 });
                flowsSeries.push({ iso, date: label, value: mapFlows.get(iso) ?? 0 });
            }
        } else if (granularity === 'monthly') {
            // Only full months fully contained in range
            let first = new Date(start.getFullYear(), start.getMonth(), 1);
            if (first < start) first = new Date(first.getFullYear(), first.getMonth() + 1, 1); // start month partial -> next month
            let last = new Date(end.getFullYear(), end.getMonth(), 1);
            const lastMonthEnd = new Date(last.getFullYear(), last.getMonth() + 1, 0, 23, 59, 59, 999);
            if (lastMonthEnd > end) last = new Date(last.getFullYear(), last.getMonth() - 1, 1); // end month partial -> previous month
            for (let m = new Date(first); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
                const iso = dateToISO(m); // first of month
                const label = m.toLocaleDateString('en-US', { month: 'short' });
                all.push({ iso, date: label, value: mapAll.get(iso) ?? 0 });
                campaignsSeries.push({ iso, date: label, value: mapCamp.get(iso) ?? 0 });
                flowsSeries.push({ iso, date: label, value: mapFlows.get(iso) ?? 0 });
            }
        }

        return { all, campaigns: campaignsSeries, flows: flowsSeries };
    }, [granularity, rangeBoundary, rawAll, rawCampaigns, rawFlows]);

    // Minimum threshold check
    // Daily uses actual span of selected date range (inclusive) rather than count of returned points
    // to avoid false negatives when some days have no data and might be omitted by DataManager.
    const meetsThreshold = useMemo(() => {
        if (granularity === 'monthly') return fullBuckets.all.length >= 3; // 3 full months
        if (granularity === 'weekly') return fullBuckets.all.length >= 12; // 12 full weeks
        if (granularity === 'daily') {
            const daySpan = Math.floor((rangeBoundary.end.getTime() - rangeBoundary.start.getTime()) / 86400000) + 1; // inclusive
            return daySpan >= 90; // 90 calendar days selected
        }
        return false;
    }, [granularity, fullBuckets.all.length, rangeBoundary]);
    const activeSeries = mode === 'all' ? fullBuckets.all : mode === 'campaigns' ? fullBuckets.campaigns : fullBuckets.flows;
    const maxVal = activeSeries.reduce((m, p) => Math.max(m, p.value), 0);

    // Layout + axes geometry
    const targetWidth = 1100;
    const leftPad = 56;
    const rightPad = 8;
    const topPad = 8;
    const bottomPad = 42;
    const innerTarget = targetWidth - leftPad - rightPad;
    const barGap = 6; // clustering ensures count manageable
    const barCount = activeSeries.length;
    const barWidth = barCount > 0 ? Math.max(2, Math.min(36, (innerTarget - barGap * (barCount - 1)) / barCount)) : 0;
    const innerWidth = barCount > 0 ? barWidth * barCount + barGap * (barCount - 1) : innerTarget;
    const svgWidth = innerWidth + leftPad + rightPad;
    const chartHeight = 320;
    const innerHeight = chartHeight - topPad - bottomPad;

    // Unified nice scaling (avoids mismatch between grid & bar heights)
    const { yTicks, scaleMax } = useMemo(() => {
        if (maxVal <= 0) return { yTicks: [0], scaleMax: 0 };
        const desired = 5; // target tick count (approx)
        const rawStep = maxVal / (desired - 1);
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / mag;
        let step: number;
        if (norm < 1.5) step = 1 * mag; else if (norm < 3) step = 2 * mag; else if (norm < 7.5) step = 5 * mag; else step = 10 * mag;
        let top = Math.ceil(maxVal / step) * step;
        // Reduce excessive overshoot (>20% above data max) by stepping down once if safe.
        if (top / maxVal > 1.2 && top - step >= maxVal) top -= step;
        const ticks: number[] = [];
        for (let v = 0; v <= top + 0.0001; v += step) ticks.push(v);
        return { yTicks: ticks, scaleMax: top };
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
                        <div className="relative">
                            <div className="mx-auto relative" style={{ width: Math.min(svgWidth, targetWidth) }}>
                                <svg width={Math.min(svgWidth, targetWidth)} height={chartHeight} className="block select-none">
                                    {/* Y grid & labels */}
                                    {yTicks.map((t, i) => {
                                        const h = scaleMax > 0 ? (t / scaleMax) * innerHeight : 0;
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
                                        const hRaw = scaleMax > 0 ? (p.value / scaleMax) * innerHeight : 0;
                                        const h = p.value === 0 ? Math.max(1, hRaw) : hRaw; // ensure hit area for zero value
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
                                            const h = scaleMax > 0 ? (p.value / scaleMax) * innerHeight : 0;
                                            const y = chartHeight - bottomPad - h - 8;
                                            const rangeLabel = buildRangeLabel(p, granularity);
                                            return (
                                                <div style={{ position: 'absolute', transform: `translateX(${Math.min(Math.max(0, x - 110), (Math.min(svgWidth, targetWidth)) - 220)}px) translateY(${Math.max(0, y - 70)}px)` }} className="w-56 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-3 text-[11px] leading-snug text-gray-700 dark:text-gray-200">
                                                    <div className="font-medium mb-1">{rangeLabel}</div>
                                                    <div className="flex justify-between"><span>Revenue</span><span className="font-semibold">{formatCurrencyFull(p.value)}</span></div>
                                                    {granularity === 'daily' && p.clusterSize && p.clusterSize > 1 && <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">{p.clusterSize}-day cluster</div>}
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
    if (v >= 1_000_000) {
        const m = v / 1_000_000;
        const txt = (Math.abs(m - Math.round(m)) < 0.05) ? m.toFixed(0) : m.toFixed(1);
        return `$${txt}M`;
    }
    if (v >= 1_000) {
        const k = v / 1_000;
        const txt = (Math.abs(k - Math.round(k)) < 0.05) ? k.toFixed(0) : k.toFixed(1);
        return `$${txt}k`;
    }
    return `$${Math.round(v).toLocaleString('en-US')}`;
}

function formatCurrencyFull(v: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function buildRangeLabel(p: SeriesPoint, granularity: 'daily' | 'weekly' | 'monthly'): string {
    if (!p.iso) return p.date;
    const startDate = new Date(p.iso + 'T00:00:00');
    if (granularity === 'daily') {
        if (p.endIso && p.endIso !== p.iso) {
            const endDate = new Date(p.endIso + 'T00:00:00');
            return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }
        return startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else if (granularity === 'weekly') {
        const end = startDate; // iso is week end
        const s = new Date(end); s.setDate(s.getDate() - 6);
        return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else { // monthly
        return startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
}
