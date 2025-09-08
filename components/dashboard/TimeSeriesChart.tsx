"use client";
import React, { useMemo, useState } from 'react';
import SelectBase from "../ui/SelectBase";
import TooltipPortal from "../TooltipPortal";
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';

type Granularity = 'daily' | 'weekly' | 'monthly';
type CompareMode = 'prev-period' | 'prev-year';

export type MetricKey = 'revenue' | 'avgOrderValue' | 'revenuePerEmail' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'emailsSent' | 'totalOrders' | 'conversionRate' | 'unsubscribeRate' | 'spamRate' | 'bounceRate';

export interface SeriesPoint { value: number; date: string; iso?: string }

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
    compareMode?: CompareMode; // for labeling previous period in tooltip
    // Decorative options
    idSuffix?: string; // to make gradient IDs deterministic
    // Header trend props (to match MetricCard)
    headerChange?: number;
    headerIsPositive?: boolean;
    headerPreviousValue?: number;
    headerPreviousPeriod?: { startDate: Date; endDate: Date };
}

// Formatters mirror Metric Cards
const fmt = {
    currency: (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v),
    percentageDynamic: (v: number) => {
        const abs = Math.abs(v);
        if (abs >= 0.1) return `${v.toFixed(1)}%`;
        if (abs >= 0.01) return `${v.toFixed(2)}%`;
        return `${v.toFixed(3)}%`;
    },
    number: (v: number) => Math.round(v).toLocaleString('en-US')
};

