"use client";
import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';
import { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

interface Props { dateRange: string; granularity: 'daily' | 'weekly' | 'monthly'; customFrom?: string; customTo?: string; }

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
interface ChartSeriesPoint { x: number; value: number | null; emails?: number; label: string; faded?: boolean; }
interface ChartContainerProps { points: ChartSeriesPoint[]; metric: MetricKey; emailsMax: number; metricMax: number; }

// Simple Catmull-Rom spline to Bezier for smoother line
function catmullRom2bezier(points: { x: number, y: number }[]) {
    if (points.length < 2) return '';
    const d: string[] = [];
    d.push(`M${points[0].x} ${points[0].y}`);
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
    }
    return d.join(' ');
}

const ChartContainer: React.FC<ChartContainerProps> = ({ points, metric, emailsMax, metricMax }) => {
    const H = 320; const PAD_L = 54; const PAD_R = 54; const PAD_T = 10; const PAD_B = 42;
    const innerH = H - PAD_T - PAD_B; const W = Math.max(760, points.length * 56); const innerW = W - PAD_L - PAD_R;
    const xScale = (i: number) => points.length <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (points.length - 1)) * innerW;
    const yMetric = (v: number) => PAD_T + (1 - (v / (metricMax || 1))) * innerH;
    const yEmails = (v: number) => PAD_T + (1 - (v / (emailsMax || 1))) * innerH;

    const metricPts = points.filter(p => p.value != null).map(p => ({ x: xScale(p.x), y: yMetric(p.value as number) }));
    const metricPath = catmullRom2bezier(metricPts);
    const areaEmailsPath = (() => {
        if (!points.length) return '';
        let d = 'M' + xScale(0) + ' ' + yEmails(points[0].emails || 0);
        points.forEach((p, i) => { d += ' L' + xScale(i) + ' ' + yEmails(p.emails || 0); });
        d += ' L' + xScale(points.length - 1) + ' ' + (PAD_T + innerH) + ' L' + xScale(0) + ' ' + (PAD_T + innerH) + ' Z';
        return d;
    })();

    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const active = hoverIdx != null ? points[hoverIdx] : null;

    return (
        <div className="relative">
            <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[340px] select-none" role="img" aria-label="Send Volume Impact chart">
                    <rect x={0} y={0} width={W} height={H} className="fill-white" />
                    <path d={areaEmailsPath} className="fill-purple-100" />
                    <path d={metricPath} className="stroke-purple-600" strokeWidth={2.4} fill="none" />
                    {points.map((p, i) => { if (p.value == null) return null; const x = xScale(i); const y = yMetric(p.value); return <circle key={i} cx={x} cy={y} r={3.5} className={p.faded ? "fill-purple-300" : "fill-white stroke-purple-600"} strokeWidth={p.faded ? 0 : 1.5} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />; })}
                    {/* Left Axis */}
                    {(() => { const ticks: number[] = []; const steps = 5; for (let i = 0; i <= steps; i++) { ticks.push((metricMax / steps) * i); } return ticks.map(t => <text key={t} x={PAD_L - 6} y={yMetric(t) + 4} textAnchor="end" className="fill-gray-400 text-[11px] tabular-nums">{metric === 'totalRevenue' || metric === 'revenuePerEmail' ? (t >= 1000 ? '$' + (t / 1000).toFixed(1) + 'k' : '$' + t.toFixed(0)) : (t >= 1 ? t.toFixed(1) : t.toFixed(2))}</text>); })()}
                    <text x={PAD_L} y={14} className="fill-gray-500 text-[11px] font-medium">{METRIC_OPTIONS.find(m => m.value === metric)?.label}</text>
                    {/* Right Axis */}
                    {(() => { const ticks: number[] = []; const steps = 5; for (let i = 0; i <= steps; i++) { ticks.push((emailsMax / steps) * i); } return ticks.map(t => <text key={t} x={W - PAD_R + 4} y={yEmails(t) + 4} className="fill-gray-400 text-[11px]">{t >= 1000 ? (t / 1000).toFixed(1) + 'k' : Math.round(t)}</text>); })()}
                    <text x={W - PAD_R} y={14} textAnchor="end" className="fill-gray-500 text-[11px] font-medium">Emails Sent</text>
                    {/* X labels */}
                    {points.map((p, i) => <text key={p.label} x={xScale(i)} y={H - 6} textAnchor="middle" className="fill-gray-400 text-[10px]">{p.label}</text>)}
                </svg>
            </div>
            {active && (
                <div className="pointer-events-none absolute left-0 top-0 mt-2 ml-2 rounded-md bg-white/95 backdrop-blur border border-gray-200 shadow px-3 py-2 text-[11px] text-gray-700 space-y-1">
                    <div className="font-semibold text-gray-900">{active.label}</div>
                    <div className="flex justify-between gap-3"><span>Emails</span><span className="tabular-nums">{active.emails?.toLocaleString() || 0}</span></div>
                    <div className="flex justify-between gap-3"><span>{METRIC_OPTIONS.find(m => m.value === metric)?.label}</span><span className="tabular-nums">{(() => { if (active.value == null) return '—'; if (metric === 'totalRevenue' || metric === 'revenuePerEmail') return fmtCurrency(active.value); return active.value >= 1 ? active.value.toFixed(2) : active.value.toFixed(3); })()}</span></div>
                </div>
            )}
        </div>
    );
};

