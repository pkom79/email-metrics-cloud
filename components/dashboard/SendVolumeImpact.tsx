"use client";
import React, { useMemo, useState } from 'react';
import { Info, SlidersHorizontal, Activity } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';
import { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

interface Props { dateRange: string; customFrom?: string; customTo?: string; }

type MetricKey = 'totalRevenue' | 'revenuePerEmail' | 'unsubsPer1k' | 'spamPer1k' | 'bouncesPer1k';
type SourceScope = 'all' | 'campaigns' | 'flows';

interface Bucket {
    label: string; // display label
    date: Date;   // start date (daily) or period end (weekly/monthly label already aggregated outside)
    revenue: number;
    emails: number;
    unsubs: number;
    spam: number;
    bounces: number;
}

const METRIC_OPTIONS: { value: MetricKey; label: string; unit: string }[] = [
    { value: 'totalRevenue', label: 'Total Revenue', unit: '$' },
    { value: 'revenuePerEmail', label: 'Revenue / Email', unit: '$' },
    { value: 'unsubsPer1k', label: 'Unsubs / 1K', unit: 'per 1k sends' },
    { value: 'spamPer1k', label: 'Spam / 1K', unit: 'per 1k sends' },
    { value: 'bouncesPer1k', label: 'Bounce / 1K', unit: 'per 1k sends' },
];

const NEGATIVE_METRICS: MetricKey[] = ['unsubsPer1k', 'spamPer1k', 'bouncesPer1k'];

// Guardrails (approx industry heuristics) per 1k emails
const THRESHOLDS = {
    unsubsPer1k: 5,      // 0.5%
    spamPer1k: 0.2,      // 0.02%
    bouncesPer1k: 10     // 1%
};

// Minimum emails per bucket for rate / per-email metrics to render with confidence
const MIN_EMAILS_PER_BUCKET_RPE = 200;
const MIN_EMAILS_PER_BUCKET_PER1K = 300;

// Dead-zone percentage change thresholds
const DEAD_ZONE = {
    totalRevenue: 0.02,
    revenuePerEmail: 0.02,
    unsubsPer1k: 0.05,
    spamPer1k: 0.05,
    bouncesPer1k: 0.05,
};

// Utility formatters
const fmtCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtNum = (v: number, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '—';

// ChartContainer renders dual-axis SVG + tooltip + baseline band
interface ChartSeriesPoint { x: number; value: number | null; raw?: number; emails?: number; label: string; compare?: number | null; baseline?: number | null; lowBand?: number | null; highBand?: number | null; faded?: boolean; }
interface ChartContainerProps { points: ChartSeriesPoint[]; metric: MetricKey; unit: string; emailsMax: number; metricMax: number; compareOn: boolean; showBaseline: boolean; threshold?: number; negative?: boolean; }

const ChartContainer: React.FC<ChartContainerProps> = ({ points, metric, unit, emailsMax, metricMax, compareOn, showBaseline, threshold, negative }) => {
    // Dimensions
    const H = 220; const PAD_L = 52; const PAD_R = 52; const PAD_T = 18; const PAD_B = 34;
    const innerH = H - PAD_T - PAD_B; const W = Math.max(640, points.length * 56); const innerW = W - PAD_L - PAD_R;
    const xScale = (i: number) => points.length <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (points.length - 1)) * innerW;
    const yMetric = (v: number) => PAD_T + (1 - (v / (metricMax || 1))) * innerH;
    const yEmails = (v: number) => PAD_T + (1 - (v / (emailsMax || 1))) * innerH;

    const pathLine = (vals: (number | null)[], yFn: (v: number) => number) => {
        let d = ''; vals.forEach((v, i) => { if (v == null) return; const x = xScale(i); const y = yFn(v); d += (d ? ' L' : 'M') + x + ' ' + y; }); return d;
    };

    const metricVals = points.map(p => p.value);
    const compareVals = points.map(p => p.compare ?? null);
    const baselineVals = points.map(p => p.baseline ?? null);
    const areaEmailsPath = (() => { let d = ''; points.forEach((p, i) => { const x = xScale(i); const y = yEmails(p.emails || 0); d += (i === 0 ? 'M' : ' L') + x + ' ' + y; }); if (points.length) { const lastX = xScale(points.length - 1); d += ' L ' + lastX + ' ' + (PAD_T + innerH) + ' L ' + xScale(0) + ' ' + (PAD_T + innerH) + ' Z'; } return d; })();

    // Tooltip state (client-only interactions)
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const active = hoverIdx != null ? points[hoverIdx] : null;

    return (
        <div className="relative">
            <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[240px] select-none" role="img" aria-label="Send Volume Impact chart">
                    {/* Background tint */}
                    <rect x={0} y={0} width={W} height={H} className="fill-purple-50 dark:fill-purple-900/10" />
                    {/* Emails area (right axis) */}
                    <path d={areaEmailsPath} className="fill-purple-200/40 dark:fill-purple-800/30" />
                    {/* Baseline band */}
                    {showBaseline && points.some(p => p.lowBand != null && p.highBand != null) && points.map((p, i) => (
                        (p.lowBand != null && p.highBand != null && p.value != null) ? <line key={'band-' + i} x1={xScale(i)} x2={xScale(i)} y1={yMetric(p.lowBand)} y2={yMetric(p.highBand)} className="stroke-purple-300/40 dark:stroke-purple-600/30" strokeWidth={6} strokeLinecap="round" /> : null
                    ))}
                    {/* Baseline expected line */}
                    {showBaseline && <path d={pathLine(baselineVals, yMetric)} className="stroke-purple-400 dark:stroke-purple-500" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />}
                    {/* Threshold line for negative metrics */}
                    {threshold != null && negative && (
                        <line x1={PAD_L} x2={W - PAD_R} y1={yMetric(threshold)} y2={yMetric(threshold)} className="stroke-rose-400 dark:stroke-rose-500" strokeWidth={1} strokeDasharray="3 3" />
                    )}
                    {/* Compare line */}
                    {compareOn && <path d={pathLine(compareVals, yMetric)} className="stroke-gray-400 dark:stroke-gray-500" strokeDasharray="4 4" strokeWidth={1.25} fill="none" />}
                    {/* Metric line */}
                    <path d={pathLine(metricVals, yMetric)} className="stroke-purple-600 dark:stroke-purple-400" strokeWidth={2.25} fill="none" />
                    {/* Points (interactive) */}
                    {points.map((p, i) => {
                        if (p.value == null) return null;
                        const x = xScale(i); const y = yMetric(p.value);
                        const cls = p.faded ? 'fill-purple-400/40 dark:fill-purple-500/30' : 'fill-white dark:fill-gray-900 stroke-purple-600 dark:stroke-purple-400';
                        return <circle key={i} cx={x} cy={y} r={4} className={cls} strokeWidth={p.faded ? 0 : 1.5} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />;
                    })}
                    {/* Axes */}
                    {/* Left axis ticks */}
                    {(() => {
                        const ticks: number[] = [];
                        const steps = 4; for (let i = 0; i <= steps; i++) { ticks.push((metricMax / steps) * i); }
                        return ticks.map(t => {
                            return <g key={t}>
                                <text x={PAD_L - 6} y={yMetric(t) + 4} textAnchor="end" className="fill-gray-500 dark:fill-gray-400 text-[10px] tabular-nums">{NEGATIVE_METRICS.includes(metric) ? fmtNum(t, t >= 1 ? 1 : 2) : (metric === 'totalRevenue' || metric === 'revenuePerEmail' ? (t >= 1000 ? '$' + (t / 1000).toFixed(1) + 'k' : '$' + t.toFixed(0)) : fmtNum(t, t >= 1 ? 1 : 2))}</text>
                            </g>;
                        });
                    })()}
                    <text x={PAD_L} y={12} className="fill-gray-600 dark:fill-gray-300 text-[10px] font-medium">{METRIC_OPTIONS.find(m => m.value === metric)?.label}</text>
                    {/* Right axis ticks */}
                    {(() => {
                        const ticks: number[] = []; const steps = 4; for (let i = 0; i <= steps; i++) { ticks.push((emailsMax / steps) * i); }
                        return ticks.map(t => <g key={t}><text x={W - PAD_R + 4} y={yEmails(t) + 4} className="fill-gray-500 dark:fill-gray-400 text-[10px]" >{t >= 1000 ? (t / 1000).toFixed(1) + 'k' : Math.round(t)}</text></g>);
                    })()}
                    <text x={W - PAD_R} y={12} textAnchor="end" className="fill-gray-600 dark:fill-gray-300 text-[10px] font-medium">Emails Sent</text>
                    {/* X-axis labels */}
                    {points.map((p, i) => <text key={p.label} x={xScale(i)} y={H - 4} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400 text-[10px]">{p.label}</text>)}
                </svg>
            </div>
            {active && (
                <div className="pointer-events-none absolute left-0 top-0 mt-2 ml-2 rounded-md bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-200 dark:border-gray-700 shadow px-3 py-2 text-[11px] text-gray-700 dark:text-gray-300 space-y-1">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{active.label}</div>
                    <div className="flex justify-between gap-3"><span>Emails</span><span className="tabular-nums">{active.emails?.toLocaleString() || 0}</span></div>
                    <div className="flex justify-between gap-3"><span>{METRIC_OPTIONS.find(m => m.value === metric)?.label}</span><span className="tabular-nums">{(() => { if (active.value == null) return '—'; if (metric === 'totalRevenue' || metric === 'revenuePerEmail') return fmtCurrency(active.value); return fmtNum(active.value, active.value >= 1 ? 2 : 3); })()}</span></div>
                    {compareOn && active.compare != null && <div className="flex justify-between gap-3"><span>Prev</span><span className="tabular-nums">{metric === 'totalRevenue' || metric === 'revenuePerEmail' ? fmtCurrency(active.compare) : fmtNum(active.compare, active.compare >= 1 ? 2 : 3)}</span></div>}
                    {active.baseline != null && <div className="flex justify-between gap-3"><span>Expected</span><span className="tabular-nums">{metric === 'totalRevenue' || metric === 'revenuePerEmail' ? fmtCurrency(active.baseline) : fmtNum(active.baseline, active.baseline >= 1 ? 2 : 3)}</span></div>}
                </div>
            )}
        </div>
    );
};

export default function SendVolumeImpact({ dateRange, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const campaigns = dm.getCampaigns();
    const flows = dm.getFlowEmails();
    const [metric, setMetric] = useState<MetricKey>('totalRevenue');
    const [scope, setScope] = useState<SourceScope>('all');
    const [compare, setCompare] = useState<boolean>(false);
    const [lagDays, setLagDays] = useState<number>(0);
    const [showBaseline, setShowBaseline] = useState<boolean>(true);

    // Determine effective date range boundaries (mirror DataManager logic)
    const range = useMemo(() => {
        const rangeRes = (dm as any)._computeDateRangeForTimeSeries?.(dateRange, customFrom, customTo); // private but exists
        if (rangeRes) return rangeRes; // fallback manual
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { startDate: new Date(customFrom + 'T00:00:00'), endDate: new Date(customTo + 'T23:59:59') };
            const all = [...campaigns, ...flows];
            if (!all.length) return null;
            const times = all.map(e => e.sentDate.getTime());
            const endDate = new Date(Math.max(...times)); endDate.setHours(23, 59, 59, 999);
            if (dateRange === 'all') { const startDate = new Date(Math.min(...times)); startDate.setHours(0, 0, 0, 0); return { startDate, endDate }; }
            const days = parseInt(dateRange.replace('d', ''));
            const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - days + 1); startDate.setHours(0, 0, 0, 0);
            return { startDate, endDate };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, campaigns, flows, dm]);

    // Choose granularity based on span
    const granularity: 'daily' | 'weekly' | 'monthly' = useMemo(() => {
        if (!range) return 'daily';
        const days = Math.max(1, Math.round((range.endDate.getTime() - range.startDate.getTime()) / 86400000) + 1);
        if (days <= 45) return 'daily'; if (days <= 210) return 'weekly'; return 'monthly';
    }, [range]);

    const subset = useMemo(() => {
        if (scope === 'campaigns') return { campaigns, flows: [] as ProcessedFlowEmail[] };
        if (scope === 'flows') return { campaigns: [] as ProcessedCampaign[], flows };
        return { campaigns, flows };
    }, [scope, campaigns, flows]);

    // Build base buckets using dm.getMetricTimeSeries for each needed metric then join on date labels
    const baseSeries = useMemo(() => {
        if (!range) return [] as Bucket[];
        const revenueSeries = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'revenue', dateRange, granularity, customFrom, customTo);
        const emailsSeries = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'emailsSent', dateRange, granularity, customFrom, customTo);
        const unsubRateSeries = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'unsubscribeRate', dateRange, granularity, customFrom, customTo); // percent
        const spamRateSeries = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'spamRate', dateRange, granularity, customFrom, customTo); // percent
        const bounceRateSeries = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'bounceRate', dateRange, granularity, customFrom, customTo); // percent
        const buckets: Bucket[] = revenueSeries.map((r, i) => {
            const emails = emailsSeries[i]?.value || 0;
            const unsubsPer1k = (unsubRateSeries[i]?.value || 0) * 10 * (emails > 0 ? 1 : 0); // percent -> per1k
            const spamPer1k = (spamRateSeries[i]?.value || 0) * 10 * (emails > 0 ? 1 : 0);
            const bouncePer1k = (bounceRateSeries[i]?.value || 0) * 10 * (emails > 0 ? 1 : 0);
            return {
                label: r.date,
                date: new Date(range.startDate.getTime()),
                revenue: r.value,
                emails,
                unsubs: unsubsPer1k * emails / 1000, // store raw counts approx (not strictly needed)
                spam: spamPer1k * emails / 1000,
                bounces: bouncePer1k * emails / 1000
            };
        });
        return buckets;
    }, [dm, subset, dateRange, granularity, customFrom, customTo, range]);

    // Derive metric series values
    const metricSeries = useMemo(() => {
        return baseSeries.map(b => {
            switch (metric) {
                case 'totalRevenue': return b.revenue;
                case 'revenuePerEmail': return b.emails > 0 ? b.revenue / b.emails : null;
                case 'unsubsPer1k': return b.emails > 0 ? (b.unsubs / b.emails) * 1000 : null;
                case 'spamPer1k': return b.emails > 0 ? (b.spam / b.emails) * 1000 : null;
                case 'bouncesPer1k': return b.emails > 0 ? (b.bounces / b.emails) * 1000 : null;
            }
        });
    }, [baseSeries, metric]);

    // Lag (applies only to revenue metrics); shift forward (positive lag means treat revenues as occurring lag days later -> so shift values right)
    const laggedMetricSeries = useMemo(() => {
        if (!['totalRevenue', 'revenuePerEmail'].includes(metric) || lagDays <= 0 || granularity !== 'daily') return metricSeries;
        const lagBuckets = lagDays; // treat 1 day = 1 bucket for daily
        const arr = [...metricSeries];
        for (let i = arr.length - 1; i >= 0; i--) {
            arr[i] = i - lagBuckets >= 0 ? metricSeries[i - lagBuckets] : null;
        }
        return arr;
    }, [metricSeries, metric, lagDays, granularity]);

    // Compare series (previous period same length, aligned by index) simplistic implementation
    const compareSeries = useMemo(() => {
        if (!compare || !range) return [] as (number | null)[];
        const days = baseSeries.length; if (!days) return [];
        // Build previous period by adjusting dateRange manually if custom; we approximate by shifting start/end backwards by total span
        const spanMs = range.endDate.getTime() - range.startDate.getTime() + 86400000;
        const prevStart = new Date(range.startDate.getTime() - spanMs); const prevEnd = new Date(range.endDate.getTime() - spanMs);
        const prevRangeKey = `custom:${prevStart.toISOString().slice(0, 10)}:${prevEnd.toISOString().slice(0, 10)}`;
        const prevRevenue = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'revenue', prevRangeKey, granularity, prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10));
        const prevEmails = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'emailsSent', prevRangeKey, granularity, prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10));
        const prevUnsubRate = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'unsubscribeRate', prevRangeKey, granularity, prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10));
        const prevSpamRate = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'spamRate', prevRangeKey, granularity, prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10));
        const prevBounceRate = dm.getMetricTimeSeries(subset.campaigns, subset.flows, 'bounceRate', prevRangeKey, granularity, prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10));
        return baseSeries.map((_, i) => {
            const emailsPrev = prevEmails[i]?.value || 0;
            switch (metric) {
                case 'totalRevenue': return prevRevenue[i]?.value ?? null;
                case 'revenuePerEmail': return emailsPrev > 0 ? (prevRevenue[i]?.value || 0) / emailsPrev : null;
                case 'unsubsPer1k': return emailsPrev > 0 ? (prevUnsubRate[i]?.value || 0) * 10 : null;
                case 'spamPer1k': return emailsPrev > 0 ? (prevSpamRate[i]?.value || 0) * 10 : null;
                case 'bouncesPer1k': return emailsPrev > 0 ? (prevBounceRate[i]?.value || 0) * 10 : null;
            }
        });
    }, [compare, range, baseSeries, metric, dm, subset, granularity]);

    // Baseline expectation: simple mean + stdev of earlier buckets (excluding last 2 buckets) grouped by same day-of-week for daily, otherwise average of all prior periods
    const baseline = useMemo(() => {
        if (!baseSeries.length) return { expected: [] as (number | null)[], low: [] as (number | null)[], high: [] as (number | null)[] };
        const values = laggedMetricSeries.filter(v => v != null) as number[];
        if (values.length < 4) return { expected: new Array(baseSeries.length).fill(null), low: [], high: [] };
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
        const std = Math.sqrt(variance);
        const expArr = baseSeries.map(() => mean);
        return { expected: expArr, low: expArr.map(() => mean - std), high: expArr.map(() => mean + std) };
    }, [baseSeries, laggedMetricSeries]);

    // Build chart points
    const points = useMemo(() => {
        const emailsMax = Math.max(...baseSeries.map(b => b.emails), 1);
        return baseSeries.map((b, i) => {
            const val = laggedMetricSeries[i];
            const compareVal = compareSeries[i] ?? null;
            const expected = baseline.expected[i];
            const lowBand = baseline.low[i];
            const highBand = baseline.high[i];
            // Minimum denominator check
            let value: number | null = val;
            let faded = false;
            if (value != null) {
                if (metric === 'revenuePerEmail' && b.emails < MIN_EMAILS_PER_BUCKET_RPE) { faded = true; }
                if (NEGATIVE_METRICS.includes(metric) && b.emails < MIN_EMAILS_PER_BUCKET_PER1K) { faded = true; }
            }
            return { x: i, value, emails: b.emails, label: b.label, compare: compareVal, baseline: expected, lowBand, highBand, faded } as ChartSeriesPoint;
        });
    }, [baseSeries, laggedMetricSeries, compareSeries, baseline, metric]);

    const emailsMax = useMemo(() => Math.max(...baseSeries.map(b => b.emails), 1), [baseSeries]);
    const metricMax = useMemo(() => Math.max(1, ...points.map(p => p.value || 0), ...points.map(p => (p.highBand || 0))), [points]);

    // Headline (current bucket = last non-null value)
    const lastPoint = [...points].reverse().find(p => p.value != null) || null;
    const prevPoint = lastPoint ? [...points].slice(0, points.indexOf(lastPoint)).reverse().find(p => p.value != null) : null;
    const pctChange = (lastPoint && prevPoint && prevPoint.value) ? (lastPoint.value! - prevPoint.value!) / (prevPoint.value! || 1) : 0;
    const deadZone = DEAD_ZONE[metric];
    let status: 'good' | 'risk' | 'neutral' = 'neutral';
    const negative = NEGATIVE_METRICS.includes(metric);
    if (lastPoint && prevPoint) {
        if (Math.abs(pctChange) < deadZone) status = 'neutral';
        else if (!negative) status = pctChange > 0 ? 'good' : 'risk';
        else status = pctChange > 0 ? 'risk' : 'good';
    }
    // Guardrail breach chip override for negative metrics
    const threshold = THRESHOLDS[metric as keyof typeof THRESHOLDS];
    const guardrailBreach = negative && lastPoint?.value != null && threshold != null && lastPoint.value > threshold;
    if (guardrailBreach) status = 'risk';

    const formatHeadline = (v: number | null) => {
        if (v == null) return '—';
        if (metric === 'totalRevenue' || metric === 'revenuePerEmail') return fmtCurrency(v);
        return v >= 1 ? v.toFixed(2) : v.toFixed(3);
    };

    // Micro analytics side strip
    const micro = useMemo(() => {
        if (!points.length) return null;
        const valid = points.filter(p => p.value != null && !p.faded);
        const avgEmails = baseSeries.length ? Math.round(baseSeries.reduce((s, b) => s + b.emails, 0) / baseSeries.length) : 0;
        const rpmE = (() => { // revenue per 1000 emails
            const totalRev = baseSeries.reduce((s, b) => s + b.revenue, 0);
            const totalEmails = baseSeries.reduce((s, b) => s + b.emails, 0);
            return totalEmails > 0 ? (totalRev / totalEmails) * 1000 : 0;
        })();
        // median unsub per 1k (compute each bucket unsub per 1k)
        const unsubPer1kValues = baseSeries.filter(b => b.emails > 0).map(b => (b.unsubs / b.emails) * 1000).sort((a, b) => a - b);
        const medianUnsub = unsubPer1kValues.length ? (unsubPer1kValues[Math.floor(unsubPer1kValues.length / 2)]) : 0;
        return { avgEmails, rpmE, medianUnsub };
    }, [points, baseSeries]);

    if (!range) return null;
    const negativeMetric = NEGATIVE_METRICS.includes(metric);

    return (
        <div className="mt-10">
            <div className="flex items-center gap-2 mb-3"><Activity className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Send Volume Impact</h3>
                <div className="relative group">
                    <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                    <div className="absolute left-0 top-6 z-30 hidden group-hover:block w-80 text-[11px] leading-snug bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 space-y-2">
                        <p className="font-semibold text-gray-800 dark:text-gray-100">What</p>
                        <p className="text-gray-600 dark:text-gray-300">Visualizes how send volume relates to a chosen performance or health metric. Dual axes: metric (left) & emails sent (right). Guardrail lines for negative metrics.</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-100">Baseline</p>
                        <p className="text-gray-600 dark:text-gray-300">Expected range (mean ±1σ) derived from the observed window for quick anomaly detection.</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-100">Lag</p>
                        <p className="text-gray-600 dark:text-gray-300">Shift revenue metrics by N days (daily view only) to test delayed attribution.</p>
                        <p className="text-gray-500 dark:text-gray-400 italic">Attribution window fixed for this module; very low-volume buckets appear faded.</p>
                    </div>
                </div>
            </div>
            <div className="rounded-2xl bg-purple-50 dark:bg-purple-950/20 p-4 md:p-5">
                {/* Controls */}
                <div className="flex flex-wrap gap-3 items-center mb-4 text-xs">
                    <div className="flex items-center gap-1">
                        <span className="text-gray-600 dark:text-gray-300 font-medium">Metric</span>
                        <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} className="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100">
                            {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-gray-600 dark:text-gray-300 font-medium">Source</span>
                        <select value={scope} onChange={e => setScope(e.target.value as SourceScope)} className="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100">
                            <option value="all">All Emails</option>
                            <option value="campaigns">Campaigns</option>
                            <option value="flows">Flows</option>
                        </select>
                    </div>
                    <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} className="rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
                        <span className="text-gray-600 dark:text-gray-300">Compare prev period</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} className="rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
                        <span className="text-gray-600 dark:text-gray-300">Baseline band</span>
                    </label>
                    <div className="flex items-center gap-1">
                        <span className="text-gray-600 dark:text-gray-300 font-medium">Lag</span>
                        <input type="number" min={0} max={14} value={lagDays} onChange={e => setLagDays(Math.max(0, Math.min(14, parseInt(e.target.value) || 0)))} disabled={granularity !== 'daily' || !['totalRevenue', 'revenuePerEmail'].includes(metric)} className="w-14 px-1.5 py-1 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100 disabled:opacity-40" />
                        <span className="text-gray-500 dark:text-gray-400">days</span>
                    </div>
                    <div className="ml-auto flex items-center gap-1 text-gray-500 dark:text-gray-400"><SlidersHorizontal className="w-3.5 h-3.5" /> <span>{granularity.charAt(0).toUpperCase() + granularity.slice(1)}</span></div>
                </div>
                {/* Headline */}
                <div className="flex flex-col md:flex-row md:items-start gap-6">
                    <div className="flex-1">
                        <div className="flex items-end gap-4 mb-2">
                            <div>
                                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium mb-0.5">Current {METRIC_OPTIONS.find(m => m.value === metric)?.label}</div>
                                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{formatHeadline(lastPoint?.value ?? null)}</div>
                            </div>
                            <div className={`px-2 py-1 rounded-md text-[11px] font-medium ${status === 'good' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : status === 'risk' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{guardrailBreach ? 'Guardrail' : status.charAt(0).toUpperCase() + status.slice(1)}</div>
                            {prevPoint && lastPoint && <div className="text-xs text-gray-600 dark:text-gray-400 tabular-nums">{pctChange >= 0 ? '+' : ''}{(pctChange * 100).toFixed(1)}%</div>}
                        </div>
                        <ChartContainer
                            points={points}
                            metric={metric}
                            unit={METRIC_OPTIONS.find(m => m.value === metric)?.unit || ''}
                            emailsMax={emailsMax}
                            metricMax={metricMax}
                            compareOn={compare}
                            showBaseline={showBaseline}
                            threshold={threshold}
                            negative={negativeMetric}
                        />
                        {!baseSeries.length && (
                            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">No sends in selected range.</div>
                        )}
                    </div>
                    {/* Side micro-analytics */}
                    <div className="w-full md:w-56 flex-shrink-0 space-y-3 text-xs">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
                            <p className="text-gray-500 dark:text-gray-400 mb-1 font-medium">Range Averages</p>
                            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Avg Sends</span><span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{micro?.avgEmails?.toLocaleString() || '—'}</span></div>
                            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Avg RPME</span><span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{micro ? fmtCurrency(micro.rpmE) : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Median Unsub/1k</span><span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{micro ? (micro.medianUnsub >= 1 ? micro.medianUnsub.toFixed(2) : micro.medianUnsub.toFixed(3)) : '—'}</span></div>
                        </div>
                        {negativeMetric && threshold != null && <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">Guardrail line marks {threshold} {metric === 'spamPer1k' ? 'complaints' : 'events'} per 1K sends.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
