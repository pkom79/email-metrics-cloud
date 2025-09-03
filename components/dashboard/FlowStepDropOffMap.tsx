"use client";
import React, { useMemo, useState } from 'react';
import { Flame, Info } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

interface Props { dateRange: string; customFrom?: string; customTo?: string; }

interface CellDatum {
    flowName: string;
    sequencePosition: number;
    revenuePerEmail: number;
    openRate: number; // %
    deltaRevenuePerEmail: number; // vs previous step (absolute diff)
    deltaOpenRate: number; // percentage point diff
}

export default function FlowStepDropOffMap({ dateRange, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const flowEmails = dm.getFlowEmails().filter(f => f.status?.toLowerCase() === 'live');

    // Date filtering logic (reuse simple slice like FlowStepAnalysis) - approximate
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

    const data = useMemo(() => {
        const byFlow: Record<string, CellDatum[]> = {};
        for (const e of filtered) {
            const flow = e.flowName || 'Unknown Flow';
            if (!byFlow[flow]) byFlow[flow] = [];
            // Aggregate per position first
            let cell = byFlow[flow].find(c => c.sequencePosition === e.sequencePosition);
            if (!cell) { cell = { flowName: flow, sequencePosition: e.sequencePosition, revenuePerEmail: 0, openRate: 0, deltaRevenuePerEmail: 0, deltaOpenRate: 0 }; byFlow[flow].push(cell); }
            // We'll accumulate sums then average later; store temporarily in revenuePerEmail as total revenue and use openRate as total emails open for accumulation
            (cell as any)._totalRevenue = ((cell as any)._totalRevenue || 0) + e.revenue;
            (cell as any)._totalEmails = ((cell as any)._totalEmails || 0) + e.emailsSent;
            (cell as any)._totalOpens = ((cell as any)._totalOpens || 0) + e.uniqueOpens;
        }
        Object.values(byFlow).forEach(rows => {
            rows.sort((a, b) => a.sequencePosition - b.sequencePosition);
            rows.forEach(r => {
                const totalRevenue = (r as any)._totalRevenue || 0;
                const totalEmails = (r as any)._totalEmails || 0;
                const totalOpens = (r as any)._totalOpens || 0;
                r.revenuePerEmail = totalEmails > 0 ? totalRevenue / totalEmails : 0;
                r.openRate = totalEmails > 0 ? (totalOpens / totalEmails) * 100 : 0;
            });
            rows.forEach((r, i) => {
                if (i === 0) { r.deltaRevenuePerEmail = 0; r.deltaOpenRate = 0; }
                else {
                    const prev = rows[i - 1];
                    r.deltaRevenuePerEmail = r.revenuePerEmail - prev.revenuePerEmail;
                    r.deltaOpenRate = r.openRate - prev.openRate; // p.p.
                }
            });
        });
        const flat: CellDatum[] = Object.values(byFlow).flat();
        return { byFlow, flat };
    }, [filtered]);

    const flows = useMemo(() => Object.keys(data.byFlow || {}).sort(), [data]);
    const maxSeq = useMemo(() => Math.max(0, ...flows.map(f => Math.max(...data.byFlow[f].map(r => r.sequencePosition)))), [flows, data]);

    if (!flows.length) return null;

    // Determine delta ranges for color scaling
    const deltaValues = data.flat.filter(c => c.sequencePosition > 1).map(c => c.deltaRevenuePerEmail);
    const minDelta = Math.min(0, ...deltaValues, 0);
    const maxDelta = Math.max(0, ...deltaValues, 0);
    const scale = (v: number) => {
        if (v === 0) return 'bg-gray-200 dark:bg-gray-800';
        if (v < 0) {
            // stronger negative -> deeper rose
            const pct = maxDelta === 0 ? 1 : Math.min(1, Math.abs(v) / Math.abs(minDelta || -1));
            return pct > 0.66 ? 'bg-rose-600' : pct > 0.33 ? 'bg-rose-500' : 'bg-rose-400';
        } else {
            const pct = maxDelta === 0 ? 1 : Math.min(1, v / (maxDelta || 1));
            return pct > 0.66 ? 'bg-green-600' : pct > 0.33 ? 'bg-green-500' : 'bg-green-400';
        }
    };

    // Identify biggest negative deltas per flow
    const biggestNeg: Record<string, number> = {};
    flows.forEach(f => {
        const negatives = data.byFlow[f].filter(r => r.deltaRevenuePerEmail < 0);
        if (negatives.length) {
            negatives.sort((a, b) => a.deltaRevenuePerEmail - b.deltaRevenuePerEmail); // ascending (most negative first)
            biggestNeg[f] = negatives[0].sequencePosition;
        }
    });

    const formatCurrency = (v: number) => '$' + (v).toFixed(v >= 10 ? 2 : 3).replace(/\.0+$/, '');
    const formatPct = (v: number) => v.toFixed(Math.abs(v) >= 10 ? 1 : 2) + '%';

    return (
        <div className="mt-8 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Flow Step Drop-Off Map</h3>
                <div className="group relative">
                    <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                    <div className="absolute left-0 top-6 z-20 hidden group-hover:block w-96 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 space-y-2">
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">What</p>
                        <p className="text-gray-600 dark:text-gray-300">Heatmap of per-step performance deltas. Each cell shows Revenue/Email & Open Rate delta vs prior step.</p>
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">Why</p>
                        <p className="text-gray-600 dark:text-gray-300">Quickly isolates weak points where a flow starts leaking value—optimize copy, timing, or branching.</p>
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">Color</p>
                        <p className="text-gray-600 dark:text-gray-300">Green = lift vs previous step, Rose = drop. Intensity ~ size of Revenue/Email delta.</p>
                        <p className="text-gray-500 dark:text-gray-400">Largest negative per flow flagged with ⚠.</p>
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-[11px]">
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-white dark:bg-gray-900 z-10 text-left px-2 py-1 font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">Flow</th>
                            {Array.from({ length: maxSeq }, (_, i) => i + 1).map(step => (
                                <th key={step} className="px-2 py-1 text-gray-600 dark:text-gray-400 font-medium border-b border-gray-200 dark:border-gray-700">S{step}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {flows.map(flow => {
                            const row = data.byFlow[flow];
                            return (
                                <tr key={flow} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                                    <td className="sticky left-0 bg-white dark:bg-gray-900 px-2 py-1 font-medium text-gray-800 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">{flow}</td>
                                    {Array.from({ length: maxSeq }, (_, i) => i + 1).map(step => {
                                        const cell = row.find(r => r.sequencePosition === step);
                                        if (!cell) return <td key={step} className="px-1 py-1 align-top border-b border-gray-100 dark:border-gray-800" />;
                                        const isFlag = biggestNeg[flow] === step && step > 1 && cell.deltaRevenuePerEmail < 0;
                                        return (
                                            <td key={step} className="px-1 py-1 border-b border-gray-100 dark:border-gray-800 align-top">
                                                <div className={`group relative rounded-md h-14 w-20 flex flex-col justify-center items-center text-center text-[10px] text-white font-medium ${scale(cell.deltaRevenuePerEmail)} transition-colors`}>
                                                    <div className="leading-tight px-1">
                                                        <div>{formatCurrency(cell.revenuePerEmail)}</div>
                                                        {step > 1 && <div className={cell.deltaRevenuePerEmail < 0 ? 'text-rose-50' : 'text-emerald-50'}>{cell.deltaRevenuePerEmail >= 0 ? '+' : ''}{formatCurrency(cell.deltaRevenuePerEmail)}</div>}
                                                    </div>
                                                    {isFlag && <span className="absolute top-0 right-0 text-[9px]">⚠</span>}
                                                    <div className="absolute inset-0 rounded-md ring-1 ring-inset ring-black/5 pointer-events-none" />
                                                    <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 z-50 hidden group-hover:block w-56 text-[11px] text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2">
                                                        <p className="font-semibold mb-1 text-gray-800 dark:text-gray-100">{flow} • Step {step}</p>
                                                        <ul className="space-y-0.5">
                                                            <li><span className="text-gray-500 dark:text-gray-400">Revenue/Email:</span> {formatCurrency(cell.revenuePerEmail)}</li>
                                                            {step > 1 && <li><span className="text-gray-500 dark:text-gray-400">Delta Rev/Email:</span> {cell.deltaRevenuePerEmail >= 0 ? '+' : ''}{formatCurrency(cell.deltaRevenuePerEmail)}</li>}
                                                            <li><span className="text-gray-500 dark:text-gray-400">Open Rate:</span> {formatPct(cell.openRate)}</li>
                                                            {step > 1 && <li><span className="text-gray-500 dark:text-gray-400">Delta Open Rate:</span> {cell.deltaOpenRate >= 0 ? '+' : ''}{cell.deltaOpenRate.toFixed(2)}pp</li>}
                                                        </ul>
                                                        {isFlag && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">Largest negative revenue/Email drop in this flow.</p>}
                                                    </div>
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 text-[10px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-4">
                <div><span className="font-medium text-gray-600 dark:text-gray-300">Legend:</span> Cell color intensity reflects revenue/email delta vs previous step.</div>
                <div>⚠ largest negative delta in flow</div>
            </div>
        </div>
    );
}