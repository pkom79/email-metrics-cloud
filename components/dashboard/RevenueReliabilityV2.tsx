"use client";
import React, { useMemo, useState } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';
import { buildWeeklyAggregates, computeReliability } from '../../lib/analytics/reliability';
import { ShieldCheck } from 'lucide-react';

interface Props { campaigns: ProcessedCampaign[]; flows: ProcessedFlowEmail[]; dateRange: string; }

const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

export default function RevenueReliabilityV2({ campaigns, flows, dateRange }: Props) {
    const [scope, setScope] = useState<'all' | 'campaigns' | 'flows'>('all');
    const weeks = useMemo(() => buildWeeklyAggregates(scope === 'flows' ? [] : campaigns, scope === 'campaigns' ? [] : flows), [campaigns, flows, scope, dateRange]);
    const result = useMemo(() => computeReliability(weeks, { scope, windowSize: 12 }), [weeks, scope]);
    if (!weeks.length) return null;
    const reliability = result.reliability;
    const trend = result.trendDelta;
    const badgeColor = reliability == null ? 'bg-gray-300 text-gray-700' : reliability >= 80 ? 'bg-green-600 text-white' : reliability >= 65 ? 'bg-emerald-500 text-white' : reliability >= 50 ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white';

    // Chart geometry (mimic SendVolumeImpact style)
    const chartPoints = weeks.slice(-Math.min(26, weeks.length)); // last ~6 months max
    const revenues = chartPoints.map(w => scope === 'campaigns' ? w.campaignRevenue : scope === 'flows' ? w.flowRevenue : w.totalRevenue);
    const maxRevenue = Math.max(...revenues, 1);
    const median = result.median || 0;
    const mad = result.mad || 0;
    const VIEW_W = 1000; const VIEW_H = 170; const GRAPH_H = 130; const PAD_L = 50; const PAD_R = 16;
    const innerW = VIEW_W - PAD_L - PAD_R;
    const xScale = (i: number) => chartPoints.length <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (chartPoints.length - 1)) * innerW;
    const yScale = (rev: number) => GRAPH_H - (rev / maxRevenue) * (GRAPH_H - 10);

    // Catmull-Rom smoothing (copied simplified)
    const catmull = (pts: { x: number, y: number }[]) => {
        if (pts.length < 2) return '';
        const d: string[] = [];
        d.push(`M${pts[0].x} ${pts[0].y}`);
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
        }
        return d.join(' ');
    };

    const linePts = chartPoints.map((w, i) => ({ x: xScale(i), y: yScale(revenues[i]) }));
    const linePath = catmull(linePts);
    const areaPath = linePts.length ? `${catmull(linePts)} L ${linePts[linePts.length - 1].x} ${GRAPH_H} L ${linePts[0].x} ${GRAPH_H} Z` : '';

    // Median + band (MAD) shading
    const medianY = median > 0 ? yScale(median) : null;
    const upperBandY = (median > 0 && mad > 0) ? yScale(Math.min(median + mad, maxRevenue)) : null;
    const lowerBandY = (median > 0 && mad > 0) ? yScale(Math.max(median - mad, 0)) : null;
    const showBand = upperBandY != null && lowerBandY != null && Math.abs(lowerBandY - upperBandY) > 2;

    const tiles = [
        { label: 'Median Weekly Rev', value: result.median ? formatCurrency(result.median) : '—' },
        { label: 'Dispersion (MAD)', value: result.mad ? formatCurrency(result.mad) : '—' },
    ];
    return (
        <div className="mt-8">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-purple-600" />
                        <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">Weekly Revenue Reliability</h3>
                    </div>
                    <div className="flex items-center gap-3">
                        <select value={scope} onChange={e => setScope(e.target.value as any)} className="appearance-none px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200">
                            <option value="all">All Email</option>
                            <option value="campaigns">Campaigns</option>
                            <option value="flows">Flows</option>
                        </select>
                        {reliability === null ? (
                            <span className="text-xs text-gray-500">Insufficient</span>
                        ) : (
                            <div className={`px-4 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${badgeColor}`}>
                                <span>{reliability}%</span>
                                {trend !== null && <span className={`tabular-nums ${trend > 0 ? 'text-green-100' : trend < 0 ? 'text-red-100' : 'text-white/70'}`}>{trend > 0 ? '+' : ''}{trend}</span>}
                            </div>
                        )}
                    </div>
                </div>
                {/* Chart */}
                <div className="relative w-full overflow-hidden">
                    <svg width="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block select-none">
                        <defs>
                            <linearGradient id="rr-area" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
                            </linearGradient>
                        </defs>
                        {/* Y grid (3 lines) */}
                        {[0.25, 0.5, 0.75].map((p, i) => {
                            const y = yScale(maxRevenue * p);
                            return <line key={i} x1={PAD_L} x2={VIEW_W - PAD_R} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="2 2" />
                        })}
                        {/* MAD band */}
                        {showBand && upperBandY != null && lowerBandY != null && (
                            <rect x={PAD_L} y={upperBandY} width={innerW} height={Math.max(2, lowerBandY - upperBandY)} className="fill-purple-500/10" />
                        )}
                        {/* Area */}
                        {areaPath && <path d={areaPath} fill="url(#rr-area)" stroke="none" />}
                        {/* Line */}
                        {linePath && <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth={2} />}
                        {/* Median line */}
                        {medianY != null && <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={medianY} y2={medianY} stroke="#9ca3af" strokeDasharray="4 3" />}
                        {/* X labels (max 6) */}
                        {(() => {
                            const count = Math.min(6, chartPoints.length);
                            const els: React.ReactElement[] = [];
                            for (let i = 0; i < count; i++) { const idx = Math.round((i / (count - 1)) * (chartPoints.length - 1)); const w = chartPoints[idx]; const x = xScale(idx); els.push(<text key={i} x={x} y={GRAPH_H + 28} textAnchor="middle" fontSize={11} fill="#6b7280">{w.label}</text>); }
                            return els;
                        })()}
                        {/* Revenue axis ticks (left) */}
                        {[0, 0.5, 1].map((p, i) => { const val = maxRevenue * p; const y = yScale(val); return <text key={i} x={PAD_L - 6} y={y + 4} fontSize={11} textAnchor="end" fill="#6b7280" className="tabular-nums">{val >= 1000 ? '$' + (val / 1000).toFixed(1) + 'k' : '$' + val.toFixed(0)}</text>; })}
                    </svg>
                </div>
                {/* Tiles */}
                <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {tiles.map(t => (
                        <div key={t.label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">{t.label}</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{t.value}</p>
                        </div>
                    ))}
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 col-span-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">Definition</p>
                        <p className="text-[11px] leading-snug text-gray-600 dark:text-gray-300">Reliability uses weekly revenue stability (MAD/median) over up to the last 12 full weeks. Lower dispersion = higher reliability.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
