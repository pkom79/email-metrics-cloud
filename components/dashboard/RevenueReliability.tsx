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

    // Build raw series (DataManager provides end-of-week iso for weekly, month label for monthly)
    const rawAll = useMemo<SeriesPoint[]>(() => dm.getMetricTimeSeries(campaigns, flows, 'revenue', dateRange, granularity, customFrom, customTo) || [], [campaigns, flows, dm, dateRange, granularity, customFrom, customTo]);
    const rawCampaigns = useMemo<SeriesPoint[]>(() => dm.getMetricTimeSeries(campaigns, [], 'revenue', dateRange, granularity, customFrom, customTo) || [], [campaigns, dm, dateRange, granularity, customFrom, customTo]);
    const rawFlows = useMemo<SeriesPoint[]>(() => dm.getMetricTimeSeries([], flows, 'revenue', dateRange, granularity, customFrom, customTo) || [], [flows, dm, dateRange, granularity, customFrom, customTo]);

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
                // Fallback: use earliest record among series
                const allIso = [...rawAll].map(p => p.iso).filter(Boolean) as string[];
                const earliest = allIso.length ? new Date(allIso[0]) : makeStart(90);
                return { start: earliest, end };
            }
            default: return { start: makeStart(90), end };
        }
    }, [dateRange, customFrom, customTo, rawAll]);

    function mondayOf(d: Date) { const dt = new Date(d); const wd = dt.getDay(); const diff = (wd + 6) % 7; dt.setDate(dt.getDate() - diff); dt.setHours(0, 0, 0, 0); return dt; }
    function sundayOf(d: Date) { const m = mondayOf(d); const s = new Date(m); s.setDate(s.getDate() + 6); s.setHours(23, 59, 59, 999); return s; }

    // Trim partial buckets for weekly & monthly
    function trimSeries(series: SeriesPoint[]): SeriesPoint[] {
        if (!series.length) return series;
        const { start, end } = rangeBoundary;
        if (granularity === 'weekly') {
            // iso value is end-of-week (Sunday). Derive Monday by subtract 6 days.
            const full: SeriesPoint[] = [];
            for (const p of series) {
                const iso = p.iso ? new Date(p.iso + 'T00:00:00') : null;
                if (!iso) continue;
                const mon = new Date(iso); mon.setDate(mon.getDate() - 6); mon.setHours(0, 0, 0, 0);
                const sun = new Date(iso); sun.setHours(23, 59, 59, 999);
                if (mon < start) continue; // leading partial
                if (sun > end) continue;   // trailing partial
                full.push(p);
            }
            return full;
        } else if (granularity === 'monthly') {
            const full: SeriesPoint[] = [];
            for (const p of series) {
                // label like "Aug 24" (month + yy) from DataManager; we rely on iso if provided
                const iso = p.iso ? new Date(p.iso + 'T00:00:00') : null; // first of month
                if (!iso) continue;
                const firstDay = new Date(iso.getFullYear(), iso.getMonth(), 1, 0, 0, 0, 0);
                const lastDay = new Date(iso.getFullYear(), iso.getMonth() + 1, 0, 23, 59, 59, 999);
                if (firstDay < mondayOf(rangeBoundary.start) && rangeBoundary.start > firstDay) continue; // partial leading month
                if (lastDay > rangeBoundary.end) continue; // partial trailing month
                full.push(p);
            }
            return full;
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
    const meetsThreshold = useMemo(() => {
        if (granularity === 'monthly') return trimmed.all.length >= 3; // 3 full months
        if (granularity === 'weekly') return trimmed.all.length >= 12; // 12 full weeks
        if (granularity === 'daily') return rawAll.length >= 90;       // 90 days
        return false;
    }, [granularity, trimmed, rawAll.length]);

    const activeSeries = mode === 'all' ? trimmed.all : mode === 'campaigns' ? trimmed.campaigns : trimmed.flows;
    const maxVal = activeSeries.reduce((m, p) => Math.max(m, p.value), 0);

    // Layout calcs
    const targetWidth = 1100;
    const barGap = 6;
    const barCount = activeSeries.length;
    const barWidth = barCount > 0 ? Math.max(4, Math.min(40, (targetWidth - barGap * (barCount - 1)) / barCount)) : 0;
    const chartWidth = barCount > 0 ? barWidth * barCount + barGap * (barCount - 1) : targetWidth;
    const chartHeight = 280; // fixed height

    const gradientId = mode === 'all' ? 'gradAll' : mode === 'campaigns' ? 'gradCampaigns' : 'gradFlows';

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
                        <div className="overflow-x-auto">
                            <div className="mx-auto" style={{ width: Math.min(chartWidth, targetWidth) }}>
                                <svg width={Math.min(chartWidth, targetWidth)} height={chartHeight} className="block">
                                    <defs>
                                        <linearGradient id="gradAll" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a855f7" /><stop offset="100%" stopColor="#7e22ce" /></linearGradient>
                                        <linearGradient id="gradCampaigns" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#2563eb" /></linearGradient>
                                        <linearGradient id="gradFlows" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#22c55e" /><stop offset="100%" stopColor="#15803d" /></linearGradient>
                                    </defs>
                                    {activeSeries.map((p, i) => {
                                        const h = maxVal > 0 ? (p.value / maxVal) * (chartHeight - 40) : 0;
                                        const x = i * (barWidth + barGap);
                                        const y = chartHeight - h - 20;
                                        return (
                                            <g key={i}>
                                                <rect x={x} y={y} width={barWidth} height={h} rx={3} className="transition-opacity" fill={`url(#${gradientId})`} />
                                                {barWidth >= 20 && (
                                                    <text x={x + barWidth / 2} y={chartHeight - 6} textAnchor="middle" fontSize={10} className="fill-gray-600 dark:fill-gray-400 select-none">{p.date}</text>
                                                )}
                                                {h > 22 && barWidth >= 24 && (
                                                    <text x={x + barWidth / 2} y={y + 14} textAnchor="middle" fontSize={11} className="fill-white font-medium select-none">{formatCurrencyShort(p.value)}</text>
                                                )}
                                            </g>
                                        );
                                    })}
                                    {/* Y-axis labels (simple 0 / max) */}
                                    <text x={0} y={chartHeight - 8} fontSize={10} className="fill-gray-500">0</text>
                                    <text x={0} y={12} fontSize={10} className="fill-gray-500">{formatCurrencyShort(maxVal)}</text>
                                </svg>
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
