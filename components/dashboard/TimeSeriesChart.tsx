"use client";
import React, { useMemo, useState } from 'react';
import SelectBase from "../ui/SelectBase";

type Granularity = 'daily' | 'weekly' | 'monthly';
type CompareMode = 'prev-period' | 'prev-year';

export type MetricKey = 'revenue' | 'avgOrderValue' | 'revenuePerEmail' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'emailsSent' | 'totalOrders' | 'conversionRate' | 'unsubscribeRate' | 'spamRate' | 'bounceRate';

export interface SeriesPoint { value: number; date: string }

export interface TimeSeriesChartProps {
    title: string;
    metricKey: MetricKey;
    metricOptions: { value: MetricKey; label: string }[];
    onMetricChange?: (m: MetricKey) => void;
    bigValue: string; // already formatted to mirror Metric Cards
    primary: SeriesPoint[];
    compare?: SeriesPoint[] | null; // null = none; [] = allow holes
    colorHue?: string; // hex like #8b5cf6
    darkColorHue?: string; // hex variant for dark, fallback to colorHue
    valueType: 'currency' | 'number' | 'percentage';
    granularity: Granularity;
    // Decorative options
    idSuffix?: string; // to make gradient IDs deterministic
}

// Formatters mirror Metric Cards
const fmt = {
    currency: (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v),
    percentage: (v: number) => `${v.toFixed(1)}%`,
    number: (v: number) => Math.round(v).toLocaleString('en-US')
};

