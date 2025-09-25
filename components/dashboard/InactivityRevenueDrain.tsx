"use client";
import React, { useMemo, useState } from 'react';
import { Moon, Info, ChevronDown } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import type { ProcessedSubscriber } from '../../lib/data/dataTypes';

interface Props { subscribers: ProcessedSubscriber[]; }

/*
 * Inactivity Revenue Drain
 * Shows dormant CLV share by inactivity buckets (no open/click) 30 / 60 / 90 / 120+ days.
 * Buckets are mutually exclusive and based on the most recent engagement (lastOpen or lastClick whichever is newer).
 */
export default function InactivityRevenueDrain({ subscribers }: Props) {
    const buckets = useMemo(() => {
        if (!subscribers?.length) return null;
        const now = new Date();
        interface Bucket { key: string; label: string; min: number; max: number | null; clv: number; count: number; }
        const defs: Bucket[] = [
            { key: '30_59', label: '30-59 days', min: 30, max: 59, clv: 0, count: 0 },
            { key: '60_89', label: '60-89 days', min: 60, max: 89, clv: 0, count: 0 },
            { key: '90_119', label: '90-119 days', min: 90, max: 119, clv: 0, count: 0 },
            { key: '120_plus', label: '120+ days', min: 120, max: null, clv: 0, count: 0 },
        ];
        let totalClv = 0;
        subscribers.forEach(s => {
            const clv = (s.historicClv ?? s.totalClv) || 0; if (clv <= 0) return; totalClv += clv;
            const last = (s.lastClick && s.lastOpen) ? (s.lastClick > s.lastOpen ? s.lastClick : s.lastOpen) : (s.lastClick || s.lastOpen);
            if (!last) return; // no engagement ever -> treat as 120+? We'll leave for future explicit bucket if needed.
            const days = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
            for (const b of defs) {
                if (days >= b.min && (b.max === null || days <= b.max)) { b.clv += clv; b.count += 1; break; }
            }
        });
        const totalDormantClv = defs.reduce((s, b) => s + b.clv, 0);
        const dormantPct = totalClv > 0 ? (totalDormantClv / totalClv) * 100 : 0;
        const bucketsWithShare = defs.map(def => ({
            ...def,
            dormantShare: totalDormantClv > 0 ? (def.clv / totalDormantClv) * 100 : 0,
        }));
        return { defs: bucketsWithShare, totalClv, totalDormantClv, dormantPct };
    }, [subscribers]);

    if (!buckets || buckets.totalClv === 0) return null;

    const { defs, totalClv, totalDormantClv, dormantPct } = buckets;
    const maxShare = Math.max(...defs.map(b => b.clv), 1);
    const pct = (v: number) => ((v / totalClv) * 100).toFixed(v / totalClv * 100 >= 10 ? 1 : 2) + '%';
    const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

    const majorityBucket = defs.reduce((prev, curr) => (curr.dormantShare > prev.dormantShare ? curr : prev), defs[0]);
    const allBucketsSmall = defs.every(def => def.dormantShare < 2);
    let summary = 'Run light reactivation and maintain conservative frequency.';
    if (majorityBucket && (majorityBucket.key === '30_59' || majorityBucket.key === '60_89') && !allBucketsSmall) {
        summary = 'Most inactive value sits in recently lapsed customers, making them the top priority for win-back.';
    } else if (majorityBucket && (majorityBucket.key === '90_119' || majorityBucket.key === '120_plus') && !allBucketsSmall) {
        summary = 'A large share of inactive value is older, meaning recovery is harder and list hygiene becomes critical.';
    }
    if (allBucketsSmall) {
        summary = 'Inactive value is minimal, suggesting timely maintenance is in place.';
    }

    const headline = `Dormant profiles hold ${dormantPct.toFixed(dormantPct >= 10 ? 1 : 2)}% of historic CLV.`;

    const paragraphSentences: string[] = [];
    if (majorityBucket && (majorityBucket.key === '30_59' || majorityBucket.key === '60_89')) {
        paragraphSentences.push('Dormant value is concentrated in the first ninety days of inactivity, which means the lost revenue is still fresh.');
        paragraphSentences.push('That shape suggests quick nurture touches, reminders, and gentle offers can still pull these profiles back.');
        paragraphSentences.push('Act quickly with light win-back journeys before inertia sets in.');
        paragraphSentences.push('Because older buckets are smaller, you can maintain your existing hygiene cadence without drastic suppression.');
        paragraphSentences.push('If the pattern were flipped and most value sat beyond ninety days, odds of recovery would drop and you would need stricter list pruning.');
    } else if (majorityBucket && (majorityBucket.key === '90_119' || majorityBucket.key === '120_plus')) {
        paragraphSentences.push('Dormant value piles up in the older inactivity buckets, indicating these customers have gone quiet for a long stretch.');
        paragraphSentences.push('Win-back chances shrink the longer profiles sit inactive, so campaigns should combine stronger incentives with firm deadlines.');
        paragraphSentences.push('Expect to retire a portion of this value through suppression if engagement does not improve.');
        paragraphSentences.push('Meanwhile, keep recruiting healthier cohorts so future value does not stagnate in late buckets.');
        paragraphSentences.push('If the pattern flips back toward recent inactivity, quick nudges will have a better chance of preserving revenue.');
    } else {
        paragraphSentences.push('Dormant value is spread thinly across inactivity buckets, so no single lapse window dominates.');
        paragraphSentences.push('That distribution hints at steady maintenance routines that keep dead weight from stacking up.');
        paragraphSentences.push('Maintain your cadence of light reactivation touches just in case, but avoid over-investing where little value is trapped.');
        paragraphSentences.push('Continue monitoring the mix so a spike in early or late inactivity does not catch you off guard.');
        paragraphSentences.push('If a future shift concentrates value in recent lapses, pivot resources toward fast win-back; if it drifts older, prepare for more aggressive hygiene.');
    }
    const paragraph = paragraphSentences.slice(0, 5).join(' ');

    const [showDetails, setShowDetails] = useState(false);

    return (
        <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <div className="flex items-center gap-2 mb-4">
                <Moon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Inactivity Revenue Drain</h3>
                <InfoTooltipIcon
                    placement="bottom-start"
                    content={(
                        <div className="space-y-2">
                            <p className="font-semibold">What</p>
                            <p>How much customer value sits in inactive subscribers.</p>
                            <p className="font-semibold">How</p>
                            <p>Totals CLV for people with no recent opens or clicks.</p>
                            <p className="font-semibold">Why</p>
                            <p>Prioritize win back for the largest, highest value inactive groups.</p>
                        </div>
                    )}
                />
            </div>
            <div className={`grid gap-6 ${defs.length <= 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-5'}`}>
                {defs.map(b => {
                    const share = b.clv / totalClv;
                    const heightPct = (b.clv / maxShare) * 100;
                    return (
                        <div key={b.key} className="flex flex-col">
                            <div className="group relative flex-1 flex flex-col justify-end min-h-[150px]">
                                <div className="w-full relative bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden flex items-end" style={{ minHeight: '150px' }}>
                                    {/* subtle purple-tinted backdrop */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-purple-500/10 via-purple-500/5 to-transparent pointer-events-none" />
                                    <div className="w-full rounded-t-lg bg-gradient-to-b from-purple-400 to-purple-600 transition-all duration-500" style={{ height: `${heightPct}%` }} />
                                </div>
                                <div className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">{pct(b.clv)}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">{b.label}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-500">{formatCurrency(b.clv)}</div>
                                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition z-10 absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                                    <div className="font-semibold mb-1">{b.label} Inactive</div>
                                    <ul className="space-y-0.5">
                                        <li><span className="text-gray-500 dark:text-gray-400">Dormant CLV:</span> {formatCurrency(b.clv)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Share of Total:</span> {pct(b.clv)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Subscribers:</span> {b.count.toLocaleString('en-US')}</li>
                                    </ul>
                                    <div className="absolute left-1/2 bottom-0 translate-y-full -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-900 border-b border-r border-gray-200 dark:border-gray-700" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-4 text-xs md:text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-4">
                <div><span className="font-medium text-gray-600 dark:text-gray-300">Total Historic CLV:</span> {formatCurrency(totalClv)}</div>
                <div><span className="font-medium text-gray-600 dark:text-gray-300">Dormant Historic CLV:</span> {formatCurrency(totalDormantClv)} ({((totalDormantClv / totalClv) * 100).toFixed(1)}%)</div>
            </div>
            <div className="mt-6 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{headline}</p>
                        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{summary}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowDetails(prev => !prev)}
                        className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                        aria-expanded={showDetails}
                        aria-controls="dormant-rev-insights"
                    >
                        {showDetails ? 'Hide Insights' : 'View Insights'}
                        <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
                    </button>
                </div>
                {showDetails && (
                    <p id="dormant-rev-insights" className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{paragraph}</p>
                )}
            </div>
        </div>
    );
}
