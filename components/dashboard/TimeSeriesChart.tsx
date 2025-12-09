"use client";
import React, { useMemo, useState, memo } from 'react';
import SelectBase from "../ui/SelectBase";
import TooltipPortal from "../TooltipPortal";
import { ArrowUp, ArrowDown, ArrowRight, BarChart2, TrendingUp } from 'lucide-react';
import { computeAxisMax, thirdTicks, formatTickLabels } from '../../lib/utils/chartTicks';
import { DataManager } from '../../lib/data/dataManager';

type Granularity = 'daily' | 'weekly' | 'monthly';
type CompareMode = 'none' | 'prev-period' | 'prev-year';
type ChartType = 'line' | 'bar';

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
    chartType?: ChartType;
    onChartTypeChange?: (type: ChartType) => void;
    // Dual-metric support
    secondaryMetricKey?: MetricKey | 'none';
    secondaryMetricOptions?: { value: MetricKey | 'none'; label: string }[];
    onSecondaryMetricChange?: (m: MetricKey | 'none') => void;
    secondaryBigValue?: string;
    secondarySeries?: SeriesPoint[] | null;
    secondaryColorHue?: string;
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

function TimeSeriesChart({ title, metricKey, metricOptions, onMetricChange, bigValue, primary, compare = null, colorHue = '#8b5cf6', darkColorHue, valueType, granularity, compareMode = 'prev-period', idSuffix = 'tsc', headerChange, headerIsPositive, headerPreviousValue, headerPreviousPeriod, chartType = 'line', onChartTypeChange, secondaryMetricKey, secondaryMetricOptions, onSecondaryMetricChange, secondaryBigValue, secondarySeries, secondaryColorHue = '#ec4899' }: TimeSeriesChartProps) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    // const [chartType, setChartType] = useState<ChartType>('line'); // Lifted to parent
    const width = 850; const height = 200; const innerH = 140; const padLeft = 72; const padRight = 20; const innerW = width - padLeft - padRight;

    const isDual = !!(secondarySeries && secondarySeries.length > 0 && secondaryMetricKey && secondaryMetricKey !== 'none');

    const maxVal = useMemo(() => computeAxisMax(primary.map(p => Math.max(0, p.value)), (compareMode !== 'none' && compare) ? (compare || []).map(p => Math.max(0, p.value)) : null, valueType === 'percentage' ? 'percentage' : (valueType as any)), [primary, compare, compareMode, valueType]);
    
    // Secondary axis max
    const maxValSecondary = useMemo(() => {
        if (!isDual || !secondarySeries) return 0;
        // We don't know the value type of secondary metric here easily unless passed, but we can infer or just use number.
        // Ideally we should pass secondaryValueType. For now, assume 'number' or same logic.
        // Let's just compute max.
        const max = Math.max(...secondarySeries.map(p => p.value), 0);
        return max === 0 ? 10 : max * 1.1; // Add padding
    }, [isDual, secondarySeries]);

    const xScale = (i: number) => primary.length <= 1 ? padLeft + innerW / 2 : padLeft + (i / (primary.length - 1)) * innerW;

    // Bar chart helpers
    const barWidth = useMemo(() => {
        const count = primary.length;
        if (count <= 1) return 40;
        const available = innerW / count;
        return Math.max(4, Math.min(40, available * 0.7));
    }, [primary.length, innerW]);

    const xBar = (i: number) => {
        const count = primary.length;
        const step = innerW / count;
        return padLeft + (i * step) + (step - barWidth) / 2;
    };

    const yScale = (v: number) => {
        const y = innerH - (Math.max(0, v) / maxVal) * (innerH - 10);
        return Math.min(innerH, Math.max(0, y));
    };

    const yScaleSecondary = (v: number) => {
        const y = innerH - (Math.max(0, v) / maxValSecondary) * (innerH - 10);
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

    const secPts = (isDual && secondarySeries) ? secondarySeries.map((p, i) => ({ x: xScale(i), y: yScaleSecondary(p.value) })) : [];
    const secPathD = isDual ? buildSmoothPath(secPts) : '';

    const cmpPts = (compareMode !== 'none' && compare && !isDual) ? (compare || []).map((p, i) => ({ x: xScale(i), y: yScale(p.value) })) : [];
    const cmpPathD = cmpPts.length >= 2 ? buildSmoothPath(cmpPts) : '';
    const cmpAreaD = cmpPathD ? `${cmpPathD} L ${xScale((compare || []).length - 1)} ${innerH} L ${xScale(0)} ${innerH} Z` : '';

    const desiredXTicks = 6; const tickIdx: number[] = [];
    if (primary.length <= desiredXTicks) { for (let i = 0; i < primary.length; i++) tickIdx.push(i); } else { for (let i = 0; i < desiredXTicks; i++) { const idx = Math.round((i / (desiredXTicks - 1)) * (primary.length - 1)); if (!tickIdx.includes(idx)) tickIdx.push(idx); } }
    // Y ticks: thirds using raw max or percentage domain
    const yTickValues = useMemo(() => thirdTicks(maxVal, valueType as any), [maxVal, valueType]);
    const yTickLabels = useMemo(() => formatTickLabels(yTickValues, valueType as any, maxVal), [yTickValues, valueType, maxVal]);

    const active = hoverIdx != null ? primary[hoverIdx] : null;
    const cmpActive = hoverIdx != null && (compare || undefined) ? (compare || [])[hoverIdx] : undefined;

    const formatFullDate = (iso?: string, fallback?: string) => {
        try {
            if (!iso) return fallback || '';
            const d = new Date(iso);
            if (isNaN(d.getTime())) return fallback || '';
            if (granularity === 'monthly') {
                return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            }
            if (granularity === 'weekly') {
                // Use full week range label for tooltips (e.g., "Jun 30–Jul 6, 2025")
                try {
                    const dm = DataManager.getInstance();
                    const boundaries = dm.getWeekBoundaries(d);
                    return boundaries.rangeLabel; // Full range format for tooltips
                } catch (err) {
                    console.warn('⚠️ TimeSeriesChart fallback (DataManager unavailable):', err);
                    // Fallback: Just show the week end date
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                }
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        } catch {
            return fallback || '';
        }
    };
    const labelForPoint = (i: number) => primary[i]?.date || '';
    const formatVal = (v: number) => valueType === 'currency' ? fmt.currency(v) : valueType === 'percentage' ? fmt.percentageDynamic(v) : fmt.number(v);
    const color = colorHue; const dColor = darkColorHue || colorHue;
    const cmpAreaId = `tsc-cmp-area-${idSuffix}`;

    return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 mb-8">
            {/* Top controls */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                    {/* Chart Type Toggles */}
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200 dark:border-gray-700">
                        <button
                            onClick={() => onChartTypeChange?.('line')}
                            className={`p-1 rounded-md transition-colors ${chartType === 'line' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            title="Line Chart"
                        >
                            <TrendingUp className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onChartTypeChange?.('bar')}
                            className={`p-1 rounded-md transition-colors ${chartType === 'bar' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            title="Bar Chart"
                        >
                            <BarChart2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Metrics Columns */}
                <div className="flex gap-8">
                    {/* Primary Metric Column */}
                    <div className="flex flex-col items-end">
                        <div className="relative mb-1">
                            <SelectBase value={metricKey} onChange={e => onMetricChange?.((e.target as HTMLSelectElement).value as MetricKey)} className="px-3 h-9 pr-8 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                                {metricOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </SelectBase>
                        </div>
                        <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{bigValue}</div>
                        {!isDual && (
                            // Comparison Block (Only in single mode)
                            (() => {
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
                                const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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
                            })()
                        )}
                    </div>

                    {/* Secondary Metric Column (Dual Mode Only) */}
                    {isDual && (
                        <div className="flex flex-col items-end">
                            <div className="relative mb-1">
                                <SelectBase value={secondaryMetricKey} onChange={e => onSecondaryMetricChange?.((e.target as HTMLSelectElement).value as MetricKey)} className="px-3 h-9 pr-8 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-pink-500 focus:border-pink-500">
                                    {secondaryMetricOptions?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </SelectBase>
                            </div>
                            <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 tabular-nums" style={{ color: secondaryColorHue }}>{secondaryBigValue}</div>
                        </div>
                    )}
                    
                    {/* Secondary Dropdown Placeholder for Single Mode (to allow switching to dual) */}
                    {!isDual && secondaryMetricOptions && (
                         <div className="flex flex-col items-end opacity-50 hover:opacity-100 transition-opacity">
                            <div className="relative mb-1">
                                <SelectBase value="none" onChange={e => onSecondaryMetricChange?.((e.target as HTMLSelectElement).value as MetricKey)} className="px-3 h-9 pr-8 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-pink-500 focus:border-pink-500">
                                    <option value="none">Add Metric...</option>
                                    {secondaryMetricOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </SelectBase>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="relative" style={{ width: '100%' }}>
                <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block select-none">
                    <defs>
                        <linearGradient id={cmpAreaId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0.08} /></linearGradient>
                    </defs>
                    {/* Compare shaded area (previous period) - always show as area/line for context */}
                    {cmpAreaD && <path d={cmpAreaD} fill={`url(#${cmpAreaId})`} stroke="none" />}

                    {/* Primary Data */}
                    {chartType === 'line' ? (
                        pathD && (
                            <path
                                d={pathD}
                                fill="none"
                                stroke={color}
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity={0.9}
                            />
                        )
                    ) : (
                        primary.map((p, i) => {
                            const x = xBar(i);
                            const y = yScale(p.value);
                            const h = innerH - y;
                            return (
                                <rect
                                    key={i}
                                    x={x}
                                    y={y}
                                    width={barWidth}
                                    height={h}
                                    fill={color}
                                    opacity={0.8}
                                    rx={2}
                                />
                            );
                        })
                    )}

                    {/* Secondary Data (Line Only) */}
                    {isDual && secPathD && (
                        <path
                            d={secPathD}
                            fill="none"
                            stroke={secondaryColorHue}
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={0.9}
                        />
                    )}

                    {/* Y tick labels */}
                    {yTickValues.map((v, i) => { const y = yScale(v); const label = yTickLabels[i] ?? ''; return <text key={i} x={padLeft - 6} y={y + 3} fontSize={10} textAnchor="end" className="tabular-nums fill-gray-500 dark:fill-gray-400">{label}</text>; })}
                    
                    {/* X axis baseline */}
                    <line x1={padLeft} x2={width - padRight} y1={innerH} y2={innerH} className="stroke-gray-200 dark:stroke-gray-700" />
                    {/* X ticks */}
                    {tickIdx.map(i => {
                        // For bars, align tick with bar center. For lines, align with point.
                        const x = chartType === 'bar' ? xBar(i) + barWidth / 2 : xScale(i);
                        return <text key={i} x={x} y={height - 15} fontSize={11} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400">{primary[i]?.date || ''}</text>;
                    })}
                    {/* Hovers */}
                    {primary.map((_, i) => {
                        const count = primary.length;
                        const step = innerW / count;
                        // For bars, the slot is simpler
                        const x = chartType === 'bar' ? padLeft + (i * step) : xScale(i);
                        const cellW = chartType === 'bar' ? step : (innerW / Math.max(1, (primary.length - 1)));
                        const xRect = chartType === 'bar' ? x : x - cellW / 2;

                        return <rect key={i} x={xRect} y={0} width={cellW} height={height} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />;
                    })}
                </svg>
                {active && hoverIdx != null && (
                    <div className="pointer-events-none absolute z-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700" style={{ left: `${((chartType === 'bar' ? xBar(hoverIdx) + barWidth / 2 : xScale(hoverIdx)) / width) * 100}%`, top: '10%', transform: 'translate(-50%, 0)' }}>
                        {/* Current date (bold) */}
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{formatFullDate(primary[hoverIdx]?.iso, labelForPoint(hoverIdx))}</div>
                        {/* Current value only */}
                        <div className="tabular-nums mb-1" style={{ color: color }}>{metricOptions.find(o => o.value === metricKey)?.label}: {formatVal(active.value)}</div>
                        
                        {/* Secondary Value */}
                        {isDual && secondarySeries && secondarySeries[hoverIdx] && (
                             <div className="tabular-nums mb-1" style={{ color: secondaryColorHue }}>
                                {secondaryMetricOptions?.find(o => o.value === secondaryMetricKey)?.label}: {
                                    // We need a formatter for secondary. For now use formatVal but it uses primary valueType.
                                    // Ideally we should pass secondaryValueType.
                                    // Let's assume number formatting for now or try to infer.
                                    // Or just use formatVal if units are similar? No.
                                    // Let's just use toLocaleString for now.
                                    secondarySeries[hoverIdx].value.toLocaleString('en-US', { maximumFractionDigits: 2 })
                                }
                             </div>
                        )}

                        {cmpActive && !isDual && (
                            <>
                                {/* Previous date (bold) with compare label */}
                                <div className="font-semibold text-gray-900 dark:text-gray-100 mt-2">{formatFullDate((compare || [])[hoverIdx]?.iso, (compare || [])[hoverIdx]?.date)}</div>
                                {/* Previous value only */}
                                <div className="tabular-nums mb-1">{formatVal(cmpActive.value)}</div>
                                {/* Delta */}
                                {(() => { const prev = cmpActive.value; const cur = active.value; const showDelta = prev != null && isFinite(prev) && prev !== 0; if (!showDelta) return null; const deltaPct = ((cur - prev) / prev) * 100; return <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Change</span><span className="tabular-nums">{`${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}</span></div>; })()}
                            </>
                        )}
                    </div>
                )}
                {/* Legend */}
                <div className="mt-3 pb-1 flex items-center gap-6 text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                        <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
                            <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                        <span>{metricOptions.find(o => o.value === metricKey)?.label || 'Primary Metric'}</span>
                    </div>
                    {isDual ? (
                        <div className="flex items-center gap-2">
                            <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
                                <line x1="1" y1="4" x2="21" y2="4" stroke={secondaryColorHue} strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                            <span>{secondaryMetricOptions?.find(o => o.value === secondaryMetricKey)?.label || 'Secondary Metric'}</span>
                        </div>
                    ) : (
                        (compare && (compare as any).length) ? (
                            <div className="flex items-center gap-2">
                                <span className="inline-block w-3.5 h-3.5 rounded-[3px]" style={{ backgroundColor: color, opacity: 0.18 }} />
                                <span>Previous period</span>
                            </div>
                        ) : null
                    )}
                </div>
            </div>
        </div>
    );
}

export default memo(TimeSeriesChart);
