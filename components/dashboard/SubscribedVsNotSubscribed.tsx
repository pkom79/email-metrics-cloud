"use client";
import React, { useMemo, useState, useEffect } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import InfoTooltipIcon from "../InfoTooltipIcon";
import SelectBase from "../ui/SelectBase";
import { DataManager } from "../../lib/data/dataManager";
import { getConsentSplitMetrics, formatConsentMetricValue, ConsentSplitMetric } from "../../lib/analytics/consentSplitMetrics";

interface Props { dateRange: string; customFrom?: string; customTo?: string; referenceDate?: Date }

type ConsentGroupKey = "Subscribed" | "Not Subscribed";

interface ConsentActionNote {
    headline: string;
    summary: string;
    paragraph: string;
}

const formatPercent = (value: number) => {
    const formatted = value.toFixed(1);
    const num = parseFloat(formatted);
    return num >= 1000 ? `${num.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
};

export default function SubscribedVsNotSubscribed({ dateRange, customFrom, customTo, referenceDate }: Props) {
    const dm = DataManager.getInstance();
    const subscribers = dm.getSubscribers();
    const [metric, setMetric] = useState<ConsentSplitMetric>("count");
    const [hovered, setHovered] = useState<{
        key: string;
        value: number;
        sampleSize: number;
        percentOfGroup?: number | null;
        idx: number;
    } | null>(null);
    const [showActionNoteDetails, setShowActionNoteDetails] = useState(false);
    const [allowActionNote, setAllowActionNote] = useState(true);

    const range = useMemo(() => {
        // Reuse DataManager logic to compute start/end dates analogous to other modules
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
            if (dateRange === 'all') {
                const subs = subscribers;
                if (!subs.length) return null;
                const dates = subs.map(s => s.profileCreated.getTime());
                const min = Math.min(...dates), max = Math.max(...dates);
                return { start: new Date(min), end: new Date(max) };
            }
            const days = parseInt(String(dateRange).replace('d', '')) || 30;
            const anchor = referenceDate ? new Date(referenceDate) : dm.getLastEmailDate();
            const end = new Date(anchor); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            return { start, end };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, dm, referenceDate, subscribers]);

    const filteredSubs = useMemo(() => {
        const all = subscribers;
        if (!range) return all;
        // Filter by profileCreated inside range; this addresses large imports outside focus window
        return all.filter(s => s.profileCreated >= range.start && s.profileCreated <= range.end);
    }, [range, subscribers]);

    const anchor = useMemo(() => (referenceDate ? new Date(referenceDate) : (dm.getLastEmailDate() || new Date())), [dm, referenceDate]);
    const split = useMemo(() => getConsentSplitMetrics(filteredSubs, metric, anchor), [filteredSubs, metric, anchor]);

    const periodLabel = useMemo(() => {
        if (!range) return '';
        // Friendly label depending on dateRange
        if (dateRange.endsWith('d')) {
            const days = parseInt(dateRange.replace('d', '')) || 30;
            return `Created in the last ${days} days`;
        }
        const from = range.start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const to = range.end.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        return `Created between ${from} – ${to}`;
    }, [range, dateRange]);

    const actionNote = useMemo<ConsentActionNote | null>(() => {
        if (!filteredSubs.length) return null;

        const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;

        const notePeriod = (() => {
            const currentRange = range;
            if (!currentRange) return 'the selected window';
            if (typeof dateRange === 'string' && dateRange.endsWith('d')) {
                const days = parseInt(dateRange.replace('d', ''), 10) || 30;
                return `profiles created in the last ${days} days`;
            }
            if (dateRange === 'custom' && customFrom && customTo) {
                const from = new Date(`${customFrom}T00:00:00`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                const to = new Date(`${customTo}T23:59:59`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                return `profiles created between ${from} and ${to}`;
            }
            if (dateRange === 'all') {
                return 'the full subscriber history';
            }
            const from = currentRange.start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            const to = currentRange.end.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            return `profiles created between ${from} and ${to}`;
        })();

        const toMap = (groups: { key: ConsentGroupKey; value: number; sampleSize: number; percentOfGroup?: number | null }[]) => {
            return groups.reduce<Record<ConsentGroupKey, { value: number; sampleSize: number; percent?: number }>>((acc, group) => {
                acc[group.key] = { value: group.value || 0, sampleSize: group.sampleSize || 0, percent: group.percentOfGroup ?? undefined };
                return acc;
            }, {
                Subscribed: { value: 0, sampleSize: 0 },
                'Not Subscribed': { value: 0, sampleSize: 0 },
            });
        };

        const countMap = toMap(getConsentSplitMetrics(filteredSubs, 'count', safeAnchor).groups);
        const revenueMap = toMap(getConsentSplitMetrics(filteredSubs, 'totalRevenue', safeAnchor).groups);
        const engagedMap = toMap(getConsentSplitMetrics(filteredSubs, 'engaged30', safeAnchor).groups);

        const subscribedCount = countMap.Subscribed.value;
        const notSubscribedCount = countMap['Not Subscribed'].value;
        const totalCount = subscribedCount + notSubscribedCount;
        if (totalCount === 0) return null;

        const subscribedRevenue = revenueMap.Subscribed.value;
        const notSubscribedRevenue = revenueMap['Not Subscribed'].value;
        const totalRevenue = subscribedRevenue + notSubscribedRevenue;

        const subscribedVolumeShare = totalCount > 0 ? (subscribedCount / totalCount) * 100 : 0;
        const notSubscribedVolumeShare = 100 - subscribedVolumeShare;
        const subscribedValueShare = totalRevenue > 0 ? (subscribedRevenue / totalRevenue) * 100 : subscribedVolumeShare;
        const notSubscribedValueShare = 100 - subscribedValueShare;

        const subscribedEngaged = engagedMap.Subscribed.percent ?? 0;
        const notSubscribedEngaged = engagedMap['Not Subscribed'].percent ?? 0;
        const engagedDelta = subscribedEngaged - notSubscribedEngaged;

        const valueDiff = subscribedValueShare - notSubscribedValueShare;
        const volumeDiff = subscribedVolumeShare - notSubscribedVolumeShare;

        const subscribedValueLead = valueDiff >= 5;
        const notSubscribedValueLead = valueDiff <= -5;
        const subscribedVolumeLead = volumeDiff >= 5;
        const notSubscribedVolumeLead = volumeDiff <= -5;
        const engagedLeadSubscribed = engagedDelta >= 2;
        const engagedLeadNotSubscribed = engagedDelta <= -2;

        const shareLabel = formatPercent(subscribedValueShare);
        const headline = `Subscribed profiles drive ${shareLabel} of tracked revenue for ${notePeriod}.`;

        const subscribedValueMeaningful = subscribedValueShare >= 10;
        const notSubscribedValueMeaningful = notSubscribedValueShare >= 10;
        const countDelta = subscribedCount - notSubscribedCount;

        let summary: string;
        if (subscribedValueLead && engagedLeadSubscribed) {
            summary = 'Subscribed profiles bring the most value and activity, so grow that opted-in list and invite imports to confirm.';
        } else if (notSubscribedVolumeLead) {
            summary = 'Not subscribed profiles make up most of the list, so ask them to opt in and remove the ones who stay quiet.';
        } else if (notSubscribedValueLead) {
            summary = 'Revenue leans on not subscribed profiles, so turn their spend into opt-ins and tidy up inactive records.';
        } else {
            summary = 'Value and engagement are split, so run opt-in pushes and regular clean-up together.';
        }

        const describeShare = (pct: number) => {
            if (pct >= 65) return 'Most';
            if (pct >= 55) return 'More than half';
            if (pct >= 45) return 'Roughly half';
            if (pct >= 35) return 'Less than half';
            return 'A small slice';
        };

        const sentences: string[] = [];
        const timeframeDescriptor = notePeriod || 'the selected window';

        const firstSentenceLead = describeShare(subscribedValueShare);
        sentences.push(`${firstSentenceLead} of the revenue we track still comes from subscribed profiles during ${timeframeDescriptor}.`);

        if (engagedLeadSubscribed) {
            sentences.push('They also open and click more in the recent window, which shows opted-in readers stay engaged.');
        } else if (engagedLeadNotSubscribed) {
            sentences.push('Not subscribed contacts are opening slightly more right now, so recent imports still respond when nudged.');
        } else {
            sentences.push('Recent engagement looks similar for both groups, so consent status by itself does not tell you who is active.');
        }

        if (notSubscribedVolumeLead) {
            sentences.push('Not subscribed profiles make up more of the list, which boosts reach but adds deliverability risk if they cool off.');
        } else if (subscribedVolumeLead) {
            sentences.push('Subscribed profiles also dominate volume, so growth is anchored in permission-based channels.');
        } else {
            sentences.push('Overall volume is fairly balanced between consented and imported cohorts.');
        }

        if (countDelta > 0) {
            sentences.push(`${Math.abs(countDelta).toLocaleString()} more subscribed profiles were created than not subscribed in this window.`);
        } else if (countDelta < 0) {
            sentences.push(`${Math.abs(countDelta).toLocaleString()} more not subscribed profiles were created than subscribed in this window.`);
        }

        let ltvSentence: string;
        if (subscribedValueMeaningful && notSubscribedValueMeaningful) {
            ltvSentence = 'Both groups account for a noticeable share of lifetime value, so keep their journeys active.';
        } else if (subscribedValueMeaningful) {
            ltvSentence = 'Subscribed profiles account for a noticeable share of lifetime value, so keep that audience warm.';
        } else if (notSubscribedValueMeaningful) {
            ltvSentence = 'Not subscribed contacts still hold a noticeable slice of lifetime value, so move them toward opt-in before they drop off.';
        } else {
            ltvSentence = 'Lifetime value is spread thin across both consent groups right now.';
        }
        sentences.push(ltvSentence);

        let actionSentence: string;
        if (subscribedValueLead) {
            actionSentence = 'Offer simple welcome perks to reward subscribers, and send a short opt-in series to imports so they can join them.';
        } else if (notSubscribedValueLead) {
            actionSentence = 'Plan a quick opt-in path for not subscribed buyers and remove imports who stay silent after a few reminders.';
        } else {
            actionSentence = 'Run opt-in nudges alongside fast clean-up passes that pause emails to imports who never respond.';
        }
        sentences.push(actionSentence);

        sentences.push('If imports start growing faster than revenue from subscribers, slow new imports and focus on collecting consent first.');

        const paragraph = sentences.slice(0, 6).join(' ');

        return {
            headline,
            summary,
            paragraph,
        };
    }, [anchor, customFrom, customTo, dateRange, filteredSubs, range]);

    // Safety guard: if a stale duplicate action note card remains in the DOM (e.g. legacy placement), remove extras
    useEffect(() => {
        if (typeof document === 'undefined') return;
        // small timeout gives React a tick to mount potential duplicates
        const t = setTimeout(() => {
            const cards = document.querySelectorAll('[data-consent-action-note="svns"]');
            if (cards.length > 1) {
                cards.forEach((el, idx) => {
                    if (idx > 0) {
                        // Remove subsequent duplicates
                        el.parentElement?.removeChild(el);
                    }
                });
            }
        }, 0);
        return () => clearTimeout(t);
    }, [actionNote]);

    // Global guard: only permit first mounted instance to render the card
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const w = window as any;
        if (w.__SVNS_NOTE_RENDERED) {
            setAllowActionNote(false);
        } else {
            w.__SVNS_NOTE_RENDERED = true;
            setAllowActionNote(true);
        }
        return () => {
            // do not unset on unmount to avoid flicker during fast refresh; comment out if needed
        };
    }, []);

    if (!filteredSubs.length) return null;

    // Prepare chart values
    const maxValue = Math.max(...split.groups.map(g => g.value), 0);
    const chartHeight = 150; const barH = 30; const spacing = 12; const startY = 40; const labelW = 130; const width = 800;

    return (
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <BarChart3 className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        Subscribed vs Not Subscribed
                        <InfoTooltipIcon placement="top" content={(
                            <div className="leading-snug text-xs sm:text-sm">
                                <p className="font-semibold mb-1">What</p>
                                <p>Compare Subscribed vs Not Subscribed profiles by size, value, and engagement.</p>
                                <p className="font-semibold mt-2 mb-1">Subscribed</p>
                                <p>Profiles that gave explicit consent for email marketing.</p>
                                <p className="font-semibold mt-2 mb-1">Not Subscribed</p>
                                <p>Profiles from imports or integrations (e.g. Shopify). If not suppressed, they still receive emails.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>Last engagement uses the most recent open or click. Profile creation follows the selected time range.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Shows whether Subscribed profiles drive more value than Not Subscribed.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="relative">
                    <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value as ConsentSplitMetric)} className="px-3 h-9 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                        <option value="count">Count</option>
                        <option value="buyers">Buyers</option>
                        <option value="nonBuyers">Non-Buyers</option>
                        <option value="repeatBuyers">Repeat Buyers</option>
                        <option value="ltvBuyers">LTV Buyers</option>
                        <option value="ltvAll">LTV All</option>
                        <option value="totalRevenue">Total Revenue</option>
                        <option value="engaged30">Engaged in Last 30 days</option>
                        <option value="engaged60">Engaged in Last 60 days</option>
                        <option value="engaged90">Engaged in Last 90 days</option>
                    </SelectBase>
                </div>
            </div>

            <div className="px-6 -mt-2 mb-2">
                {periodLabel && <p className="text-xs text-gray-600 dark:text-gray-400">{periodLabel}</p>}
            </div>

            <div className="px-6 pb-5">
                <div className="relative w-full">
                    <svg width="100%" height={chartHeight + 60} viewBox={`0 0 ${width} ${chartHeight + 60}`} onMouseLeave={() => setHovered(null)}>
                        <defs>
                            <linearGradient id="svns-bar" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.95} />
                                <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.75} />
                            </linearGradient>
                            <filter id="svns-shadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.1" />
                            </filter>
                        </defs>

                        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                            const x = labelW + ratio * (width - labelW - 40);
                            const val = maxValue * ratio;
                            return (
                                <g key={i}>
                                    <text x={x} y={chartHeight + 35} textAnchor="middle" className="text-xs fill-gray-500 tabular-nums">{formatConsentMetricValue(metric, val)}</text>
                                    {ratio > 0 && <line x1={x} y1={startY} x2={x} y2={chartHeight + 15} stroke="#f3f4f6" strokeWidth={1} strokeDasharray="2,2" />}
                                </g>
                            );
                        })}

                        {split.groups.map((g, idx) => {
                            const y = startY + idx * (barH + spacing);
                            const w = maxValue > 0 ? (g.value / maxValue) * (width - labelW - 60) : 0;
                            return (
                                <g key={g.key}>
                                    <rect
                                        x={labelW}
                                        y={y}
                                        width={Math.max(w, 2)}
                                        height={barH}
                                        fill="url(#svns-bar)"
                                        rx="4"
                                        ry="4"
                                        filter="url(#svns-shadow)"
                                        className="cursor-pointer transition-opacity hover:opacity-90"
                                        onMouseEnter={() => setHovered({ key: g.key, value: g.value, sampleSize: g.sampleSize, percentOfGroup: g.percentOfGroup ?? null, idx })}
                                    >
                                        <title>
                                            {`${g.key} • ${formatConsentMetricValue(metric, g.value)} • ${g.sampleSize.toLocaleString()} profiles${g.percentOfGroup != null ? ` • ${(g.percentOfGroup).toFixed(1)}% of group` : ''}`}
                                        </title>
                                    </rect>
                                    <text x={labelW - 10} y={y + barH / 2 + 4} textAnchor="end" className="text-sm font-medium fill-gray-700 dark:fill-gray-300">{g.key}</text>
                                </g>
                            );
                        })}

                        <line x1={labelW} y1={startY} x2={labelW} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                        <line x1={labelW} y1={chartHeight + 15} x2={width - 40} y2={chartHeight + 15} stroke="#d1d5db" strokeWidth={2} />
                    </svg>

                    {hovered && (
                        (() => {
                            const barWidth = maxValue > 0 ? (hovered.value / maxValue) * (width - labelW - 60) : 0;
                            const leftPercent = ((labelW + (barWidth / 2)) / (width / 100));
                            const topPx = startY + (hovered.idx * (barH + spacing)) + (barH / 2) - 20;
                            return (
                                <div
                                    className="absolute z-20 p-3 rounded-lg shadow-xl border text-sm pointer-events-none backdrop-blur-sm bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 transform -translate-x-1/2 -translate-y-full"
                                    style={{ left: `${leftPercent}%`, top: `${topPx}px` }}
                                >
                                    <div className="font-semibold mb-1">{hovered.key}</div>
                                    <div className="font-medium text-purple-600 dark:text-purple-400">{formatConsentMetricValue(metric, hovered.value)}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {hovered.sampleSize.toLocaleString()} profiles{hovered.percentOfGroup != null ? ` • ${hovered.percentOfGroup.toFixed(1)}% of group` : ''}
                                    </div>
                                </div>
                            );
                        })()
                    )}
                </div>
            </div>

            {actionNote && allowActionNote && (
                <div className="px-6 pb-6 border-t border-gray-100 dark:border-gray-800">
                    <div className="mt-4 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4" data-consent-action-note="svns">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{actionNote.headline}</p>
                                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{actionNote.summary}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowActionNoteDetails(prev => !prev)}
                                className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                                aria-expanded={showActionNoteDetails}
                                aria-controls="consent-action-note-details"
                            >
                                {showActionNoteDetails ? 'Hide Insights' : 'View Insights'}
                                <ChevronDown className={`w-4 h-4 transition-transform ${showActionNoteDetails ? 'rotate-180' : ''}`} />
                            </button>
                        </div>
                        {showActionNoteDetails && (
                            <div id="consent-action-note-details" className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                <p>{actionNote.paragraph}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