export default function TimeSeriesChart({ title, metricKey, metricOptions, onMetricChange, bigValue, primary, compare = null, colorHue = '#8b5cf6', darkColorHue, valueType, granularity, compareMode = 'prev-period', idSuffix = 'tsc', headerChange, headerIsPositive, headerPreviousValue, headerPreviousPeriod }: TimeSeriesChartProps) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const width = 850; const height = 200; const innerH = 140; const padLeft = 72; const padRight = 20; const innerW = width - padLeft - padRight;

    const maxVal = useMemo(() => {
        // Highest value across primary and compare
        const pMax = primary.length ? Math.max(...primary.map(p => Math.max(0, p.value))) : 0;
        const cMax = (compare && compare.length) ? Math.max(...compare.map(p => Math.max(0, p.value))) : 0;
        let raw = Math.max(pMax, cMax);
        if (!isFinite(raw) || raw <= 0) raw = 1; // fallback when all zeros
        // Round up to a nice number (1/2/5 * 10^n)
        const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / pow10;
        const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
        return nice * pow10; // top tick value
    }, [primary, compare]);
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
    // Y ticks: bottom 0, two proportional ticks, and top = maxVal
    const yTickValues = useMemo(() => [0, maxVal / 3, (2 * maxVal) / 3, maxVal], [maxVal]);

    const active = hoverIdx != null ? primary[hoverIdx] : null;
    const cmpActive = hoverIdx != null && (compare || undefined) ? (compare || [])[hoverIdx] : undefined;

    const formatFullDate = (iso?: string, fallback?: string) => {
        try {
            if (!iso) return fallback || '';
            const d = new Date(iso);
            if (isNaN(d.getTime())) return fallback || '';
            if (granularity === 'monthly') {
                return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            }
            if (granularity === 'weekly') {
                const end = d;
                const start = new Date(end);
                start.setDate(end.getDate() - 6);
                const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
                const monthStart = start.toLocaleDateString('en-US', { month: 'short' });
                const monthEnd = end.toLocaleDateString('en-US', { month: 'short' });
                const dayStart = start.getDate();
                const dayEnd = end.getDate();
                const year = end.getFullYear();
                return sameMonth ? `${monthEnd} ${dayStart}${dayEnd}, ${year}`.replace('\u0013', '–') : `${monthStart} ${dayStart} – ${monthEnd} ${dayEnd}, ${year}`;
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return fallback || '';
        }
    };
    const labelForPoint = (i: number) => primary[i]?.date || '';
    const formatVal = (v: number) => valueType === 'currency' ? fmt.currency(v) : valueType === 'percentage' ? fmt.percentageDynamic(v) : fmt.number(v);
    const color = colorHue; const dColor = darkColorHue || colorHue;
    const gradLineId = `tsc-line-${idSuffix}`; const gradAreaId = `tsc-area-${idSuffix}`; const cmpAreaId = `tsc-cmp-area-${idSuffix}`;

    return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 mb-8">
            {/* Top controls: dropdown on right (no internal title) */}
            <div className="flex items-start justify-end mb-3">
                <div className="relative">
                    <SelectBase value={metricKey} onChange={e => onMetricChange?.((e.target as HTMLSelectElement).value as MetricKey)} className="px-3 h-9 pr-8 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                        {metricOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </SelectBase>
                </div>
            </div>
            <div className="flex items-start justify-between mb-4">
                <div />
                <div className="text-right">
                    <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{bigValue}</div>
                    {(() => {
                        const isAllTime = false; // charts aren't shown for 'all' compare anyway here
                        const change = headerChange ?? 0;
                        const isPositive = headerIsPositive ?? true;
                        const prevVal = headerPreviousValue;
                        const prevPeriod = headerPreviousPeriod;
                        const DISPLAY_EPS = 0.05;
                        const tiny = Math.abs(change) < DISPLAY_EPS;
                        const zeroDisplay = tiny || Math.abs(change) < 1e-9;
                        const fmtPrev = (v?: number) => {
                            if (v == null) return '';
                            switch (valueType) {
                                case 'currency': return fmt.currency(v);
                                case 'percentage': return `${v.toFixed(1)}%`;
                                default: return Math.round(v).toLocaleString('en-US');
                            }
                        };
                        const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        const tooltipNode = prevPeriod && prevVal != null ? (
                            <div className="text-gray-900 dark:text-gray-100">
                                <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300">{formatDate(prevPeriod.startDate)} – {formatDate(prevPeriod.endDate)}</div>
                                <div className="text-sm font-semibold tabular-nums mt-0.5">{fmtPrev(prevVal)}</div>
                            </div>
                        ) : null;
                        return (prevPeriod && prevVal != null) ? (
                            <div className="mt-1 flex justify-end">
                                <TooltipPortal content={tooltipNode as any}>
                                    <div className={`flex items-center text-[13px] font-medium ${zeroDisplay ? 'text-gray-600 dark:text-gray-400' : (isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}`} role="button" tabIndex={0}>
                                        {zeroDisplay ? (<ArrowRight className="w-4 h-4 mr-1" />) : (change > 0 ? (<ArrowUp className="w-4 h-4 mr-1" />) : (<ArrowDown className="w-4 h-4 mr-1" />))}
                                        {zeroDisplay ? '0.0' : (() => { const formatted = Math.abs(change).toFixed(1); const num = parseFloat(formatted); return num >= 1000 ? num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatted; })()}%
                                    </div>
                                </TooltipPortal>
                            </div>
                        ) : null;
                    })()}
                </div>
            </div>
            <div className="relative" style={{ width: '100%' }}>
                <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block select-none">
                    <defs>
                        <linearGradient id={gradLineId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.9} /><stop offset="100%" stopColor={color} stopOpacity={0.5} /></linearGradient>
                        <linearGradient id={gradAreaId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0.05} /></linearGradient>
                        <linearGradient id={cmpAreaId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0.08} /></linearGradient>
                    </defs>
                    {/* Compare area behind */}
                    {!!compare && cmpAreaD && <path d={cmpAreaD} fill={`url(#${cmpAreaId})`} stroke="none" />}
                    {/* Primary line only (no fill) so compare area remains visible */}
                    {pathD && <path d={pathD} fill="none" stroke={`url(#${gradLineId})`} strokeWidth={2} />}
                    {/* Y tick labels */}
                    {yTickValues.map((v, i) => { const y = yScale(v); const label = (valueType === 'percentage' && v === 0) ? '0%' : formatVal(v); return <text key={i} x={padLeft - 6} y={y + 3} fontSize={10} textAnchor="end" className="tabular-nums fill-gray-500 dark:fill-gray-400">{label}</text>; })}
                    {/* X axis baseline */}
                    <line x1={padLeft} x2={width - padRight} y1={innerH} y2={innerH} className="stroke-gray-200 dark:stroke-gray-700" />
                    {/* X ticks */}
                    {tickIdx.map(i => { const x = xScale(i) - 30; return <text key={i} x={x} y={height - 15} fontSize={11} textAnchor="start" className="fill-gray-500 dark:fill-gray-400">{primary[i]?.date || ''}</text>; })}
                    {/* Hovers */}
                    {primary.map((_, i) => { const x = xScale(i); const cellW = innerW / Math.max(1, (primary.length - 1)); return <rect key={i} x={x - cellW / 2} y={0} width={cellW} height={height} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />; })}
                </svg>
                {active && hoverIdx != null && (
                    <div className="pointer-events-none absolute z-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700" style={{ left: `${(xScale(hoverIdx) / width) * 100}%`, top: '10%', transform: 'translate(-50%, 0)' }}>
                        {/* Current date (bold) */}
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatFullDate(primary[hoverIdx]?.iso, labelForPoint(hoverIdx))}</div>
                        {/* Current value only */}
                        <div className="tabular-nums mb-1">{formatVal(active.value)}</div>
                        {cmpActive && (
                            <>
                                {/* Previous date (bold) with compare label */}
                                <div className="font-semibold text-gray-900 dark:text-gray-100">{formatFullDate((compare || [])[hoverIdx]?.iso, (compare || [])[hoverIdx]?.date)}</div>
                                {/* Previous value only */}
                                <div className="tabular-nums mb-1">{formatVal(cmpActive.value)}</div>
                                {/* Delta */}
                                {(() => { const prev = cmpActive.value; const cur = active.value; const showDelta = prev != null && isFinite(prev) && prev !== 0; if (!showDelta) return null; const deltaPct = ((cur - prev) / prev) * 100; return <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Change</span><span className="tabular-nums">{`${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}</span></div>; })()}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
