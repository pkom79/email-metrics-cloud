"use client";
import React, { useMemo, useState } from 'react';
import { Flame, Info } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

interface Props { dateRange: string; customFrom?: string; customTo?: string; }

// Internal aggregated cell
interface StepAgg {
    sequencePosition: number;
    emailsSent: number;
    opens: number;
    clicks: number;
    orders: number;
    revenue: number;
    revenuePerEmail: number;
    openRate: number; // % as 0-100
    clickRate: number; // %
    conversionRate: number; // %
    deltaRevenuePerEmail: number;
    deltaOpenRate: number; // pp
    deltaClickRate: number; // pp
    deltaConversionRate: number; // pp
}

type MetricKey = 'openRate' | 'clickRate' | 'conversionRate' | 'revenuePerEmail';

// Small delta badge
const DeltaBadge: React.FC<{ value: number; type: 'pp' | 'currency'; ariaLabel: string }> = ({ value, type, ariaLabel }) => {
    const positive = value > 0;
    const negative = value < 0;
    const text = type === 'pp'
        ? `${value > 0 ? '+' : value < 0 ? '' : ''}${value.toFixed(1)} pp`
        : `${value > 0 ? '+' : value < 0 ? '' : ''}$${Math.abs(value).toFixed(2)}`;
    const cls = negative ? 'bg-rose-50 text-rose-700' : positive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600';
    return <div aria-label={ariaLabel} className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${cls}`}>{text}</div>;
};

interface StepCellProps {
    view: 'table' | 'heatmap';
    metric: MetricKey;
    value: number;
    delta: number;
    reachPct: number; // 0-100
    revDelta: number; // for secondary display (currency)
    onHoverData: any;
    hasClicks: boolean;
    hasConv: boolean;
    largestNeg: boolean;
}

const StepCell: React.FC<StepCellProps> = ({ view, metric, value, delta, reachPct, revDelta, onHoverData, hasClicks, hasConv }) => {
    const isCurrency = metric === 'revenuePerEmail';
    const displayValue = isCurrency ? `$${value.toFixed(2)}` : `${value.toFixed(1)}%`;
    const badgeType: 'pp' | 'currency' = isCurrency ? 'currency' : 'pp';
    // Heatmap color based on delta sign/magnitude
    const mag = Math.min(1, Math.abs(delta) / (isCurrency ? 2 : 10));
    const heat = delta === 0 ? 'rgba(147,51,234,0.05)' : delta > 0 ? `rgba(16,185,129,${0.15 + mag * 0.35})` : `rgba(244,63,94,${0.15 + mag * 0.35})`;
    return (
        <div className="relative" role="cell">
            {view === 'table' ? (
                <div className="relative rounded-lg bg-white ring-1 ring-gray-200 px-3 py-2">
                    <div className="text-sm font-medium text-gray-900 leading-tight">{displayValue}</div>
                    <DeltaBadge value={delta} type={badgeType} ariaLabel={`Delta ${delta.toFixed(2)} ${isCurrency ? 'dollars' : 'percentage points'}`} />
                    <div className="absolute inset-x-2 bottom-1 h-1 rounded-full bg-purple-200" style={{ width: `${reachPct}%` }} />
                </div>
            ) : (
                <div className="relative rounded-lg px-3 py-2 text-sm font-medium text-gray-900" style={{ background: heat }}>
                    <div>{displayValue}</div>
                    <div className="absolute inset-x-2 bottom-1 h-1 rounded-full bg-purple-300" style={{ width: `${reachPct}%` }} />
                </div>
            )}
            {/* Hover popover */}
            <div className="absolute left-1/2 top-full z-30 hidden -translate-x-1/2 pt-2 group-hover:block">
                <div className="w-64 rounded-lg border border-gray-200 bg-white shadow-xl p-3 text-[11px] text-gray-800">
                    <p className="font-semibold mb-1">{onHoverData.flow} • Step {onHoverData.step}</p>
                    <table className="w-full text-[11px]">
                        <tbody>
                            <tr><td className="text-gray-500 pr-2">Sends</td><td className="text-right tabular-nums">{onHoverData.emails.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Reach %</td><td className="text-right tabular-nums">{reachPct.toFixed(1)}%</td></tr>
                            <tr><td className="text-gray-500 pr-2">Opens</td><td className="text-right tabular-nums">{onHoverData.opens.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Clicks</td><td className="text-right tabular-nums">{onHoverData.clicks.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Conversions</td><td className="text-right tabular-nums">{onHoverData.orders.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Revenue</td><td className="text-right tabular-nums">${onHoverData.revenue.toFixed(2)}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Rev/Email</td><td className="text-right tabular-nums">${onHoverData.rpe.toFixed(2)}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Open rate</td><td className="text-right tabular-nums">{onHoverData.openRate.toFixed(2)}%</td></tr>
                            <tr><td className="text-gray-500 pr-2">CTR</td><td className="text-right tabular-nums">{onHoverData.clickRate.toFixed(2)}%</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default function FlowStepDropOff({ dateRange, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const flowEmails = dm.getFlowEmails().filter(f => f.status?.toLowerCase() === 'live');

    // Filters
    const filtered = useMemo(() => {
        if (dateRange === 'all') return flowEmails;
        let start: Date, end: Date;
        if (dateRange === 'custom' && customFrom && customTo) {
            start = new Date(customFrom + 'T00:00:00'); end = new Date(customTo + 'T23:59:59');
        } else {
            const days = parseInt(dateRange.replace('d', ''));
            end = new Date(dm.getLastEmailDate()); end.setHours(23, 59, 59, 999);
            start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
        }
        return flowEmails.filter(e => e.sentDate >= start && e.sentDate <= end);
    }, [flowEmails, dateRange, customFrom, customTo, dm]);

    // Aggregate per flow & step
    const { byFlow, flows, maxSeq, presence } = useMemo(() => {
        const map: Record<string, StepAgg[]> = {};
        for (const e of filtered) {
            const flow = e.flowName || 'Unknown Flow';
            if (!map[flow]) map[flow] = [];
            let cell = map[flow].find(c => c.sequencePosition === e.sequencePosition);
            if (!cell) {
                cell = { sequencePosition: e.sequencePosition, emailsSent: 0, opens: 0, clicks: 0, orders: 0, revenue: 0, revenuePerEmail: 0, openRate: 0, clickRate: 0, conversionRate: 0, deltaRevenuePerEmail: 0, deltaOpenRate: 0, deltaClickRate: 0, deltaConversionRate: 0 };
                map[flow].push(cell);
            }
            cell.emailsSent += e.emailsSent;
            cell.opens += e.uniqueOpens;
            cell.clicks += e.uniqueClicks;
            cell.orders += e.totalOrders;
            cell.revenue += e.revenue;
        }
        let globalMaxSeq = 0;
        Object.values(map).forEach(arr => {
            arr.sort((a, b) => a.sequencePosition - b.sequencePosition);
            arr.forEach(c => {
                c.revenuePerEmail = c.emailsSent > 0 ? c.revenue / c.emailsSent : 0;
                c.openRate = c.emailsSent > 0 ? (c.opens / c.emailsSent) * 100 : 0;
                c.clickRate = c.emailsSent > 0 ? (c.clicks / c.emailsSent) * 100 : 0;
                c.conversionRate = c.emailsSent > 0 ? (c.orders / c.emailsSent) * 100 : 0;
            });
            arr.forEach((c, i) => {
                if (i === 0) return; const prev = arr[i - 1];
                c.deltaRevenuePerEmail = c.revenuePerEmail - prev.revenuePerEmail;
                c.deltaOpenRate = c.openRate - prev.openRate;
                c.deltaClickRate = c.clickRate - prev.clickRate;
                c.deltaConversionRate = c.conversionRate - prev.conversionRate;
            });
            const maxLocal = Math.max(...arr.map(x => x.sequencePosition));
            if (maxLocal > globalMaxSeq) globalMaxSeq = maxLocal;
        });
        const flowNames = Object.keys(map).sort();
        // presence per step for trimming
        const presenceCount: Record<number, number> = {};
        flowNames.forEach(f => map[f].forEach(c => { presenceCount[c.sequencePosition] = (presenceCount[c.sequencePosition] || 0) + 1; }));
        return { byFlow: map, flows: flowNames, maxSeq: globalMaxSeq, presence: presenceCount };
    }, [filtered]);

    const [metric, setMetric] = useState<MetricKey>('openRate');
    const [view, setView] = useState<'table' | 'heatmap'>('table');

    if (!flows.length) return null;

    // Trim trailing sparse steps (keep first 3 always)
    let effectiveMax = maxSeq;
    for (let s = maxSeq; s > 3; s--) { if ((presence[s] || 0) < 2) { effectiveMax = s - 1; } else break; }

    // Largest negative delta across selected metric for dot indicator
    const largestNegPosition: Record<string, number> = {};
    flows.forEach(f => {
        const cells = byFlow[f];
        let minVal = 0; let pos = 0;
        cells.forEach(c => {
            if (c.sequencePosition === 1) return;
            const delta = (metric === 'revenuePerEmail' ? c.deltaRevenuePerEmail
                : metric === 'openRate' ? c.deltaOpenRate
                    : metric === 'clickRate' ? c.deltaClickRate : c.deltaConversionRate);
            if (delta < minVal) { minVal = delta; pos = c.sequencePosition; }
        });
        if (pos) largestNegPosition[f] = pos;
    });

    const formatValue = (v: number, key: MetricKey) => {
        if (key === 'revenuePerEmail') return '$' + v.toFixed(2);
        // rates
        return v.toFixed(v >= 10 ? 1 : 2) + '%';
    };
    const formatDelta = (v: number, key: MetricKey) => {
        if (key === 'revenuePerEmail') return (v >= 0 ? '+' : '') + '$' + v.toFixed(2);
        return (v >= 0 ? '+' : '') + v.toFixed(1) + 'pp';
    };

    // Largest negative Δ Rev/Email per flow
    const biggestNeg: Record<string, number> = {};
    flows.forEach(f => {
        const negatives = byFlow[f].filter(c => c.sequencePosition > 1 && c.deltaRevenuePerEmail < 0);
        if (negatives.length) {
            negatives.sort((a, b) => a.deltaRevenuePerEmail - b.deltaRevenuePerEmail);
            biggestNeg[f] = negatives[0].sequencePosition;
        }
    });

    // Metric availability (if clickRate or conversionRate all zeros hide)
    const hasClicks = flows.some(f => byFlow[f].some(c => c.clickRate > 0));
    const hasConv = flows.some(f => byFlow[f].some(c => c.conversionRate > 0));

    const metricOptions: { key: MetricKey; label: string; available: boolean }[] = [
        { key: 'openRate', label: 'Open rate', available: true },
        { key: 'clickRate', label: 'CTR', available: hasClicks },
        { key: 'conversionRate', label: 'CVR', available: hasConv },
        { key: 'revenuePerEmail', label: 'Rev/Email', available: true },
    ];

    const reachPct = (flow: string, step: number) => {
        const arr = byFlow[flow];
        const base = arr.find(c => c.sequencePosition === 1)?.emailsSent || 0;
        if (!base) return 0;
        const cell = arr.find(c => c.sequencePosition === step);
        if (!cell) return 0; return (cell.emailsSent / base) * 100;
    };

    const getDeltaMetric = (cell: StepAgg, key: MetricKey) => {
        if (cell.sequencePosition === 1) return 0;
        switch (key) {
            case 'revenuePerEmail': return cell.deltaRevenuePerEmail;
            case 'openRate': return cell.deltaOpenRate;
            case 'clickRate': return cell.deltaClickRate;
            case 'conversionRate': return cell.deltaConversionRate;
        }
    };

    return (
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 tracking-tight">Flow Step Drop-Off</h3>
                </div>
                <div className="flex items-center gap-4 text-sm">
                    <div className="relative">
                        <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} className="appearance-none px-3 h-9 pr-8 rounded-lg border bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                            {metricOptions.filter(o => o.available).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
                    </div>
                    <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
                        <button onClick={() => setView('table')} className={`px-3 h-9 text-xs font-medium ${view === 'table' ? 'bg-purple-600 text-white' : 'text-gray-600'}`}>Table</button>
                        <button onClick={() => setView('heatmap')} className={`px-3 h-9 text-xs font-medium ${view === 'heatmap' ? 'bg-purple-600 text-white' : 'text-gray-600'}`}>Heatmap</button>
                    </div>
                    <div className="relative group inline-flex items-center">
                        <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 cursor-pointer" />
                        <div className="pointer-events-none absolute right-0 top-6 z-30 hidden group-hover:block w-80 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                            <span className="font-semibold block mb-1">How to read</span>
                            Color = Δ vs previous step (green up, red down). Background width = reach vs step 1. Values are per step for the selected metric.
                        </div>
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                    <thead>
                        <tr className="text-xs text-gray-600">
                            <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 font-medium border-b border-gray-200 w-[320px]">Flow</th>
                            {Array.from({ length: effectiveMax }, (_, i) => i + 1).map(step => (
                                <th key={step} className="px-3 py-2 font-medium border-b border-gray-200 text-xs text-gray-600">S{step}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {flows.map((flow, rowIdx) => {
                            const arr = byFlow[flow];
                            const base = arr.find(c => c.sequencePosition === 1)!;
                            const baseLine = `Base: OR ${(base.openRate).toFixed(1)}% · RPE $${base.revenuePerEmail.toFixed(2)}`;
                            return (
                                <tr key={flow} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="sticky left-0 bg-inherit border-b border-gray-200 px-3 py-3 align-top">
                                        <div className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                                            {largestNegPosition[flow] && <span className="w-2 h-2 rounded-full bg-rose-500" aria-label={`Largest negative delta at step ${largestNegPosition[flow]}`}></span>}
                                            <span className="truncate" title={flow}>{flow}</span>
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">{baseLine}</div>
                                    </td>
                                    {Array.from({ length: effectiveMax }, (_, i) => i + 1).map(step => {
                                        const cell = arr.find(c => c.sequencePosition === step);
                                        if (!cell) return <td key={step} className="px-3 py-3 border-b border-gray-200 text-center text-xs text-gray-400" aria-label="No step">–</td>;
                                        const reach = reachPct(flow, step);
                                        const deltaVal = step === 1 ? 0 : (metric === 'revenuePerEmail' ? cell.deltaRevenuePerEmail : metric === 'openRate' ? cell.deltaOpenRate : metric === 'clickRate' ? cell.deltaClickRate : cell.deltaConversionRate);
                                        return (
                                            <td key={step} className="group px-3 py-3 border-b border-gray-200 align-top text-center">
                                                <StepCell
                                                    view={view}
                                                    metric={metric}
                                                    value={(cell as any)[metric]}
                                                    delta={deltaVal}
                                                    reachPct={Math.max(0, Math.min(100, Math.round(reach)))}
                                                    revDelta={cell.deltaRevenuePerEmail}
                                                    onHoverData={{ flow, step, emails: cell.emailsSent, opens: cell.opens, clicks: cell.clicks, orders: cell.orders, revenue: cell.revenue, rpe: cell.revenuePerEmail, openRate: cell.openRate, clickRate: cell.clickRate }}
                                                    hasClicks={hasClicks}
                                                    hasConv={hasConv}
                                                    largestNeg={largestNegPosition[flow] === step}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {!flows.length && (
                <div className="mt-4 space-y-2" aria-label="Loading flows">
                    {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />)}
                </div>
            )}
        </div>
    );
}
