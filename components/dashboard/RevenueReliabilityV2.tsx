"use client";
import React, { useMemo, useState } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';
import { buildWeeklyAggregatesInRange, computeReliability } from '../../lib/analytics/reliability';
import { ShieldCheck } from 'lucide-react';

interface Props { campaigns: ProcessedCampaign[]; flows: ProcessedFlowEmail[]; dateRange: string; }

const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

export default function RevenueReliabilityV2({ campaigns, flows, dateRange }: Props) {
    const [scope, setScope] = useState<'all' | 'campaigns' | 'flows'>('all');
    // Derive date range bounds (assumes campaigns/flows arrays already filtered by parent for selected dateRange string)
    const allDates = [...campaigns.map(c => c.sentDate.getTime()), ...flows.map(f => f.sentDate.getTime())].sort((a, b) => a - b);
    const maxDate = allDates.length ? new Date(allDates[allDates.length - 1]) : new Date();
    const startDate = useMemo(() => {
        if (dateRange === '365d') {
            const d = new Date(maxDate); d.setDate(d.getDate() - 364); return d;
        } else if (dateRange === 'all') {
            return allDates.length ? new Date(allDates[0]) : new Date(maxDate.getTime() - 364 * 24 * 3600 * 1000);
        } else if (dateRange === '90d') { const d = new Date(maxDate); d.setDate(d.getDate() - 89); return d; }
        return allDates.length ? new Date(allDates[0]) : new Date(maxDate.getTime() - 364 * 24 * 3600 * 1000);
    }, [dateRange, maxDate.getTime(), allDates.length]);
    const weeks = useMemo(() => buildWeeklyAggregatesInRange(scope === 'flows' ? [] : campaigns, scope === 'campaigns' ? [] : flows, startDate, maxDate), [campaigns, flows, scope, startDate, maxDate]);
    const result = useMemo(() => computeReliability(weeks, { scope, windowSize: 12 }), [weeks, scope]);
    if (!weeks.length) return null;
    const reliability = result.reliability;
    const trend = result.trendDelta;
    const badgeColor = reliability == null ? 'bg-gray-300 text-gray-700' : reliability >= 80 ? 'bg-green-600 text-white' : reliability >= 65 ? 'bg-emerald-500 text-white' : reliability >= 50 ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white';

    // Chart geometry: full period weeks (we keep all complete weeks in range)
    const chartPoints = weeks.filter(w => w.isCompleteWeek);
    const revenues = chartPoints.map(w => scope === 'campaigns' ? w.campaignRevenue : scope === 'flows' ? w.flowRevenue : w.totalRevenue);
    const maxRevenue = Math.max(...revenues.filter(r => r > 0), 1);
    const median = result.median || 0;
    const mad = result.mad || 0;
    const VIEW_W = 850; const VIEW_H = 190; const GRAPH_H = 130; const PAD_L = 50; const PAD_R = 16;
    const innerW = VIEW_W - PAD_L - PAD_R;
    const xScale = (i: number) => chartPoints.length <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (chartPoints.length - 1)) * innerW;
    const yScale = (rev: number) => GRAPH_H - (rev / maxRevenue) * (GRAPH_H - 10);

    // Simple polyline connecting actual points (no smoothing, no fabricated zeros except real zero weeks)
    const linePts = chartPoints.map((w, i) => ({ x: xScale(i), y: yScale(revenues[i]) }));
    const linePath = linePts.length ? 'M' + linePts.map(p => `${p.x},${p.y}`).join(' L') : '';

    // Median + band (MAD) shading
    const medianY = median > 0 ? yScale(median) : null;
    const upperBandY = (median > 0 && mad > 0) ? yScale(Math.min(median + mad, maxRevenue)) : null;
    const lowerBandY = (median > 0 && mad > 0) ? yScale(Math.max(median - mad, 0)) : null;
    const showBand = upperBandY != null && lowerBandY != null && Math.abs(lowerBandY - upperBandY) > 2;

    const tiles = [
        { label: 'Median Weekly Rev', value: result.median ? formatCurrency(result.median) : '—' },
        { label: 'Dispersion (MAD)', value: result.mad ? formatCurrency(result.mad) : '—' },
    ];
    if ((scope === 'campaigns' || scope === 'all') && result.zeroCampaignWeeks && result.zeroCampaignWeeks > 0) {
        tiles.push({ label: 'Zero Campaign Weeks', value: String(result.zeroCampaignWeeks) });
        if (result.estLostCampaignRevenue) tiles.push({ label: 'Est. Lost Campaign Rev', value: formatCurrency(result.estLostCampaignRevenue) });
    }

    const scopeColor = scope === 'campaigns' ? '#6366F1' : scope === 'flows' ? '#10B981' : '#8B5CF6';
    const bandColorClass = scope === 'campaigns' ? 'fill-blue-500/10' : scope === 'flows' ? 'fill-emerald-500/10' : 'fill-purple-500/10';
    return (
        <div className="mt-8">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5" style={{ color: scopeColor }} />
                        <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            Weekly Revenue Reliability
                            <button aria-label="Reliability definition" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xs">ⓘ</button>
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden text-xs font-medium">
                            {['all', 'campaigns', 'flows'].map(opt => (
                                <button key={opt} onClick={() => setScope(opt as any)} className={`px-3 py-1.5 ${scope === opt ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-300'}`}>{opt === 'all' ? 'All' : opt === 'campaigns' ? 'Campaigns' : 'Flows'}</button>
                            ))}
                        </div>
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
                        {/* MAD band only (no area fill) */}
                        {showBand && upperBandY != null && lowerBandY != null && (
                            <rect x={PAD_L} y={upperBandY} width={innerW} height={Math.max(2, lowerBandY - upperBandY)} className={bandColorClass} />
                        )}
                        {/* Line */}
                        {linePath && <path d={linePath} fill="none" stroke={scopeColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                        {/* Median line */}
                        {medianY != null && <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={medianY} y2={medianY} stroke="#9ca3af" strokeDasharray="4 3" />}
                        {/* X labels (max 6) */}
                        {(() => {
                            const count = Math.min(6, chartPoints.length);
                            const els: React.ReactElement[] = [];
                            for (let i = 0; i < count; i++) { const idx = Math.round((i / (count - 1)) * (chartPoints.length - 1)); const w = chartPoints[idx]; const x = xScale(idx) - 30; els.push(<text key={i} x={x} y={GRAPH_H + 35} textAnchor="start" fontSize={11} fill="#6b7280">{w.label}</text>); }
                            return els;
                        })()}
                        {/* Revenue axis ticks (left) */}
                        {[0, 0.5, 1].map((p, i) => { const val = maxRevenue * p; const y = yScale(val); return <text key={i} x={PAD_L - 6} y={y + 4} fontSize={11} textAnchor="end" fill="#6b7280" className="tabular-nums">{val >= 1000 ? '$' + (val / 1000).toFixed(1) + 'k' : '$' + val.toFixed(0)}</text>; })}
                    </svg>
                </div>
                {/* Stat tiles */}
                <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 relative">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1 flex justify-between items-center">Reliability <span className="text-[10px] font-normal text-gray-400">{result.windowWeeks}w</span></p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums flex items-center gap-2">
                            {reliability !== null ? reliability + '%' : '—'}
                            {result.trendDelta !== null && (
                                <span className={`text-xs font-medium ${result.trendDelta > 0 ? 'text-green-600 dark:text-green-400' : result.trendDelta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500'}`}>{result.trendDelta > 0 ? '▲' : '▼'}{Math.abs(result.trendDelta)}</span>
                            )}
                        </p>
                    </div>
                    {tiles.map(t => (
                        <div key={t.label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">{t.label}</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{t.value}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
