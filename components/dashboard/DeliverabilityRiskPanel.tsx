"use client";
import React, { useMemo, useState } from 'react';
import { ShieldAlert, Info, AlertTriangle } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';
import { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

// Types
interface Props { dateRange: string; customFrom?: string; customTo?: string; }

type Scope = 'all' | 'campaigns' | 'flows';
interface WeeklyAgg { weekKey: string; start: Date; end: Date; emailsSent: number; revenue: number; bounces: number; spam: number; unsubs: number; }
interface WindowStats { emailsSent: number; revenue: number; bounces: number; spam: number; unsubs: number; bounceRate: number; spamRate: number; unsubRate: number; revenuePerEmail: number; }

// Formatting helpers
const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const formatRate = (r: number) => (isFinite(r) ? (r * 100).toFixed(r * 100 >= 1 ? 2 : 3) + '%' : '—');
const pctDeltaStr = (d: number) => (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%';

const DeltaBadge = ({ value }: { value: number }) => {
    const cls = value > 0 ? 'text-rose-600 dark:text-rose-400' : value < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500';
    return <span className={cls}>{pctDeltaStr(value)}</span>;
};

// Simple sparkline generator for an array of numeric rates (0..1)
function Sparkline({ values, color, title }: { values: number[]; color: string; title: string }) {
    if (!values.length) return null;
    const max = Math.max(...values, 0.0001);
    const pts = values.map((v, i) => {
        const x = (i / (values.length - 1)) * 60; // width 60
        const y = 24 - (v / max) * 24;            // height 24
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return (
        <svg viewBox="0 0 60 24" width={60} height={24} className="overflow-visible" aria-label={title} role="img">
            <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

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
        if (last8.length < 8) return null;

        const sumWindow = (arr: WeeklyAgg[]): WindowStats => {
            const emailsSent = arr.reduce((s, w) => s + w.emailsSent, 0);
            const revenue = arr.reduce((s, w) => s + w.revenue, 0);
            const bounces = arr.reduce((s, w) => s + w.bounces, 0);
            const spam = arr.reduce((s, w) => s + w.spam, 0);
            const unsubs = arr.reduce((s, w) => s + w.unsubs, 0);
            return {
                emailsSent, revenue, bounces, spam, unsubs,
                bounceRate: emailsSent ? bounces / emailsSent : 0,
                spamRate: emailsSent ? spam / emailsSent : 0,
                unsubRate: emailsSent ? unsubs / emailsSent : 0,
                revenuePerEmail: emailsSent ? revenue / emailsSent : 0
            };
        };

        const prev4 = sumWindow(last8.slice(0, 4));
        const last4 = sumWindow(last8.slice(4));

        const pctChange = (a: number, b: number) => (a === 0 && b === 0) ? 0 : (b - a) / (a || 1e-9);

        const deltas = {
            emails: pctChange(prev4.emailsSent, last4.emailsSent),
            bounceRate: pctChange(prev4.bounceRate, last4.bounceRate),
            spamRate: pctChange(prev4.spamRate, last4.spamRate),
            unsubRate: pctChange(prev4.unsubRate, last4.unsubRate),
            rpe: pctChange(prev4.revenuePerEmail, last4.revenuePerEmail)
        };

        // Triggers (volume-aware)
        const triggers: { key: string; label: string; severity: 'low' | 'med' | 'high'; detail: string }[] = [];

        if (last4.spamRate > 0.0015 && deltas.spamRate > 0.25) {
            triggers.push({
                key: 'spam', label: 'Spam Escalation', severity: deltas.spamRate > 0.5 ? 'high' : 'med',
                detail: `Spam rate ${formatRate(prev4.spamRate)} → ${formatRate(last4.spamRate)} (${pctDeltaStr(deltas.spamRate)}).`
            });
        }
        if (last4.bounceRate > 0.02 && deltas.bounceRate > 0.20) {
            triggers.push({ key: 'bounce', label: 'Bounce Spike', severity: 'high', detail: `Bounce rate ${formatRate(prev4.bounceRate)} → ${formatRate(last4.bounceRate)} (${pctDeltaStr(deltas.bounceRate)}).` });
        }
        const unsubPerKPrev = prev4.unsubs / (prev4.emailsSent / 1000 || 1);
        const unsubPerKLast = last4.unsubs / (last4.emailsSent / 1000 || 1);
        const unsubUnitDelta = (unsubPerKLast - unsubPerKPrev) / (unsubPerKPrev || 1e-9);
        if (unsubUnitDelta > 0.20 && last4.unsubRate > 0.002) {
            triggers.push({ key: 'unsub', label: 'Unsub Fatigue', severity: unsubUnitDelta > 0.40 ? 'high' : 'med', detail: `Unsubs/1k +${(unsubUnitDelta * 100).toFixed(1)}% (rate ${formatRate(prev4.unsubRate)} → ${formatRate(last4.unsubRate)}).` });
        }
        if (triggers.length && deltas.rpe < -0.05) {
            triggers.push({ key: 'efficiency', label: 'Revenue Efficiency Down', severity: 'med', detail: `Rev/email ${formatCurrency(prev4.revenuePerEmail)} → ${formatCurrency(last4.revenuePerEmail)} (${pctDeltaStr(deltas.rpe)}).` });
        }
        if (deltas.emails > 0.15 && (deltas.unsubRate > deltas.emails + 0.1 || deltas.spamRate > deltas.emails + 0.1)) {
            triggers.push({ key: 'volume', label: 'Volume Stress', severity: 'low', detail: `Emails +${(deltas.emails * 100).toFixed(1)}% with disproportionate negative metric gains.` });
        }

        let rawScore = 0;
        for (const t of triggers) rawScore += t.severity === 'high' ? 35 : t.severity === 'med' ? 20 : 10;
        rawScore = Math.min(100, rawScore);

        // Confidence weighting (based on volume & number of distinct negative metrics)
        const baseVolumeConfidence = Math.min(1, last4.emailsSent / 40000); // 40k => full
        const metricDiversity = new Set(triggers.map(t => t.key)).size / 5; // scale 0..1
        const confidence = Math.max(0.3, Math.min(1, 0.3 + 0.5 * baseVolumeConfidence + 0.2 * metricDiversity));
        const weightedScore = Math.round(rawScore * confidence);

        let category: 'Low' | 'Moderate' | 'High' | 'Critical' = 'Low';
        if (weightedScore >= 70) category = 'Critical'; else if (weightedScore >= 50) category = 'High'; else if (weightedScore >= 30) category = 'Moderate';

        return { prev4, last4, deltas, triggers, rawScore, weightedScore, confidence, category, last8, unsubPerKPrev, unsubPerKLast };
    }, [weekly]);

    // Prepare sparkline series (always show if we have any weeks; fallback to zeros) last up to 8 weeks
    const sparkSeries = useMemo(() => {
        const take = weekly.slice(-8);
        return {
            spam: take.map(w => w.emailsSent ? w.spam / w.emailsSent : 0),
            bounce: take.map(w => w.emailsSent ? w.bounces / w.emailsSent : 0),
            unsub: take.map(w => w.emailsSent ? w.unsubs / w.emailsSent : 0)
        };
    }, [weekly]);

    if (!weekly.length) return null;

    return (
        <div className="mt-8 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-xl p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Deliverability Risk & Cost Avoidance</h3>
                    <div className="group relative">
                        <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300 cursor-pointer" />
                        <div className="absolute left-0 top-6 z-30 hidden group-hover:block w-80 text-[11px] leading-snug bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 space-y-2">
                            <p className="font-semibold text-gray-800 dark:text-gray-100">What</p>
                            <p className="text-gray-600 dark:text-gray-300">Last 4 full weeks vs prior 4. Detects rising failure / complaint signals normalized by volume & engagement efficiency.</p>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">Score</p>
                            <p className="text-gray-600 dark:text-gray-300">Weighted sum of triggers (spam, bounce, unsub fatigue, efficiency, volume stress) * confidence (volume + metric diversity).</p>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">Confidence</p>
                            <p className="text-gray-600 dark:text-gray-300">Higher with more recent send volume & multiple corroborating signals; low volume caps weighted impact.</p>
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

            {/* Sparklines */}
            <div className="mb-5 grid grid-cols-3 gap-4 text-[11px]">
                <div className="flex items-center gap-2">
                    <div className="flex flex-col"><Sparkline values={sparkSeries.spam} color="#db2777" title="Spam Rate" /></div>
                    <div className="leading-tight"><p className="font-medium text-gray-700 dark:text-gray-300">Spam</p><p className="text-gray-500 dark:text-gray-400">trend</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex flex-col"><Sparkline values={sparkSeries.bounce} color="#0d9488" title="Bounce Rate" /></div>
                    <div className="leading-tight"><p className="font-medium text-gray-700 dark:text-gray-300">Bounce</p><p className="text-gray-500 dark:text-gray-400">trend</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex flex-col"><Sparkline values={sparkSeries.unsub} color="#9333ea" title="Unsub Rate" /></div>
                    <div className="leading-tight"><p className="font-medium text-gray-700 dark:text-gray-300">Unsubs</p><p className="text-gray-500 dark:text-gray-400">trend</p></div>
                </div>
            </div>

            {!analysis && (
                <div className="text-sm text-gray-600 dark:text-gray-400">Not enough full weeks for risk analysis (need 8). This will populate automatically.</div>
            )}

            {analysis && (
                <>
                    <div className="flex flex-col md:flex-row md:items-end gap-8">
                        <div className="flex-1">
                            <div className="mb-4">
                                <div className="relative w-full h-4 rounded-full bg-gradient-to-r from-emerald-200 via-yellow-200 to-rose-300 dark:from-emerald-700/40 dark:via-yellow-700/40 dark:to-rose-700/40 overflow-hidden">
                                    <div className="absolute top-0 h-full w-0.5 bg-purple-700 dark:bg-purple-300" style={{ left: `${analysis.weightedScore}%` }} />
                                </div>
                                <div className="mt-2 flex justify-between text-[10px] text-gray-500 dark:text-gray-400"><span>Low</span><span>Moderate</span><span>High</span><span>Critical</span></div>
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                <div className="flex items-baseline gap-2">
                                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{analysis.weightedScore}</p>
                                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Risk (weighted)</p>
                                </div>
                                <div className="flex items-baseline gap-1 text-xs text-gray-500 dark:text-gray-400">
                                    Raw <span className="font-medium text-gray-700 dark:text-gray-300">{analysis.rawScore}</span>
                                    <span className="ml-2">Confidence <span className="font-medium text-gray-700 dark:text-gray-300">{(analysis.confidence * 100).toFixed(0)}%</span></span>
                                </div>
                                <div className="text-xs font-medium text-purple-700 dark:text-purple-300">Category: {analysis.category}</div>
                            </div>
                            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                                {analysis.triggers.length === 0 ? 'Stable: no material negative shifts.' : 'Active triggers indicate emerging risk; address higher severity first.'}
                            </p>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3"><p className="text-gray-500 dark:text-gray-400 mb-1">Spam Rate</p><p className="font-semibold text-gray-900 dark:text-gray-100">{formatRate(analysis.last4.spamRate)}</p><p className="mt-0.5"><DeltaBadge value={analysis.deltas.spamRate} /></p></div>
                            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3"><p className="text-gray-500 dark:text-gray-400 mb-1">Bounce Rate</p><p className="font-semibold text-gray-900 dark:text-gray-100">{formatRate(analysis.last4.bounceRate)}</p><p className="mt-0.5"><DeltaBadge value={analysis.deltas.bounceRate} /></p></div>
                            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3"><p className="text-gray-500 dark:text-gray-400 mb-1">Unsub Rate</p><p className="font-semibold text-gray-900 dark:text-gray-100">{formatRate(analysis.last4.unsubRate)}</p><p className="mt-0.5"><DeltaBadge value={analysis.deltas.unsubRate} /></p></div>
                            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3"><p className="text-gray-500 dark:text-gray-400 mb-1">Rev / Email</p><p className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(analysis.last4.revenuePerEmail)}</p><p className="mt-0.5"><DeltaBadge value={analysis.deltas.rpe} /></p></div>
                            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3"><p className="text-gray-500 dark:text-gray-400 mb-1">Emails Sent</p><p className="font-semibold text-gray-900 dark:text-gray-100">{analysis.last4.emailsSent.toLocaleString()}</p><p className="mt-0.5"><DeltaBadge value={analysis.deltas.emails} /></p></div>
                            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-3"><p className="text-gray-500 dark:text-gray-400 mb-1">Unsubs / 1K</p><p className="font-semibold text-gray-900 dark:text-gray-100">{(analysis.unsubPerKLast).toFixed(2)}</p></div>
                        </div>
                    </div>
                    <div className="mt-6">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">Triggers {analysis.triggers.length === 0 && <span className="text-gray-400 font-normal normal-case">None</span>}</h4>
                        {analysis.triggers.length > 0 && (
                            <ul className="flex flex-col gap-2">
                                {analysis.triggers.map(t => {
                                    const color = t.severity === 'high' ? 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                        : t.severity === 'med' ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                                            : 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300';
                                    return (
                                        <li key={t.key} className={`text-[11px] border rounded-md px-3 py-2 flex items-start gap-2 ${color}`}>
                                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                            <div>
                                                <p className="font-medium">{t.label}</p>
                                                <p className="mt-0.5 leading-snug">{t.detail}</p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