export default function SendVolumeImpact({ dateRange, granularity, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const campaigns = dm.getCampaigns();
    const flows = dm.getFlowEmails();
    const [metric, setMetric] = useState<MetricKey>('totalRevenue');
    const [scope, setScope] = useState<SourceScope>('all');
    // Simplified: removed compare / baseline / lag per brand feedback

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
    // Use externally provided granularity (already determined in dashboard filters)

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
        let buckets: Bucket[] = revenueSeries.map((r, i) => {
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
        // Trim incomplete boundary buckets for weekly/monthly so partial periods don't appear as drops.
        if ((granularity === 'weekly' || granularity === 'monthly') && buckets.length > 2) {
            // We only have labels, so estimate bucket length via median diff of internal indices if DataManager included date objects.
            // Heuristic: treat first/last bucket as incomplete if value (emails sent) is <40% of median internal buckets.
            const internal = buckets.slice(1, -1);
            const medianEmails = (() => { const arr = internal.map(b => b.emails).filter(n => n > 0).sort((a, b) => a - b); if (!arr.length) return 0; return arr[Math.floor(arr.length / 2)]; })();
            if (medianEmails > 0) {
                if (buckets[0].emails > 0 && buckets[0].emails < medianEmails * 0.4) buckets = buckets.slice(1);
                if (buckets[buckets.length - 1].emails > 0 && buckets[buckets.length - 1].emails < medianEmails * 0.4) buckets = buckets.slice(0, buckets.length - 1);
            }
        }
        return buckets;
    }, [dm, subset, dateRange, granularity, customFrom, customTo, range]);

    // Derive metric series values
    const metricSeries = useMemo(() => baseSeries.map(b => {
        switch (metric) {
            case 'totalRevenue': return b.revenue;
            case 'revenuePerEmail': return b.emails > 0 ? b.revenue / b.emails : null;
            case 'unsubsPer1k': return b.emails > 0 ? (b.unsubs / b.emails) * 1000 : null;
            case 'spamPer1k': return b.emails > 0 ? (b.spam / b.emails) * 1000 : null;
            case 'bouncesPer1k': return b.emails > 0 ? (b.bounces / b.emails) * 1000 : null;
        }
    }), [baseSeries, metric]);

    // Lag (applies only to revenue metrics); shift forward (positive lag means treat revenues as occurring lag days later -> so shift values right)
    const laggedMetricSeries = metricSeries; // lag removed

    // Compare series (previous period same length, aligned by index) simplistic implementation
    const compareSeries: (number | null)[] = []; // removed

    // Baseline expectation: simple mean + stdev of earlier buckets (excluding last 2 buckets) grouped by same day-of-week for daily, otherwise average of all prior periods
    const baseline = { expected: [], low: [], high: [] }; // removed

    // Build chart points
    const points = useMemo(() => baseSeries.map((b, i) => {
        const val = laggedMetricSeries[i];
        let faded = false;
        if (val != null) {
            if (metric === 'revenuePerEmail' && b.emails < MIN_EMAILS_PER_BUCKET_RPE) faded = true;
            if (NEGATIVE_METRICS.includes(metric) && b.emails < MIN_EMAILS_PER_BUCKET_PER1K) faded = true;
        }
        return { x: i, value: val, emails: b.emails, label: b.label, faded };
    }), [baseSeries, laggedMetricSeries, metric]);

    const emailsMax = useMemo(() => Math.max(...baseSeries.map(b => b.emails), 1), [baseSeries]);
    const metricMax = useMemo(() => Math.max(1, ...points.map(p => p.value || 0)), [points]);

    // Headline (current bucket = last non-null value)
    const lastPoint = [...points].reverse().find(p => p.value != null) || null;
    const prevPoint = null; // change calc removed

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
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Activity className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 tracking-tight">Send Volume Impact</h3></div>
                <div className="flex gap-4 text-sm">
                    <div className="relative">
                        <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} className="appearance-none px-3 h-9 pr-8 rounded-lg border bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                            {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
                    </div>
                    <div className="relative">
                        <select value={scope} onChange={e => setScope(e.target.value as SourceScope)} className="appearance-none px-3 h-9 pr-8 rounded-lg border bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                            <option value="all">All Emails</option>
                            <option value="campaigns">Campaigns</option>
                            <option value="flows">Flows</option>
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
                    </div>
                </div>
            </div>
            <div className="rounded-2xl bg-white border border-gray-200 p-6">
                <div className="flex flex-col md:flex-row md:items-start gap-10">
                    <div className="flex-1">
                        <div className="mb-4">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-1">{METRIC_OPTIONS.find(m => m.value === metric)?.label}</div>
                            <div className="flex items-baseline gap-3">
                                <div className="text-3xl font-bold text-gray-900 tabular-nums">{formatHeadline(lastPoint?.value ?? null)}</div>
                                {lastPoint && <div className="text-xs text-gray-400">Latest: {lastPoint.label}</div>}
                            </div>
                        </div>
                        <ChartContainer points={points} metric={metric} emailsMax={emailsMax} metricMax={metricMax} />
                        {!baseSeries.length && (<div className="mt-4 text-xs text-gray-500">No sends in selected range.</div>)}
                    </div>
                    <div className="w-full md:w-60 flex-shrink-0 text-xs space-y-3">
                        <div className="border border-gray-200 rounded-lg p-4 bg-white">
                            <p className="text-gray-500 mb-2 font-medium">Range Averages</p>
                            <div className="flex justify-between mb-1"><span className="text-gray-600">Avg Sends</span><span className="tabular-nums font-semibold text-gray-900">{micro?.avgEmails?.toLocaleString() || '—'}</span></div>
                            <div className="flex justify-between mb-1"><span className="text-gray-600">Avg RPME</span><span className="tabular-nums font-semibold text-gray-900">{micro ? fmtCurrency(micro.rpmE) : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-gray-600">Median Unsub/1k</span><span className="tabular-nums font-semibold text-gray-900">{micro ? (micro.medianUnsub >= 1 ? micro.medianUnsub.toFixed(2) : micro.medianUnsub.toFixed(3)) : '—'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
