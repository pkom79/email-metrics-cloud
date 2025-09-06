"use client";
import React, { useMemo, useState, useRef, useEffect } from 'react';
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

// Compact currency formatting for better readability
const formatCompactCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${Math.round(value)}`;
};

// Heatmap-only step cell (big number, tooltip above, no reach bar line)
const StepCell: React.FC<{
    metric: MetricKey; value: number; delta: number; onHoverData: any;
}> = ({ metric, value, delta, onHoverData }) => {
    const isCurrency = metric === 'revenuePerEmail';
    const displayValue = isCurrency ? formatCompactCurrency(value) : `${value.toFixed(1)}%`;
    const mag = Math.min(1, Math.abs(delta) / (isCurrency ? 2 : 10));
    const bg = delta === 0 ? 'rgba(147,51,234,0.05)' : delta > 0 ? `rgba(16,185,129,${0.18 + mag * 0.4})` : `rgba(244,63,94,${0.18 + mag * 0.4})`;
    return (
        <div className="relative group rounded-lg px-3 py-3 font-semibold text-gray-900 text-base leading-none select-none" style={{ background: bg }}>
            <span className="tabular-nums">{displayValue}</span>
            <div className="pointer-events-none absolute left-1/2 bottom-full z-[60] hidden -translate-x-1/2 -translate-y-2 group-hover:block">
                <div className="w-64 rounded-xl border border-gray-200 bg-white shadow-xl p-4 text-[11px] text-gray-800">
                    <p className="font-semibold mb-2">{onHoverData.flow} • Step {onHoverData.step}</p>
                    <table className="w-full text-[11px]">
                        <tbody>
                            <tr><td className="text-gray-500 pr-2">Sends</td><td className="text-right tabular-nums">{onHoverData.emails.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Opens</td><td className="text-right tabular-nums">{onHoverData.opens.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Clicks</td><td className="text-right tabular-nums">{onHoverData.clicks.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Conversions</td><td className="text-right tabular-nums">{onHoverData.orders.toLocaleString()}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Revenue</td><td className="text-right tabular-nums">{formatCompactCurrency(onHoverData.revenue)}</td></tr>
                            <tr><td className="text-gray-500 pr-2">Rev/Email</td><td className="text-right tabular-nums">{formatCompactCurrency(onHoverData.rpe)}</td></tr>
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
    const [showScrollIndicators, setShowScrollIndicators] = useState(false);
    const tableContainerRef = useRef<HTMLDivElement>(null);

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
            const delta = (metric === 'revenuePerEmail' ? c.deltaRevenuePerEmail : metric === 'openRate' ? c.deltaOpenRate : metric === 'clickRate' ? c.deltaClickRate : c.deltaConversionRate);
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

    // Check if scrolling is needed for fade indicators
    useEffect(() => {
        const checkScrollable = () => {
            if (tableContainerRef.current) {
                const { scrollWidth, clientWidth } = tableContainerRef.current;
                setShowScrollIndicators(scrollWidth > clientWidth);
            }
        };

        checkScrollable();
        window.addEventListener('resize', checkScrollable);

        return () => window.removeEventListener('resize', checkScrollable);
    }, [flows, effectiveMax]);

    const reachPct = (flow: string, step: number) => { // retained for tooltip percentage possibility (not displayed visually now)
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
                    <h3 className="text-lg font-semibold text-gray-900 tracking-tight flex items-center gap-2">Flow Step Drop-Off
                        <span className="relative group inline-flex items-center">
                            <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 cursor-pointer" />
                            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-6 z-30 hidden group-hover:block w-80 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                                <span className="font-semibold block mb-1">Metrics</span>
                                Open rate = unique opens / delivered. CTR = unique clicks / delivered. CVR = conversions / delivered. Rev/Email = revenue / delivered.
                                <br /><br />Color shows delta vs previous step (green up, red down). Larger saturation = larger change.
                            </span>
                        </span>
                    </h3>
                </div>
                <div className="relative">
                    <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} className="appearance-none px-3 h-9 pr-8 rounded-lg border bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                        {metricOptions.filter(o => o.available).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
                </div>
            </div>
            <div className="relative rounded-2xl overflow-hidden bg-white">
                {/* Enhanced fade overlays - only show when scrollable */}
                {showScrollIndicators && (
                    <>
                        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white via-white/95 via-white/70 to-transparent z-30 pointer-events-none"></div>
                        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white via-white/95 via-white/70 to-transparent z-30 pointer-events-none"></div>
                    </>
                )}

                <div
                    ref={tableContainerRef}
                    className="overflow-x-auto overflow-y-visible scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
                >
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
                                return (
                                    <tr key={flow} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="sticky left-0 bg-inherit border-b border-gray-200 px-3 py-3 align-top">
                                            <div className="flex items-center gap-1 text-sm font-semibold text-gray-900 whitespace-nowrap">
                                                {largestNegPosition[flow] && <span className="w-2 h-2 rounded-full bg-rose-500" aria-label={`Largest negative delta at step ${largestNegPosition[flow]}`}></span>}
                                                <span title={flow}>{flow}</span>
                                            </div>
                                        </td>
                                        {Array.from({ length: effectiveMax }, (_, i) => i + 1).map(step => {
                                            const cell = arr.find(c => c.sequencePosition === step);
                                            if (!cell) return <td key={step} className="px-3 py-3 border-b border-gray-200 text-center text-xs text-gray-400" aria-label="No step">–</td>;
                                            const reach = reachPct(flow, step);
                                            const deltaVal = step === 1 ? 0 : (metric === 'revenuePerEmail' ? cell.deltaRevenuePerEmail : metric === 'openRate' ? cell.deltaOpenRate : metric === 'clickRate' ? cell.deltaClickRate : cell.deltaConversionRate);
                                            return (
                                                <td key={step} className="group px-3 py-3 border-b border-gray-200 align-top text-center">
                                                    <StepCell metric={metric} value={(cell as any)[metric]} delta={deltaVal} onHoverData={{ flow, step, emails: cell.emailsSent, opens: cell.opens, clicks: cell.clicks, orders: cell.orders, revenue: cell.revenue, rpe: cell.revenuePerEmail, openRate: cell.openRate, clickRate: cell.clickRate }} />
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            {!flows.length && (
                <div className="mt-4 space-y-2" aria-label="Loading flows">
                    {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />)}
                </div>
            )}
        </div>
    );
}
