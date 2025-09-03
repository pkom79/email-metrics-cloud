"use client";
import React, { useMemo, useState } from 'react';
import { Activity, Info } from 'lucide-react';
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
interface ChartContainerProps { points: ChartSeriesPoint[]; metric: MetricKey; emailsMax: number; metricMax: number; formatValue: (v: number | null) => string; }

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

const ChartContainer: React.FC<ChartContainerProps> = ({ points, metric, emailsMax, metricMax, formatValue }) => {
    // Match FlowStepAnalysis dimensions (graph height 160, drawing area 120 baseline)
    const VIEW_W = 900; const VIEW_H = 160; const GRAPH_H = 120; // baseline at y=120
    const PADDING_LEFT = 50; // space for y ticks
    const PADDING_RIGHT = 20;
    const innerW = VIEW_W - PADDING_LEFT - PADDING_RIGHT;
    const xScale = (i: number) => points.length <= 1 ? PADDING_LEFT + innerW / 2 : PADDING_LEFT + (i / (points.length - 1)) * innerW;
    const yMetric = (v: number) => {
        if (metricMax === 0) return GRAPH_H; return GRAPH_H - (v / metricMax) * (GRAPH_H - 10); // add top padding
    };
    const yEmails = (v: number) => {
        if (emailsMax === 0) return GRAPH_H; return GRAPH_H - (v / emailsMax) * (GRAPH_H - 10);
    };

    // Build smoothed paths using Catmull-Rom -> Bezier
    const metricPts = points.filter(p => p.value != null).map(p => ({ x: xScale(p.x), y: yMetric(p.value as number) }));
    const emailsPts = points.map(p => ({ x: xScale(p.x), y: yEmails(p.emails || 0) }));
    const metricPath = catmullRom2bezier(metricPts);
    const emailsLine = catmullRom2bezier(emailsPts);
    const emailsArea = emailsPts.length ? `${emailsLine} L ${emailsPts[emailsPts.length - 1].x} ${GRAPH_H} L ${emailsPts[0].x} ${GRAPH_H} Z` : '';
    const metricArea = metricPts.length ? `${metricPath} L ${metricPts[metricPts.length - 1].x} ${GRAPH_H} L ${metricPts[0].x} ${GRAPH_H} Z` : '';

    // X ticks (max 6)
    const xTicks = useMemo(() => {
        if (points.length < 2) return [] as { x: number; label: string }[];
        const count = Math.min(6, points.length);
        const res: { x: number; label: string }[] = [];
        for (let i = 0; i < count; i++) {
            const idx = Math.round((i / (count - 1)) * (points.length - 1));
            res.push({ x: xScale(idx), label: points[idx].label });
        }
        return res;
    }, [points]);
    // Y ticks for metric (3)
    const yTicks = useMemo(() => {
        const ticks: { y: number; value: number }[] = [];
        for (let i = 0; i < 3; i++) {
            const v = (metricMax / 2) * i; // 0, mid, max approx replaced below
            ticks.push({ y: yMetric(v), value: v });
        }
        ticks.push({ y: yMetric(metricMax), value: metricMax });
        // ensure unique ordering
        return Array.from(new Map(ticks.map(t => [t.value, t])).values());
    }, [metricMax]);

    const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
    const active = hover ? points[hover.idx] : null;

    return (
        <div className="relative" style={{ width: '100%' }} role="img" aria-label="Send Volume Impact chart">
            <svg width="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block select-none">
                <defs>
                    <linearGradient id="svi-emails" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
                    </linearGradient>
                    <linearGradient id="svi-metric" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.04" />
                    </linearGradient>
                </defs>
                {/* Grid + Y ticks */}
                {yTicks.map((t, i) => (
                    <g key={i}>
                        <line x1={PADDING_LEFT} y1={t.y} x2={VIEW_W - PADDING_RIGHT} y2={t.y} stroke="#e5e7eb" strokeDasharray="2 2" />
                        <text x={PADDING_LEFT - 6} y={t.y + 4} textAnchor="end" fontSize={11} fill="#6b7280" className="tabular-nums">
                            {metric === 'totalRevenue' || metric === 'revenuePerEmail'
                                ? (t.value >= 1000 ? '$' + (t.value / 1000).toFixed(1) + 'k' : '$' + t.value.toFixed(0))
                                : (t.value >= 1 ? t.value.toFixed(1) : t.value.toFixed(2))}
                        </text>
                    </g>
                ))}
                {/* X axis ticks */}
                {xTicks.map((t, i) => (
                    <g key={i}>
                        <line x1={t.x} y1={GRAPH_H} x2={t.x} y2={GRAPH_H + 10} stroke="#e5e7eb" />
                        <text x={t.x} y={GRAPH_H + 25} textAnchor="middle" fontSize={11} fill="#6b7280">{t.label}</text>
                    </g>
                ))}
                {/* Emails area */}
                {emailsArea && <path d={emailsArea} fill="url(#svi-emails)" stroke="none" />}
                {/* Metric area */}
                {metricArea && <path d={metricArea} fill="url(#svi-metric)" stroke="none" />}
                {/* Metric line */}
                {metricPath && <path d={metricPath} fill="none" stroke="#8b5cf6" strokeWidth={2} />}
                {/* Points + hover zones */}
                {points.map((p, i) => {
                    if (p.value == null) return null;
                    const x = xScale(i); const y = yMetric(p.value);
                    return (
                        <g key={i}>
                            <circle cx={x} cy={y} r={4} fill="#fff" stroke="#8b5cf6" strokeWidth={1.5} />
                            <circle cx={x} cy={y} r={12} fill="transparent" onMouseEnter={() => setHover({ idx: i, x, y })} onMouseLeave={() => setHover(null)} />
                        </g>
                    );
                })}
            </svg>
            {active && active.value != null && hover && (
                <div
                    className="pointer-events-none absolute z-20 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-xl border border-gray-700"
                    style={{
                        left: `${(hover.x / VIEW_W) * 100}%`,
                        top: `${Math.max(0, (hover.y / VIEW_H) * 100 - 5)}%`,
                        transform: 'translate(-50%, -100%)',
                        whiteSpace: 'nowrap'
                    }}
                >
                    <div className="font-medium mb-0.5">{active.label}</div>
                    <div className="flex justify-between gap-3"><span>Emails</span><span className="tabular-nums">{active.emails?.toLocaleString() || 0}</span></div>
                    <div className="flex justify-between gap-3"><span>{METRIC_OPTIONS.find(m => m.value === metric)?.label}</span><span className="tabular-nums">{formatValue(active.value)}</span></div>
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
    const lastPoint = [...points].reverse().find(p => p.value != null) || null; // retained if needed later
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
    const negativeMetric = NEGATIVE_METRICS.includes(metric); // currently unused but may be reintroduced

    // Average across displayed buckets (non-null values)
    const avgValue = (() => {
        const vals = points.filter(p => p.value != null).map(p => p.value as number);
        if (!vals.length) return null;
        return vals.reduce((s, v) => s + v, 0) / vals.length;
    })();
    const formatValue = (v: number | null) => {
        if (v == null) return '—';
        if (metric === 'totalRevenue' || metric === 'revenuePerEmail') return fmtCurrency(v);
        return v >= 1 ? v.toFixed(2) : v.toFixed(3);
    };
    return (
        <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 tracking-tight flex items-center gap-2">Send Volume Impact
                        <span className="relative group inline-flex items-center">
                            <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 cursor-pointer" />
                            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-6 z-30 hidden group-hover:block w-80 bg-gray-900 text-white text-[11px] leading-snug p-3 rounded-lg shadow-xl border border-gray-700">
                                <span className="font-semibold text-white">How to interpret</span><br />
                                Purple line = selected performance metric. Shaded background = relative send volume (emails). When volume increases while efficiency (e.g. Revenue / Email) stays stable or improves, scaling is healthy. Rising negative rate metrics (unsubs, spam, bounces) with higher volume indicates pressure. Partial period ends are trimmed.
                            </span>
                        </span>
                    </h3>
                </div>
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
                <div className="flex items-start justify-between mb-4">
                    <div />
                    <div className="text-right">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-0.5">Avg {METRIC_OPTIONS.find(m => m.value === metric)?.label}</div>
                        <div className="text-3xl font-bold text-gray-900 tabular-nums">{formatValue(avgValue)}</div>
                    </div>
                </div>
                <ChartContainer points={points} metric={metric} emailsMax={emailsMax} metricMax={metricMax} formatValue={formatValue} />
                {!baseSeries.length && (<div className="mt-4 text-xs text-gray-500">No sends in selected range.</div>)}
                <div className="mt-6 grid grid-cols-3 gap-4 text-xs">
                    <div className="border border-gray-200 rounded-lg p-3"><div className="text-gray-500 mb-1 font-medium">Avg Sends</div><div className="text-gray-900 font-semibold tabular-nums">{micro?.avgEmails?.toLocaleString() || '—'}</div></div>
                    <div className="border border-gray-200 rounded-lg p-3"><div className="text-gray-500 mb-1 font-medium">Avg RPME</div><div className="text-gray-900 font-semibold tabular-nums">{micro ? fmtCurrency(micro.rpmE) : '—'}</div></div>
                    <div className="border border-gray-200 rounded-lg p-3"><div className="text-gray-500 mb-1 font-medium">Median Unsub/1k</div><div className="text-gray-900 font-semibold tabular-nums">{micro ? (micro.medianUnsub >= 1 ? micro.medianUnsub.toFixed(2) : micro.medianUnsub.toFixed(3)) : '—'}</div></div>
                </div>
            </div>
        </div>
    );
}
