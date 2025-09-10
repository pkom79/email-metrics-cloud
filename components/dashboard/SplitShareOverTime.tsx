"use client";
import React, { useMemo, useState } from 'react';
import { DataManager } from '../../lib/data/dataManager';

type Gran = 'daily' | 'weekly' | 'monthly';
type CompareMode = 'prev-period' | 'prev-year';

interface Props {
    dateRange: string;
    granularity: Gran;
    customFrom?: string;
    customTo?: string;
    compareMode?: CompareMode;
}

type Metric = 'revenue' | 'emailsSent';

const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const formatNumber = (v: number) => Math.round(v).toLocaleString('en-US');

export default function SplitShareOverTime({ dateRange, granularity, customFrom, customTo, compareMode = 'prev-period' }: Props) {
    const dm = DataManager.getInstance();
    const [metric, setMetric] = useState<Metric>('revenue');

    const campaigns = dm.getCampaigns();
    const flows = dm.getFlowEmails();

    const series = useMemo(() => {
        // Build campaign-only and flow-only series with compare; always aggregate all flows
        const camp = dm.getMetricTimeSeriesWithCompare(campaigns as any, [], metric, dateRange, granularity, compareMode, customFrom, customTo);
        const flo = dm.getMetricTimeSeriesWithCompare([], flows as any, metric, dateRange, granularity, compareMode, customFrom, customTo);
        const primaryLen = Math.min(camp.primary.length, flo.primary.length);
        const items = [] as {
            label: string;
            campVal: number; flowVal: number; total: number;
            campPct: number; flowPct: number;
            cmpCampVal?: number; cmpFlowVal?: number; cmpTotal?: number;
            cmpCampPct?: number; cmpFlowPct?: number;
        }[];
        for (let i = 0; i < primaryLen; i++) {
            const c = camp.primary[i]?.value ?? 0;
            const f = flo.primary[i]?.value ?? 0;
            const total = c + f;
            const campPct = total > 0 ? (c / total) * 100 : 0;
            const flowPct = total > 0 ? (f / total) * 100 : 0;
            const label = camp.primary[i]?.date || flo.primary[i]?.date || '';
            const row: any = { label, campVal: c, flowVal: f, total, campPct, flowPct };
            if (camp.compare && flo.compare) {
                const cc = camp.compare[i]?.value ?? 0;
                const ff = flo.compare[i]?.value ?? 0;
                const t = cc + ff;
                row.cmpCampVal = cc; row.cmpFlowVal = ff; row.cmpTotal = t;
                row.cmpCampPct = t > 0 ? (cc / t) * 100 : 0;
                row.cmpFlowPct = t > 0 ? (ff / t) * 100 : 0;
            }
            items.push(row);
        }
        return items;
    }, [dm, campaigns, flows, metric, dateRange, granularity, compareMode, customFrom, customTo]);

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
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign vs Flow Split Over Time</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Metric:</span>
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
                    />
                )}
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-indigo-600" /><span>Campaigns</span></div>
                    <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /><span>Flows</span></div>
                    <div className="ml-auto text-[11px] text-gray-500 dark:text-gray-400">Compare shown in tooltip</div>
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
}: {
    data: { label: string; campVal: number; flowVal: number; total: number; campPct: number; flowPct: number; cmpCampVal?: number; cmpFlowVal?: number; cmpTotal?: number; cmpCampPct?: number; cmpFlowPct?: number; }[];
    barW: number; barGap: number; viewW: number; viewH: number; paddingL: number; paddingR: number;
    valueFormatter: (v: number) => string; showCompare: boolean; metric: Metric;
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
                    <div className="font-medium mb-1 text-gray-900 dark:text-gray-100">{active.label}</div>
                    <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 items-center">
                        <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#6366F1' }} /> Campaigns</div>
                        <div className="tabular-nums text-right">{active.campPct.toFixed(1)}% • {valueFormatter(active.campVal)}</div>
                        <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#10B981' }} /> Flows</div>
                        <div className="tabular-nums text-right">{active.flowPct.toFixed(1)}% • {valueFormatter(active.flowVal)}</div>
                        <div className="text-gray-500 col-span-2 border-t border-gray-200 dark:border-gray-700 mt-1 pt-1">Total: {valueFormatter(active.total)}</div>
                    </div>
                    {showCompare && typeof active.cmpCampPct === 'number' && typeof active.cmpFlowPct === 'number' && (
                        <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-700">
                            <div className="text-[11px] text-gray-500 mb-0.5">Compare</div>
                            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 items-center">
                                <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#6366F1' }} /> Campaigns</div>
                                <div className="tabular-nums text-right">{active.cmpCampPct!.toFixed(1)}% • {valueFormatter(active.cmpCampVal || 0)}</div>
                                <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#10B981' }} /> Flows</div>
                                <div className="tabular-nums text-right">{active.cmpFlowPct!.toFixed(1)}% • {valueFormatter(active.cmpFlowVal || 0)}</div>
                                <div className="text-gray-500 col-span-2">Total: {valueFormatter(active.cmpTotal || 0)}</div>
                            </div>
                            {/* deltas */}
                            <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 items-center">
                                <div className="text-gray-500">Delta Campaigns</div>
                                <div className="tabular-nums text-right">{(active.campPct - (active.cmpCampPct || 0)).toFixed(1)}% • {valueFormatter(active.campVal - (active.cmpCampVal || 0))}</div>
                                <div className="text-gray-500">Delta Flows</div>
                                <div className="tabular-nums text-right">{(active.flowPct - (active.cmpFlowPct || 0)).toFixed(1)}% • {valueFormatter(active.flowVal - (active.cmpFlowVal || 0))}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