export default function TimeSeriesChart({ title, metricKey, metricOptions, onMetricChange, bigValue, primary, compare = null, colorHue = '#8b5cf6', darkColorHue, valueType, granularity, idSuffix = 'tsc' }: TimeSeriesChartProps) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const width = 850; const height = 200; const innerH = 140; const padLeft = 48; const padRight = 20; const innerW = width - padLeft - padRight;

    const maxVal = useMemo(() => Math.max(1, ...primary.map(p => p.value)), [primary]);
    const xScale = (i: number) => primary.length <= 1 ? padLeft + innerW / 2 : padLeft + (i / (primary.length - 1)) * innerW;
    const yScale = (v: number) => {
        const y = innerH - (Math.max(0, v) / maxVal) * (innerH - 10);
        return Math.min(innerH, Math.max(0, y));
    };

    const buildSmoothPath = (pts: { x: number; y: number }[]) => {
        if (pts.length < 2) return '';
        const d: string[] = [`M${pts[0].x} ${pts[0].y}`];
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = Math.min(innerH, Math.max(0, p1.y + (p2.y - p0.y) / 6));
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = Math.min(innerH, Math.max(0, p2.y - (p3.y - p1.y) / 6));
            d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
        }
        return d.join(' ');
    };

    const pts = primary.map((p, i) => ({ x: xScale(i), y: yScale(p.value) }));
    const pathD = buildSmoothPath(pts);
    const areaD = pathD ? `${pathD} L ${xScale(primary.length - 1)} ${innerH} L ${xScale(0)} ${innerH} Z` : '';

    const cmpPts = (compare || undefined) ? (compare || []).map((p, i) => ({ x: xScale(i), y: yScale(p.value) })) : [];
    const cmpPathD = cmpPts.length >= 2 ? buildSmoothPath(cmpPts) : '';
    const cmpAreaD = cmpPathD ? `${cmpPathD} L ${xScale((compare || []).length - 1)} ${innerH} L ${xScale(0)} ${innerH} Z` : '';

    const desiredXTicks = 6; const tickIdx: number[] = [];
    if (primary.length <= desiredXTicks) { for (let i = 0; i < primary.length; i++) tickIdx.push(i); } else { for (let i = 0; i < desiredXTicks; i++) { const idx = Math.round((i / (desiredXTicks - 1)) * (primary.length - 1)); if (!tickIdx.includes(idx)) tickIdx.push(idx); } }
    const yTicks = 4; const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);

    const active = hoverIdx != null ? primary[hoverIdx] : null;
    const cmpActive = hoverIdx != null && (compare || undefined) ? (compare || [])[hoverIdx] : undefined;

    const labelForPoint = (i: number) => primary[i]?.date || '';
    const formatVal = (v: number) => valueType === 'currency' ? fmt.currency(v) : valueType === 'percentage' ? fmt.percentage(v) : fmt.number(v);
    const color = colorHue; const dColor = darkColorHue || colorHue;
    const gradLineId = `tsc-line-${idSuffix}`; const gradAreaId = `tsc-area-${idSuffix}`; const cmpAreaId = `tsc-cmp-area-${idSuffix}`;

    return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
            <div className="flex items-start justify-between mb-6 sticky top-14 z-20 bg-white dark:bg-gray-900 border-b border-transparent pb-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{title}</h3>
                </div>
                <div className="flex gap-3 text-sm items-start">
                    <div className="relative">
                        <SelectBase value={metricKey} onChange={e => onMetricChange?.((e.target as HTMLSelectElement).value as MetricKey)} className="px-3 h-9 pr-8 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                            {metricOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </SelectBase>
                    </div>
                </div>
            </div>
            <div className="flex items-start justify-between mb-4">
                <div />
                <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">{metricOptions.find(m => m.value === metricKey)?.label || ''}</div>
                    <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{bigValue}</div>
                </div>
            </div>
            <div className="relative" style={{ width: '100%' }}>
                <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block select-none">
                    <defs>
                        <linearGradient id={gradLineId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.9} /><stop offset="100%" stopColor={color} stopOpacity={0.5} /></linearGradient>
                        <linearGradient id={gradAreaId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0.05} /></linearGradient>
                        <linearGradient id={cmpAreaId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.15} /><stop offset="100%" stopColor={color} stopOpacity={0.03} /></linearGradient>
                    </defs>
                    {/* Compare area behind */}
                    {!!compare && cmpAreaD && <path d={cmpAreaD} fill={`url(#${cmpAreaId})`} stroke="none" />}
                    {/* Primary */}
                    {areaD && <path d={areaD} fill={`url(#${gradAreaId})`} stroke="none" />}
                    {pathD && <path d={pathD} fill="none" stroke={`url(#${gradLineId})`} strokeWidth={2} />}
                    {/* Y tick labels */}
                    {yTickValues.map((v, i) => { const y = yScale(v); const label = formatVal(v); return <text key={i} x={padLeft - 6} y={y + 3} fontSize={10} textAnchor="end" className="tabular-nums fill-gray-500 dark:fill-gray-400">{label}</text>; })}
                    {/* X axis baseline */}
                    <line x1={padLeft} x2={width - padRight} y1={innerH} y2={innerH} className="stroke-gray-200 dark:stroke-gray-700" />
                    {/* X ticks */}
                    {tickIdx.map(i => { const x = xScale(i) - 30; return <text key={i} x={x} y={height - 15} fontSize={11} textAnchor="start" className="fill-gray-500 dark:fill-gray-400">{primary[i]?.date || ''}</text>; })}
                    {/* Hovers */}
                    {primary.map((_, i) => { const x = xScale(i); const cellW = innerW / Math.max(1, (primary.length - 1)); return <rect key={i} x={x - cellW / 2} y={0} width={cellW} height={height} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />; })}
                </svg>
                {active && hoverIdx != null && (
                    <div className="pointer-events-none absolute z-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700" style={{ left: `${(xScale(hoverIdx) / width) * 100}%`, top: '10%', transform: 'translate(-50%, 0)' }}>
                        <div className="font-medium mb-0.5 text-gray-900 dark:text-gray-100">{labelForPoint(hoverIdx)}</div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Current</span><span className="tabular-nums">{formatVal(active.value)}</span></div>
                        {cmpActive && (
                            <>
                                <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Compare</span><span className="tabular-nums">{formatVal(cmpActive.value)}</span></div>
                                {(() => { const prev = cmpActive.value; const cur = active.value; const showDelta = prev != null && isFinite(prev) && prev !== 0; if (!showDelta) return null; const deltaPct = ((cur - prev) / prev) * 100; return <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Change</span><span className="tabular-nums">{`${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}</span></div>; })()}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
