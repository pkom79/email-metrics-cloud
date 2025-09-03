"use client";
import React, { useMemo } from 'react';
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
    const cellBaseSize = maxSeq > 12 ? 'w-16 h-16' : 'w-20 h-16';

    if (!flows.length) return null;

    // Dual scaling: revenue (top) and open rate (bottom)
    const revDeltas = data.flat.filter(c => c.sequencePosition > 1).map(c => c.deltaRevenuePerEmail);
    const minRev = Math.min(0, ...revDeltas, 0);
    const maxRev = Math.max(0, ...revDeltas, 0);
    const openDeltas = data.flat.filter(c => c.sequencePosition > 1).map(c => c.deltaOpenRate);
    const minOpen = Math.min(0, ...openDeltas, 0);
    const maxOpen = Math.max(0, ...openDeltas, 0);
    const scaleSegment = (v: number, isFirst: boolean, min: number, max: number, pos: string[], neg: string[], neutral: string) => {
        if (isFirst) return neutral;
        if (v === 0) return neutral;
        if (v < 0) {
            const pct = max === 0 ? 1 : Math.min(1, Math.abs(v) / Math.abs(min || -1));
            return pct > 0.66 ? neg[2] : pct > 0.33 ? neg[1] : neg[0];
        }
        const pct = max === 0 ? 1 : Math.min(1, v / (max || 1));
        return pct > 0.66 ? pos[2] : pct > 0.33 ? pos[1] : pos[0];
    };
    const revBg = (v: number, isFirst: boolean) => scaleSegment(v, isFirst, minRev, maxRev, ['bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300'], ['bg-rose-100', 'bg-rose-200', 'bg-rose-300'], 'bg-gray-100 dark:bg-gray-700/40');
    const openBg = (v: number, isFirst: boolean) => scaleSegment(v, isFirst, minOpen, maxOpen, ['bg-emerald-50', 'bg-emerald-100', 'bg-emerald-200'], ['bg-rose-50', 'bg-rose-100', 'bg-rose-200'], 'bg-gray-200 dark:bg-gray-800/40');

    // Identify biggest negative deltas per flow
    const biggestNeg: Record<string, number> = {};
    flows.forEach(f => {
        const negatives = data.byFlow[f].filter(r => r.deltaRevenuePerEmail < 0);
        if (negatives.length) {
            negatives.sort((a, b) => a.deltaRevenuePerEmail - b.deltaRevenuePerEmail); // ascending (most negative first)
            biggestNeg[f] = negatives[0].sequencePosition;
        }
    });

    const formatCurrency = (v: number) => '$' + v.toFixed(2);
    const formatPct = (v: number) => v.toFixed(Math.abs(v) >= 10 ? 1 : 2) + '%';
    const formatDeltaPp = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + 'pp';

    return (
        <div className="mt-8 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Flow Step Drop-Off Map</h3>
                <div className="group relative">
                    <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                    <div className="absolute left-0 top-6 z-20 hidden group-hover:block w-96 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 space-y-2">
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">What</p>
                        <p className="text-gray-600 dark:text-gray-300">Heatmap of per-step performance vs the previous email in each flow. Top = change in Revenue/Email, Bottom = current Open Rate.</p>
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">Why</p>
                        <p className="text-gray-600 dark:text-gray-300">Quickly isolates weak points where a flow starts leaking value—optimize copy, timing, or branching.</p>
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">Color</p>
                        <p className="text-gray-600 dark:text-gray-300">Green = positive Revenue/Email lift vs prior step. Red = drop. Deeper shade = larger movement. First step is neutral (baseline).</p>
                        <p className="text-gray-700 dark:text-gray-200 font-semibold">Reading a Cell</p>
                        <p className="text-gray-600 dark:text-gray-300"><span className="font-medium">Top:</span> Δ Rev/Email (vs prior). <span className="font-medium">Bottom:</span> Open Rate (absolute). Hover for full detail incl. deltas.</p>
                        <p className="text-gray-500 dark:text-gray-400">⚠ flags the largest negative revenue/email drop in that flow.</p>
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
                                    <td className="sticky left-0 bg-white dark:bg-gray-900 px-2 py-1 font-semibold text-gray-800 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap {maxSeq > 14 ? 'text-[11px]' : 'text-sm'}">{flow}</td>
                                    {Array.from({ length: maxSeq }, (_, i) => i + 1).map(step => {
                                        const cell = row.find(r => r.sequencePosition === step);
                                        if (!cell) return <td key={step} className="px-1 py-1 align-top border-b border-gray-100 dark:border-gray-800" />;
                                        const isFlag = biggestNeg[flow] === step && step > 1 && cell.deltaRevenuePerEmail < 0;
                                        return (
                                            <td key={step} className="px-1 py-1 border-b border-gray-100 dark:border-gray-800 align-top">
                                                <div className={`group relative rounded-md ${cellBaseSize} flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700`}>
                                                    {isFlag && <span className="absolute top-0 right-0 text-[9px] px-0.5 pt-0.5">⚠</span>}
                                                    <div className={`flex-1 flex items-center justify-center px-1 text-[10px] font-semibold leading-tight text-gray-900 dark:text-gray-100 ${revBg(cell.deltaRevenuePerEmail, step === 1)}`}>{step === 1 ? `Base ${formatCurrency(cell.revenuePerEmail)}` : `${cell.deltaRevenuePerEmail >= 0 ? '+' : ''}${formatCurrency(cell.deltaRevenuePerEmail)}`}</div>
                                                    <div className="h-px bg-gray-300 dark:bg-gray-600" />
                                                    <div className={`flex-1 flex items-center justify-center px-1 pb-0.5 text-[10px] font-medium leading-tight text-gray-900 dark:text-gray-100 ${openBg(cell.deltaOpenRate, step === 1)}`}>
                                                        {step === 1 ? formatPct(cell.openRate) : (
                                                            <span className="flex flex-col items-center leading-tight">
                                                                <span>{formatPct(cell.openRate)}</span>
                                                                <span className="text-[9px] font-normal text-gray-700 dark:text-gray-200/80">{formatDeltaPp(cell.deltaOpenRate)}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 z-50 hidden group-hover:block w-60 text-[11px] text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2">
                                                        <p className="font-semibold mb-1 text-gray-900 dark:text-gray-100">{flow} • Step {step}</p>
                                                        <ul className="space-y-0.5">
                                                            <li><span className="text-gray-500 dark:text-gray-400">Revenue/Email:</span> {formatCurrency(cell.revenuePerEmail)}</li>
                                                            {step > 1 && <li><span className="text-gray-500 dark:text-gray-400">Δ Rev/Email:</span> {cell.deltaRevenuePerEmail >= 0 ? '+' : ''}{formatCurrency(cell.deltaRevenuePerEmail)}</li>}
                                                            <li><span className="text-gray-500 dark:text-gray-400">Open Rate:</span> {formatPct(cell.openRate)}</li>
                                                            {step > 1 && <li><span className="text-gray-500 dark:text-gray-400">Δ Open Rate:</span> {cell.deltaOpenRate >= 0 ? '+' : ''}{cell.deltaOpenRate.toFixed(2)}pp</li>}
                                                        </ul>
                                                        {isFlag && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">Largest negative revenue/email drop in this flow.</p>}
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
            <div className="mt-4 text-[10px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-6 items-center">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-600 dark:text-gray-300">Legend:</span>
                    <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded-sm overflow-hidden border border-gray-300 dark:border-gray-600 flex flex-col">
                            <div className="flex-1 bg-emerald-200" />
                            <div className="flex-1 bg-emerald-100" />
                        </div>
                        <span className="whitespace-nowrap">Positive movement</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded-sm overflow-hidden border border-gray-300 dark:border-gray-600 flex flex-col">
                            <div className="flex-1 bg-rose-300" />
                            <div className="flex-1 bg-rose-200" />
                        </div>
                        <span className="whitespace-nowrap">Negative movement</span>
                    </div>
                </div>
                <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-gray-300 dark:bg-gray-700 border border-gray-300 dark:border-gray-600" /> Baseline (Step 1)</div>
                <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-600 dark:text-gray-300">Top Half:</span> Δ Revenue/Email vs previous step (color intensity = magnitude)
                </div>
                <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-600 dark:text-gray-300">Bottom Half:</span> Open Rate (text) & Δ Open Rate (small line) — shading = Δ Open Rate magnitude
                </div>
                <div>⚠ largest negative Δ Rev/Email in flow</div>
            </div>
        </div>
    );
}