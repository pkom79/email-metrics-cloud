"use client";
import React, { useMemo, useState } from 'react';
import { Info, TrendingUp, BarChart3, Activity } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';
import { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

// Types
interface Props { dateRange: string; customFrom?: string; customTo?: string; }

type Scope = 'all' | 'campaigns' | 'flows';
interface WeeklyAgg { weekKey: string; start: Date; end: Date; emailsSent: number; revenue: number; bounces: number; spam: number; unsubs: number; }
interface WindowStats { emailsSent: number; revenue: number; bounces: number; spam: number; unsubs: number; bounceRate: number; spamRate: number; unsubRate: number; revenuePerEmail: number; }

// Formatting helpers
const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const pct = (r: number, digits = 1) => (isFinite(r) ? (r * 100).toFixed(digits) + '%' : '—');
const signedPct = (r: number, digits = 1) => (r >= 0 ? '+' : '') + pct(Math.abs(r), digits); // we pass abs then re-add sign
const rate = (r: number) => (r * 100).toFixed(r * 100 >= 1 ? 2 : 3) + '%';

const deltaColor = (v: number, invert = false) => {
    const posGood = !invert; // when invert true, positive is bad
    if (v === 0) return 'text-gray-500';
    if (v > 0) return posGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    return posGood ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';
};

const TrendBadge = ({ value, invert = false, className = '' }: { value: number; invert?: boolean; className?: string }) => (
    <span className={`font-medium ${deltaColor(value, invert)} ${className}`}>{value >= 0 ? '+' : ''}{(value * 100).toFixed(1)}%</span>
);

// Tiny inline bar for elasticity visualization
const ElasticBar = ({ value, maxAbs }: { value: number; maxAbs: number }) => {
    const pctWidth = maxAbs === 0 ? 0 : Math.min(100, Math.abs(value) / maxAbs * 100);
    const isPos = value >= 0;
    return (
        <div className="h-2 w-full bg-gray-200 dark:bg-gray-800 rounded overflow-hidden">
            <div className={`${isPos ? 'bg-emerald-500' : 'bg-rose-500'} h-full`} style={{ width: `${pctWidth}%` }} />
        </div>
    );
};

export default function DeliverabilityRiskPanel({ dateRange, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const campaigns = dm.getCampaigns();
    const flows = dm.getFlowEmails();
    const [scope, setScope] = useState<Scope>('all');

    // Date filtering (align loosely with dashboard)
    const filtered = useMemo(() => {
        if (!campaigns.length && !flows.length) return { campaigns: [] as ProcessedCampaign[], flows: [] as ProcessedFlowEmail[] };
        let start: Date; let end: Date;
        if (dateRange === 'all') {
            const all = [...campaigns, ...flows];
            end = new Date(Math.max(...all.map(e => e.sentDate.getTime()))); end.setHours(23, 59, 59, 999);
            start = new Date(Math.min(...all.map(e => e.sentDate.getTime()))); start.setHours(0, 0, 0, 0);
        } else if (dateRange === 'custom' && customFrom && customTo) {
            start = new Date(customFrom + 'T00:00:00');
            end = new Date(customTo + 'T23:59:59');
        } else {
            const ref = dm.getLastEmailDate();
            end = new Date(ref); end.setHours(23, 59, 59, 999);
            const days = parseInt(dateRange.replace('d', ''));
            start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
        }
        const inRange = <T extends { sentDate: Date }>(arr: T[]) => arr.filter(e => e.sentDate >= start && e.sentDate <= end);
        return { campaigns: inRange(campaigns), flows: inRange(flows) };
    }, [campaigns, flows, dateRange, customFrom, customTo, dm]);

    // Weekly aggregate (ISO week start Monday)
    const weekly = useMemo(() => {
        const source: (ProcessedCampaign | ProcessedFlowEmail)[] = scope === 'campaigns' ? filtered.campaigns : scope === 'flows' ? filtered.flows : [...filtered.campaigns, ...filtered.flows];
        if (!source.length) return [] as WeeklyAgg[];

        const mondayOf = (d: Date) => {
            const n = new Date(d); n.setHours(0, 0, 0, 0);
            const day = n.getDay(); const diff = n.getDate() - day + (day === 0 ? -6 : 1); n.setDate(diff); return n;
        };

        const map = new Map<string, WeeklyAgg>();
        for (const e of source) {
            const wkStart = mondayOf(e.sentDate);
            const key = `${wkStart.getFullYear()}-${String(wkStart.getMonth() + 1).padStart(2, '0')}-${String(wkStart.getDate()).padStart(2, '0')}`;
            let rec = map.get(key);
            if (!rec) { const end = new Date(wkStart); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999); rec = { weekKey: key, start: wkStart, end, emailsSent: 0, revenue: 0, bounces: 0, spam: 0, unsubs: 0 }; map.set(key, rec); }
            rec.emailsSent += e.emailsSent; rec.revenue += e.revenue; rec.bounces += e.bouncesCount; rec.spam += e.spamComplaintsCount; rec.unsubs += e.unsubscribesCount;
        }
        return Array.from(map.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
    }, [filtered, scope]);

    const analysis = useMemo(() => {
        if (weekly.length < 8) return null;
        const last8 = weekly.slice(-8);
        const agg = (arr: WeeklyAgg[]): WindowStats => {
            const emailsSent = arr.reduce((s, w) => s + w.emailsSent, 0);
            const revenue = arr.reduce((s, w) => s + w.revenue, 0);
            const bounces = arr.reduce((s, w) => s + w.bounces, 0);
            const spam = arr.reduce((s, w) => s + w.spam, 0);
            const unsubs = arr.reduce((s, w) => s + w.unsubs, 0);
            return { emailsSent, revenue, bounces, spam, unsubs, bounceRate: emailsSent ? bounces / emailsSent : 0, spamRate: emailsSent ? spam / emailsSent : 0, unsubRate: emailsSent ? unsubs / emailsSent : 0, revenuePerEmail: emailsSent ? revenue / emailsSent : 0 };
        };
        const prev = agg(last8.slice(0, 4));
        const curr = agg(last8.slice(4));
        const change = (a: number, b: number) => (a === 0 && b === 0) ? 0 : (b - a) / (a || 1e-9);
        const deltas = {
            emails: change(prev.emailsSent, curr.emailsSent),
            revenue: change(prev.revenue, curr.revenue),
            rpe: change(prev.revenuePerEmail, curr.revenuePerEmail),
            unsubRate: change(prev.unsubRate, curr.unsubRate),
            spamRate: change(prev.spamRate, curr.spamRate),
            bounceRate: change(prev.bounceRate, curr.bounceRate)
        };
        // --- Regression-based marginal impact (stabilizes against tiny Δ volume) ---
        const regWeeks = weekly.slice(-12); // use up to 12 weeks for slope stability
        const xs = regWeeks.map(w => w.emailsSent);
        const slopeInfo = (ys: number[]) => {
            const n = Math.min(xs.length, ys.length);
            if (n < 4) return { slope: 0, r2: 0, unstable: true };
            const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
            const mx = mean(xs); const my = mean(ys);
            let num = 0, den = 0, ssTot = 0;
            for (let i = 0; i < n; i++) { const dx = xs[i] - mx; const dy = ys[i] - my; num += dx * dy; den += dx * dx; ssTot += dy * dy; }
            if (den === 0) return { slope: 0, r2: 0, unstable: true };
            const slope = num / den; // Δy / Δx (per email)
            // Compute R^2 for simple regression
            let ssRes = 0; const b = my - slope * mx;
            for (let i = 0; i < n; i++) { const pred = slope * xs[i] + b; const err = ys[i] - pred; ssRes += err * err; }
            const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
            const coefVar = Math.sqrt(den / n) / (mx || 1); // crude variation signal
            const unstable = coefVar < 0.05; // <5% variation in volume
            return { slope, r2, unstable };
        };
        const revSlope = slopeInfo(regWeeks.map(w => w.revenue));
        const unsubSlope = slopeInfo(regWeeks.map(w => w.unsubs));
        const spamSlope = slopeInfo(regWeeks.map(w => w.spam));
        const bounceSlope = slopeInfo(regWeeks.map(w => w.bounces));
        const emailsSlope = slopeInfo(regWeeks.map(w => w.emailsSent));

        const regressionElasticity = {
            revenuePer1k: revSlope.slope * 1000,
            unsubsPer1k: unsubSlope.slope * 1000,
            spamPer1k: spamSlope.slope * 1000,
            bouncesPer1k: bounceSlope.slope * 1000,
            r2Revenue: revSlope.r2,
            unstable: revSlope.unstable || unsubSlope.unstable || emailsSlope.unstable
        };

        // Clamp obviously absurd negative or positive values to avoid misleading output; keep sign, cap magnitude
        const clamp = (v: number, cap: number) => Math.abs(v) > cap ? (v > 0 ? cap : -cap) : v;
        regressionElasticity.revenuePer1k = clamp(regressionElasticity.revenuePer1k, 1000); // $1 per email upper bound
        regressionElasticity.unsubsPer1k = clamp(regressionElasticity.unsubsPer1k, 50); // 5% unsub upper bound per 1k
        regressionElasticity.spamPer1k = clamp(regressionElasticity.spamPer1k, 10);
        regressionElasticity.bouncesPer1k = clamp(regressionElasticity.bouncesPer1k, 50);

        const classification = (() => {
            if (regressionElasticity.unstable) return 'Low Signal';
            if (regressionElasticity.revenuePer1k <= 0 && (regressionElasticity.unsubsPer1k > 0 || regressionElasticity.spamPer1k > 0)) return 'Harmful';
            if (regressionElasticity.revenuePer1k > 0 && regressionElasticity.unsubsPer1k <= 3 && regressionElasticity.spamPer1k <= 0.2) return 'Healthy Expansion';
            if (regressionElasticity.revenuePer1k > 0 && (regressionElasticity.unsubsPer1k > 3 || regressionElasticity.spamPer1k > 0.2)) return 'Mixed Efficiency';
            if (regressionElasticity.revenuePer1k > 0) return 'Marginal Gain';
            return 'Neutral';
        })();
        const score = (() => {
            if (regressionElasticity.unstable) return 0;
            const base = Math.max(0, Math.min(100, (regressionElasticity.revenuePer1k / 1000) * 90)); // scale 0..1000 -> 0..90
            const penalty = (regressionElasticity.unsubsPer1k * 1.5) + (regressionElasticity.spamPer1k * 20) + (regressionElasticity.bouncesPer1k * 0.5);
            const adj = base - penalty;
            return Math.max(0, Math.min(100, Math.round(adj)));
        })();
        return { prev, curr, deltas, regressionElasticity, classification, score, weeks: regWeeks, last8 };
    }, [weekly]);

    const elasticityRows = useMemo(() => {
        if (!analysis) return [] as { key: string; label: string; value: number; unit: string; invert?: boolean }[];
        const e = analysis.regressionElasticity;
        return [
            { key: 'rev', label: 'Marginal Revenue', value: e.revenuePer1k, unit: '$ / +1K emails' },
            { key: 'unsub', label: 'Marginal Unsubs', value: e.unsubsPer1k, unit: 'unsubs / +1K', invert: true },
            { key: 'spam', label: 'Marginal Spam', value: e.spamPer1k, unit: 'complaints / +1K', invert: true },
            { key: 'bounce', label: 'Marginal Bounces', value: e.bouncesPer1k, unit: 'bounces / +1K', invert: true },
        ];
    }, [analysis]);

    // Time series chart for weekly metrics (emails as bars, overlay lines for revenue/email & unsub rate)
    const timeSeries = useMemo(() => {
        if (!analysis) return null;
        const weeks = analysis.weeks;
        if (!weeks.length) return null;
        const emailsMax = Math.max(...weeks.map(w => w.emailsSent), 1);
        const rpeMax = Math.max(...weeks.map(w => (w.revenue / (w.emailsSent || 1))), 0.0001);
        const unsubMax = Math.max(...weeks.map(w => (w.unsubs / (w.emailsSent || 1))), 0.0001);
        const height = 110; const width = weeks.length * 42; // dynamic width per week
        const barWidth = 18;
        const emailBars = weeks.map((w, i) => {
            const h = (w.emailsSent / emailsMax) * (height - 25);
            return <rect key={w.weekKey} x={i * 42 + 4} y={height - 5 - h} width={barWidth} height={h} rx={3} className="fill-gray-200 dark:fill-gray-700" />;
        });
        const line = (vals: number[], color: string) => {
            const pts = vals.map((v, i) => {
                const y = height - 5 - v;
                const x = i * 42 + barWidth + 8;
                return `${x},${y}`;
            }).join(' ');
            return <polyline key={color} points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
        };
        const rpeVals = weeks.map(w => ((w.revenue / (w.emailsSent || 1)) / rpeMax) * (height - 25));
        const unsubVals = weeks.map(w => ((w.unsubs / (w.emailsSent || 1)) / unsubMax) * (height - 25));
        return {
            svg: (
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label="Weekly volume & efficiency">
                    {emailBars}
                    {line(rpeVals, '#7e22ce')}
                    {line(unsubVals, '#dc2626')}
                </svg>
            ), legend: [{ label: 'Emails (bars)', color: 'bg-gray-300 dark:bg-gray-600' }, { label: 'Revenue / Email', color: 'bg-purple-600' }, { label: 'Unsub Rate', color: 'bg-rose-600' }]
        };
    }, [analysis]);

    if (!weekly.length) return null;

    return (
        <div className="mt-8 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-xl p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Send Volume Impact & Trade‑Offs</h3>
                    <div className="group relative">
                        <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                        <div className="absolute left-0 top-6 z-30 hidden group-hover:block w-96 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 space-y-2">
                            <p className="font-semibold text-gray-800 dark:text-gray-100">What</p>
                            <p className="text-gray-600 dark:text-gray-300">Shows how sending more (last 4 weeks) impacted revenue and negative signals vs the prior 4. Elasticities express incremental effect per +1K emails.</p>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">Interpretation</p>
                            <p className="text-gray-600 dark:text-gray-300">Use incremental revenue vs unsub/spam growth to decide if further volume expansion is value accretive or destructive.</p>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">Classification</p>
                            <p className="text-gray-600 dark:text-gray-300">Healthy = strong incremental revenue with limited complaint churn. Mixed = revenue lift with rising friction. Harmful = little / negative revenue with rising complaints.</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <select value={scope} onChange={e => setScope(e.target.value as Scope)} className="appearance-none pl-3 pr-8 py-2 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500">
                        <option value="all">All Email</option>
                        <option value="campaigns">Campaigns</option>
                        <option value="flows">Flows</option>
                    </select>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{weekly.length >= 8 ? 'Last 8 weeks' : `Need 8 weeks (have ${weekly.length})`}</span>
                </div>
            </div>

            {!analysis && (
                <div className="text-sm text-gray-600 dark:text-gray-400">Not enough full weeks (need 8) to compute elasticities.</div>
            )}

            {analysis && (
                <>
                    {/* Summary Row */}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                        <div className="space-y-4">
                            <div className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
                                Sent <span className="font-semibold text-gray-900 dark:text-gray-100">{analysis.curr.emailsSent.toLocaleString()}</span> emails ({analysis.deltas.emails >= 0 ? '+' : ''}{(analysis.deltas.emails * 100).toFixed(1)}%) vs prev {analysis.prev.emailsSent.toLocaleString()}. Revenue {(analysis.deltas.revenue >= 0 ? 'increased' : 'decreased')} {(analysis.deltas.revenue * 100).toFixed(1)}% while revenue/email {(analysis.deltas.rpe >= 0 ? 'rose' : 'fell')} {(Math.abs(analysis.deltas.rpe) * 100).toFixed(1)}%. Unsub rate {analysis.deltas.unsubRate >= 0 ? '↑' : '↓'} {(Math.abs(analysis.deltas.unsubRate) * 100).toFixed(1)}%, spam {analysis.deltas.spamRate >= 0 ? '↑' : '↓'} {(Math.abs(analysis.deltas.spamRate) * 100).toFixed(1)}%, bounce {analysis.deltas.bounceRate >= 0 ? '↑' : '↓'} {(Math.abs(analysis.deltas.bounceRate) * 100).toFixed(1)}%.
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                                <span className="px-2 py-1 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 font-medium">{analysis.classification}</span>
                                <span className="text-gray-500 dark:text-gray-400">Score:</span>
                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{analysis.score}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                                    <p className="text-gray-500 dark:text-gray-400 mb-0.5">Revenue / Email</p>
                                    <p className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(analysis.curr.revenuePerEmail)}</p>
                                    <TrendBadge value={analysis.deltas.rpe} />
                                </div>
                                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                                    <p className="text-gray-500 dark:text-gray-400 mb-0.5">Unsub Rate</p>
                                    <p className="font-semibold text-gray-900 dark:text-gray-100">{rate(analysis.curr.unsubRate)}</p>
                                    <TrendBadge value={analysis.deltas.unsubRate} invert />
                                </div>
                                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                                    <p className="text-gray-500 dark:text-gray-400 mb-0.5">Spam Rate</p>
                                    <p className="font-semibold text-gray-900 dark:text-gray-100">{rate(analysis.curr.spamRate)}</p>
                                    <TrendBadge value={analysis.deltas.spamRate} invert />
                                </div>
                                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                                    <p className="text-gray-500 dark:text-gray-400 mb-0.5">Bounce Rate</p>
                                    <p className="font-semibold text-gray-900 dark:text-gray-100">{rate(analysis.curr.bounceRate)}</p>
                                    <TrendBadge value={analysis.deltas.bounceRate} invert />
                                </div>
                            </div>
                            <div className="mt-2 text-[10px] text-gray-500 dark:text-gray-500 leading-snug">
                                {analysis.regressionElasticity.unstable ? 'Low variation in recent send volume—marginal metrics are provisional.' : `Model fit (R² revenue vs volume): ${(analysis.regressionElasticity.r2Revenue * 100).toFixed(0)}%.`}
                            </div>
                        </div>
                        {/* Time Series + Marginals */}
                        <div className="xl:col-span-2 space-y-6">
                            <div>
                                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300"><Activity className="w-4 h-4 text-purple-600" />Weekly Volume & Efficiency</div>
                                <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3 overflow-x-auto">
                                    {timeSeries?.svg}
                                </div>
                                <div className="flex gap-4 mt-2 flex-wrap">
                                    {timeSeries?.legend.map(l => (
                                        <div key={l.label} className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400"><span className={`w-3 h-3 rounded ${l.color}`}></span>{l.label}</div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300"><BarChart3 className="w-4 h-4 text-purple-600" />Marginal Impact (Regression)</div>
                                <div className="space-y-3">
                                    {(() => {
                                        const maxAbs = Math.max(0, ...elasticityRows.map(r => Math.abs(r.value)));
                                        return elasticityRows.map(r => (
                                            <div key={r.key} className="flex items-center gap-4 text-xs">
                                                <div className="w-44 text-gray-600 dark:text-gray-400 font-medium truncate">{r.label}</div>
                                                <div className="flex-1"><ElasticBar value={r.value} maxAbs={maxAbs} /></div>
                                                <div className={`w-32 text-right tabular-nums font-semibold ${r.value === 0 ? 'text-gray-500' : r.value > 0 ? (r.invert ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400') : (r.invert ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}`}>{r.key === 'rev' ? formatCurrency(r.value) : r.value.toFixed(2)}</div>
                                                <div className="w-28 text-[10px] text-gray-500 dark:text-gray-400 text-right">{r.unit}</div>
                                            </div>
                                        ));
                                    })()}
                                </div>
                                <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">Values are regression slopes (marginal impact) over the last {analysis.weeks.length} weeks. Capped to suppress outliers. If signal is low, treat estimates as directional only.</p>
                            </div>
                        </div>
                    </div>
                    {/* Guidance */}
                    <div className="mt-6 text-[11px] text-gray-600 dark:text-gray-400 leading-snug">
                        {analysis.classification === 'Healthy Expansion' && 'Scaling is efficient—test upper bounds gradually and monitor unsub/spam slopes for inflection.'}
                        {analysis.classification === 'Mixed Efficiency' && 'Revenue lift with rising friction—prune low-engagement cohorts or smooth cadence before further scaling.'}
                        {analysis.classification === 'Harmful' && 'Marginal value negative—pause volume increases; focus on list quality & re-engagement.'}
                        {analysis.classification === 'Marginal Gain' && 'Positive but thin margin—optimize content/targeting to thicken value before pushing harder.'}
                        {analysis.classification === 'Neutral' && 'No clear marginal pattern—await more variation or run controlled tests.'}
                        {analysis.classification === 'Low Signal' && 'Insufficient volume variation to estimate marginal impact—consider structured A/B volume tests.'}
                    </div>
                </>
            )}
        </div>
    );
}
