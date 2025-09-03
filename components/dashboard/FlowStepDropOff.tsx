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
    openRate: number; // %
    clickRate: number; // CTR % (clicks / sent)
    conversionRate: number; // CVR % (orders / sent)
    deltaRevenuePerEmail: number; // vs prev
    deltaOpenRate: number; // vs prev (p.p.)
    deltaClickRate: number; // vs prev (p.p.)
    deltaConversionRate: number; // vs prev (p.p.)
}

type MetricKey = 'revenuePerEmail' | 'openRate' | 'clickRate' | 'conversionRate';

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

    const [metric, setMetric] = useState<MetricKey>('revenuePerEmail');
    const [view, setView] = useState<'chips' | 'heatmap'>('chips');

    if (!flows.length) return null;

    // Trim trailing sparse steps (keep first 3 always)
    let effectiveMax = maxSeq;
    for (let s = maxSeq; s > 3; s--) {
        if ((presence[s] || 0) < 2) { effectiveMax = s - 1; } else break;
    }

    // Color scaling based on Δ Rev/Email distribution
    const allDeltas = flows.flatMap(f => byFlow[f]).filter(c => c.sequencePosition > 1).map(c => c.deltaRevenuePerEmail);
    const minDelta = Math.min(0, ...allDeltas, 0);
    const maxDelta = Math.max(0, ...allDeltas, 0);
    const colorClass = (delta: number, isBase: boolean) => {
        if (isBase) return 'bg-gray-100 dark:bg-gray-800';
        if (delta === 0) return 'bg-gray-100 dark:bg-gray-800';
        if (delta > 0) {
            const pct = maxDelta === 0 ? 1 : Math.min(1, delta / maxDelta);
            return pct > 0.66 ? 'bg-emerald-300' : pct > 0.33 ? 'bg-emerald-200' : 'bg-emerald-100';
        }
        const pct = minDelta === 0 ? 1 : Math.min(1, Math.abs(delta) / Math.abs(minDelta));
        return pct > 0.66 ? 'bg-rose-300' : pct > 0.33 ? 'bg-rose-200' : 'bg-rose-100';
    };

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
        { key: 'revenuePerEmail', label: 'Rev/Email', available: true },
        { key: 'openRate', label: 'Open Rate', available: true },
        { key: 'clickRate', label: 'CTR', available: hasClicks },
        { key: 'conversionRate', label: 'CVR', available: hasConv },
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
        <div className="mt-8 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Flow Step Drop-Off</h3>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                    <div className="flex items-center gap-1">
                        <label className="text-gray-500 dark:text-gray-400">Metric</label>
                        <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-1.5 py-1 text-[11px] focus:outline-none">
                            {metricOptions.filter(o => o.available).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setView('chips')} className={`px-2 py-1 rounded-md border text-[11px] ${view === 'chips' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>Chips</button>
                        <button onClick={() => setView('heatmap')} className={`px-2 py-1 rounded-md border text-[11px] ${view === 'heatmap' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>Heatmap</button>
                    </div>
                    <div className="relative group">
                        <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 cursor-pointer" />
                        <div className="absolute right-0 top-6 z-30 hidden group-hover:block w-80 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3">
                            <p className="font-semibold mb-1 text-gray-900 dark:text-gray-100">Legend</p>
                            <p className="text-gray-600 dark:text-gray-300">Color = Δ Rev/Email vs prior step. Width backdrop = reach (% of step1 sends). Chip shows selected metric & its delta (pp for rates). Heatmap view condenses to colored squares with values.</p>
                        </div>
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-[11px]">
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-white dark:bg-gray-900 z-10 text-left px-2 py-1 font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">Flow</th>
                            {Array.from({ length: effectiveMax }, (_, i) => i + 1).map(step => (
                                <th key={step} className="px-2 py-1 text-gray-600 dark:text-gray-400 font-medium border-b border-gray-200 dark:border-gray-700">S{step}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {flows.map(flow => {
                            const row = byFlow[flow];
                            const maxEmails = Math.max(...row.map(r => r.emailsSent));
                            return (
                                <tr key={flow} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                                    <td className="sticky left-0 bg-white dark:bg-gray-900 px-2 py-1 font-semibold text-gray-800 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap align-top">
                                        <div className="flex items-center gap-1">
                                            {biggestNeg[flow] && <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" title={`Largest negative Δ at step ${biggestNeg[flow]}`}></span>}
                                            <span>{flow}</span>
                                        </div>
                                        <div className="mt-1 flex h-1 w-full gap-0.5">
                                            {row.filter(r => r.sequencePosition <= effectiveMax).map(r => {
                                                const pct = maxEmails === 0 ? 0 : r.emailsSent / maxEmails;
                                                return <div key={r.sequencePosition} className="h-full bg-purple-400/50 dark:bg-purple-500/40 rounded-sm" style={{ width: `${Math.max(2, pct * 30)}px` }} />;
                                            })}
                                        </div>
                                    </td>
                                    {Array.from({ length: effectiveMax }, (_, i) => i + 1).map(step => {
                                        const cell = row.find(r => r.sequencePosition === step);
                                        if (!cell) return <td key={step} className="px-1 py-1 border-b border-gray-100 dark:border-gray-800" />;
                                        const deltaMetric = getDeltaMetric(cell, metric);
                                        const backdropWidth = reachPct(flow, step);
                                        const value = (cell as any)[metric] as number;
                                        const chipColor = colorClass(cell.deltaRevenuePerEmail, step === 1);
                                        return (
                                            <td key={step} className="px-1 py-1 border-b border-gray-100 dark:border-gray-800 align-top">
                                                {view === 'chips' ? (
                                                    <div className="group relative w-24 h-14 flex items-center">
                                                        <div className="absolute inset-0 rounded-md bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                                            <div className="h-full bg-purple-200 dark:bg-purple-700/30" style={{ width: `${backdropWidth}%` }} />
                                                        </div>
                                                        <div className={`relative mx-auto ${chipColor} rounded-md text-gray-900 dark:text-gray-900 px-1.5 py-1 w-full shadow ring-1 ring-black/5 flex flex-col items-start justify-center`}>
                                                            <span className="text-[10px] font-semibold leading-tight">{formatValue(value, metric)}</span>
                                                            {step === 1 ? (
                                                                <span className="text-[9px] text-gray-700">Base</span>
                                                            ) : (
                                                                <span className="text-[9px] font-medium text-gray-700">{formatDelta(deltaMetric, metric)} • {formatDelta(cell.deltaRevenuePerEmail, 'revenuePerEmail')}</span>
                                                            )}
                                                        </div>
                                                        <div className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 z-50 hidden group-hover:block w-64 text-[11px] text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2">
                                                            <p className="font-semibold mb-1 text-gray-900 dark:text-gray-100">{flow} • Step {step}</p>
                                                            <ul className="space-y-0.5">
                                                                <li><span className="text-gray-500 dark:text-gray-400">Emails Sent:</span> {cell.emailsSent.toLocaleString()}</li>
                                                                <li><span className="text-gray-500 dark:text-gray-400">Reach:</span> {backdropWidth.toFixed(1)}%</li>
                                                                <li><span className="text-gray-500 dark:text-gray-400">Rev/Email:</span> ${cell.revenuePerEmail.toFixed(2)} {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaRevenuePerEmail, 'revenuePerEmail')})</span>}</li>
                                                                <li><span className="text-gray-500 dark:text-gray-400">Open Rate:</span> {cell.openRate.toFixed(2)}% {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaOpenRate, 'openRate')})</span>}</li>
                                                                {hasClicks && <li><span className="text-gray-500 dark:text-gray-400">CTR:</span> {cell.clickRate.toFixed(2)}% {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaClickRate, 'clickRate')})</span>}</li>}
                                                                {hasConv && <li><span className="text-gray-500 dark:text-gray-400">CVR:</span> {cell.conversionRate.toFixed(2)}% {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaConversionRate, 'conversionRate')})</span>}</li>}
                                                            </ul>
                                                            {biggestNeg[flow] === step && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">Largest negative Rev/Email delta in this flow.</p>}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="group relative w-16 h-14">
                                                        <div className={`absolute inset-0 rounded-md flex items-center justify-center text-[10px] font-semibold text-gray-900 dark:text-gray-900 ${chipColor}`}>{formatValue(value, metric)}</div>
                                                        <div className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 z-50 hidden group-hover:block w-60 text-[11px] text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2">
                                                            <p className="font-semibold mb-1 text-gray-900 dark:text-gray-100">{flow} • Step {step}</p>
                                                            <ul className="space-y-0.5">
                                                                <li><span className="text-gray-500 dark:text-gray-400">Emails Sent:</span> {cell.emailsSent.toLocaleString()}</li>
                                                                <li><span className="text-gray-500 dark:text-gray-400">Reach:</span> {backdropWidth.toFixed(1)}%</li>
                                                                <li><span className="text-gray-500 dark:text-gray-400">Rev/Email:</span> ${cell.revenuePerEmail.toFixed(2)} {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaRevenuePerEmail, 'revenuePerEmail')})</span>}</li>
                                                                <li><span className="text-gray-500 dark:text-gray-400">Open Rate:</span> {cell.openRate.toFixed(2)}% {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaOpenRate, 'openRate')})</span>}</li>
                                                                {hasClicks && <li><span className="text-gray-500 dark:text-gray-400">CTR:</span> {cell.clickRate.toFixed(2)}% {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaClickRate, 'clickRate')})</span>}</li>}
                                                                {hasConv && <li><span className="text-gray-500 dark:text-gray-400">CVR:</span> {cell.conversionRate.toFixed(2)}% {step > 1 && <span className="text-gray-400">({formatDelta(cell.deltaConversionRate, 'conversionRate')})</span>}</li>}
                                                            </ul>
                                                            {biggestNeg[flow] === step && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">Largest negative Rev/Email delta in this flow.</p>}
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 text-[10px] text-gray-500 dark:text-gray-400">Color = Δ Rev/Email vs prior step (green up / red down). Backdrop width = reach (sends as % of step 1). Dot marks largest negative drop.</div>
        </div>
    );
}
