"use client";
import React, { useMemo } from 'react';
import { AlertTriangle, CalendarRange, Layers, LineChart, MailX, Percent } from 'lucide-react';
import MetricCard from './MetricCard';
import InfoTooltipIcon from '../InfoTooltipIcon';
import TooltipPortal from '../TooltipPortal';
import { DataManager } from '../../lib/data/dataManager';
import type { ProcessedCampaign } from '../../lib/data/dataTypes';
import { computeCampaignGapsAndLosses } from '../../lib/analytics/campaignGapsLosses';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatCurrency = (v: number) => currencyFormatter.format(v || 0);
const formatWeeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;

interface Props {
    dateRange: string;
    granularity?: 'daily' | 'weekly' | 'monthly';
    customFrom?: string;
    customTo?: string;
    // Reuse same dataset as Top Campaigns to keep counts consistent across modules
    filteredCampaigns?: ProcessedCampaign[];
}

export default function CampaignGapsAndLosses({ dateRange, granularity, customFrom, customTo, filteredCampaigns }: Props) {
    const dm = DataManager.getInstance();
    const campaigns = (filteredCampaigns && filteredCampaigns.length) ? filteredCampaigns : dm.getCampaigns();
    // Intentionally exclude flows from this module; other modules still use them

    const range = useMemo(() => {
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
            // Anchor strictly to campaigns timeline for weekly campaign coverage.
            if (!campaigns.length) return null;
            let maxTime = 0; for (const e of campaigns) { const t = e.sentDate?.getTime?.(); if (Number.isFinite(t) && t! > maxTime) maxTime = t!; }
            const latestCampaign = new Date(maxTime);
            const end = new Date(maxTime); end.setHours(23, 59, 59, 999);
            const days = parseInt(String(dateRange).replace('d', '')) || 30;
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            try {
                // eslint-disable-next-line no-console
                console.debug('[CampaignGaps&Losses] range', { dateRange, start: start.toISOString(), end: end.toISOString(), latestCampaign: latestCampaign.toISOString(), campaignsCount: campaigns.length });
            } catch { }
            return { start, end };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, campaigns]);

    const result = useMemo(() => {
        if (!range) return null;
        return computeCampaignGapsAndLosses({ campaigns, flows: [], rangeStart: range.start, rangeEnd: range.end });
    }, [range, campaigns]);

    const actionNote = useMemo(() => {
        if (!result) return null;
        const zeroWeeks = result.zeroCampaignSendWeeks;
        const longestGap = result.longestZeroSendGap;
        const pctCoverage = Number.isFinite(result.pctWeeksWithCampaignsSent) ? result.pctWeeksWithCampaignsSent : 0;
        const lostRevenueRaw = result.estimatedLostRevenue;
        const totalWeeks = result.weeksInRangeFull;

        const sample = totalWeeks > 0 ? `Based on ${formatWeeks(totalWeeks)} in this date range.` : null;

        if (zeroWeeks <= 0) {
            return {
                title: 'Keep weekly cadence humming',
                message: 'You shipped campaigns every full week in this range. Maintain a backup promo or automation so this coverage stays intact when volume shifts.',
                sample
            };
        }

        const coverageText = `${pctCoverage.toFixed(1)}%`;
        const missedWeeksText = zeroWeeks.toLocaleString('en-US');
        const missedRevenueText = lostRevenueRaw != null ? formatCurrency(lostRevenueRaw) : 'an unestimated amount';

        const weekStarts = result.zeroSendWeekStarts ?? [];
        const runLengths = (() => {
            if (!weekStarts.length) {
                return longestGap > 0 ? [longestGap] : [zeroWeeks];
            }
            const sorted = [...weekStarts].sort();
            const runs: number[] = [];
            const toDate = (iso: string) => {
                const date = new Date(iso);
                date.setHours(0, 0, 0, 0);
                return date;
            };
            let currentLen = 1;
            let prev = toDate(sorted[0]);
            for (let i = 1; i < sorted.length; i++) {
                const curr = toDate(sorted[i]);
                const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays === 7) {
                    currentLen += 1;
                } else {
                    runs.push(currentLen);
                    currentLen = 1;
                }
                prev = curr;
            }
            runs.push(currentLen);
            const total = runs.reduce((sum, len) => sum + len, 0);
            if (total !== zeroWeeks && zeroWeeks > 0) {
                return [zeroWeeks];
            }
            return runs;
        })();

        const runCount = runLengths.length;
        const maxLen = Math.max(...runLengths);
        const averageLen = runLengths.reduce((sum, len) => sum + len, 0) / runCount;
        const medianLen = (() => {
            const sorted = [...runLengths].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
            return sorted[mid];
        })();

        const shortRuns = runLengths.filter(len => len <= 2);
        const longRuns = runLengths.filter(len => len >= 3);
        const hasShort = shortRuns.length > 0;
        const hasLong = longRuns.length > 0;

        const typicalGapLengthWeeks = Math.max(1, Math.round(medianLen || averageLen || maxLen || 1));
        const typicalGapLengthText = formatWeeks(typicalGapLengthWeeks);
        const maxGapText = formatWeeks(maxLen);
        const avgLongGapText = formatWeeks(Math.max(1, Math.round(longRuns.length ? (longRuns.reduce((sum, len) => sum + len, 0) / longRuns.length) : maxLen)));
        const shortGapText = formatWeeks(Math.max(1, shortRuns.length ? Math.min(...shortRuns) : 1));
        const longGapText = formatWeeks(Math.max(1, longRuns.length ? Math.max(...longRuns) : maxLen));

        type TemplateKey = 'fewSmall' | 'manySmall' | 'oneLong' | 'fewLong' | 'mixed' | 'backToBack' | 'intermittent';
        let template: TemplateKey;

        if (runCount === 1) {
            if (maxLen >= 4) template = 'backToBack';
            else if (maxLen >= 2) template = 'oneLong';
            else template = 'fewSmall';
        } else if (!hasLong) {
            if (runCount <= 3) template = 'fewSmall';
            else if (pctCoverage >= 75) template = 'manySmall';
            else template = 'intermittent';
        } else if (!hasShort) {
            template = 'fewLong';
        } else if (hasShort && hasLong) {
            template = 'mixed';
        } else {
            template = 'intermittent';
        }

        const buildMessage = (): { title: string; message: string } => {
            switch (template) {
                case 'fewSmall':
                    return {
                        title: 'A few small breaks',
                        message: `You missed ${missedWeeksText} scattered weeks (coverage ${coverageText}). Each gap was about ${typicalGapLengthText} long, adding up to ${missedRevenueText} in lost revenue. Set up an automated backup campaign so the occasional off week still generates returns.`
                    };
                case 'manySmall':
                    return {
                        title: 'Many small breaks',
                        message: `You missed ${missedWeeksText} short weeks here and there (coverage ${coverageText}). None lasted more than ${maxGapText}, yet the repeated pauses added up to ${missedRevenueText} in lost revenue. A safety send will smooth out these dips and keep coverage steady.`
                    };
                case 'oneLong': {
                    const descriptor = runCount === 1 ? 'one' : missedWeeksText;
                    return {
                        title: 'One longer gap',
                        message: `You missed ${descriptor} stretch of ${formatWeeks(maxLen)} (coverage ${coverageText}). That single break cost ${missedRevenueText}. Add a fallback send to prevent long gaps like this from draining revenue again.`
                    };
                }
                case 'fewLong':
                    return {
                        title: 'A few longer gaps',
                        message: `You missed ${missedWeeksText} longer breaks of about ${avgLongGapText} each (coverage ${coverageText}). Those gaps added up to ${missedRevenueText} in missed revenue. Automated campaigns will keep the calendar full even during extended pauses.`
                    };
                case 'mixed':
                    return {
                        title: 'Mixed short and long gaps',
                        message: `You missed ${missedWeeksText} weeks overall (coverage ${coverageText}). Some gaps were only ${shortGapText}, while one stretched ${longGapText}. Together they cost ${missedRevenueText}. A safety send ensures both small and long breaks are covered.`
                    };
                case 'backToBack':
                    return {
                        title: 'Back-to-back gaps',
                        message: `You missed ${missedWeeksText} consecutive weeks (coverage ${coverageText}). Consecutive downtime hurts the most, adding up to ${missedRevenueText} in lost revenue. Automating a fallback campaign will keep revenue flowing even when you step away.`
                    };
                case 'intermittent':
                default:
                    return {
                        title: 'Intermittent scattered gaps',
                        message: `You missed ${missedWeeksText} weeks spread across the year (coverage ${coverageText}). No single gap was longer than ${maxGapText}, but the irregular pattern still chipped away at ${missedRevenueText}. Keep the calendar steady with a backup send.`
                    };
            }
        };

        const { title, message } = buildMessage();
        return { title, message, sample };
    }, [result]);

    if (!range || !result) return null;

    // Visibility gate: show only in Weekly view for ranges >= 90 days (presets or custom)
    const daysSpan = Math.floor((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const weekly90Plus = granularity === 'weekly' && daysSpan >= 90;
    if (!weekly90Plus) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 flex flex-col items-center justify-center text-center">
                    <CalendarRange className="w-10 h-10 text-gray-300 mb-3" />
                    <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Weekly view and 90+ days required</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">This module is available only in the Weekly view for ranges 90 days or longer.</p>
                </div>
            </div>
        );
    }

    // All-weeks-sent: show success message instead of cards
    if (result.allWeeksSent) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
                <div className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Good job! You ran campaigns each week during this period.</div>
            </div>
        );
    }

    // Empty state if the selected range contains zero full weeks
    if (result.weeksInRangeFull === 0) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 flex flex-col items-center justify-center text-center">
                    <MailX className="w-10 h-10 text-gray-300 mb-3" />
                    <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Not enough data in this period</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">We didn’t find any complete weeks inside this range. Try a longer date range.</p>
                </div>
            </div>
        );
    }

    const showInsufficientBanner = result.insufficientWeeklyData;

    // Render six cards when sufficient data
    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
            </div>
            {showInsufficientBanner && (
                <div className="mb-4 rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-3">
                    <div className="text-sm text-amber-800 dark:text-amber-200">Limited weekly coverage (need ≥66% of weeks with campaigns). Estimates shown below are conservative and may be less reliable. Consider expanding your time range.</div>
                    {result.suspectedCsvCoverageGap && (
                        <div className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                            Heads up: We detected a long {result.suspectedCsvCoverageGap.weeks} week stretch without any campaigns ({result.suspectedCsvCoverageGap.start} → {result.suspectedCsvCoverageGap.end}). If this looks wrong, re-export your Campaigns CSV for that span.
                        </div>
                    )}
                </div>
            )}
            {actionNote && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4 mb-6">
                    <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{actionNote.title}</p>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{actionNote.message}</p>
                    {actionNote.sample && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{actionNote.sample}</p>}
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Row 1 — Consistency & Gaps */}
                <div className="relative">
                    <TooltipPortal
                        content={(
                            <div className="max-w-xs text-gray-900 dark:text-gray-100">
                                <div className="text-sm">Weeks in the selected range with no campaign sends.</div>
                                {!!(result.zeroSendWeekStarts?.length) && (
                                    <div className="mt-2">
                                        <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Weeks</div>
                                        <ul className="max-h-48 overflow-auto space-y-1 pr-1">
                                            {result.zeroSendWeekStarts.slice(0, 10).map((d) => (<li key={d} className="text-xs tabular-nums">{d}</li>))}
                                            {result.zeroSendWeekStarts.length > 10 && (
                                                <li className="text-xs text-gray-600 dark:text-gray-400">+{result.zeroSendWeekStarts.length - 10} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    >
                        <div>
                            <MetricCard title="Zero Campaign Send Weeks" value={result.zeroCampaignSendWeeks.toLocaleString()} change={0} isPositive={false} dateRange={dateRange} category="campaign" hideSparkline variant="stat" />
                        </div>
                    </TooltipPortal>
                </div>
                <div className="relative">
                    <TooltipPortal
                        content={(
                            <div className="max-w-xs text-gray-900 dark:text-gray-100">
                                <div className="text-sm">The longest consecutive streak of weeks with zero campaign sends.</div>
                                {!!(result.longestGapWeekStarts?.length) && (
                                    <div className="mt-2">
                                        <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Weeks in this gap</div>
                                        <ul className="max-h-48 overflow-auto space-y-1 pr-1">
                                            {result.longestGapWeekStarts.slice(0, 10).map((d) => (<li key={d} className="text-xs tabular-nums">{d}</li>))}
                                            {result.longestGapWeekStarts.length > 10 && (
                                                <li className="text-xs text-gray-600 dark:text-gray-400">+{result.longestGapWeekStarts.length - 10} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    >
                        <div>
                            <MetricCard title="Longest Gap Without Campaigns" value={`${result.longestZeroSendGap.toLocaleString()} ${result.longestZeroSendGap === 1 ? 'week' : 'weeks'}`} change={0} isPositive={false} dateRange={dateRange} category="campaign" hideSparkline variant="stat" />
                        </div>
                    </TooltipPortal>
                </div>
                <div className="relative">
                    <TooltipPortal
                        content={(
                            <div className="max-w-xs text-gray-900 dark:text-gray-100">
                                <div className="text-sm">Full weeks inside the range that had at least one campaign.</div>
                                <div className="text-sm font-semibold mt-2 tabular-nums">{result.weeksWithCampaignsSent.toLocaleString()} of {result.weeksInRangeFull.toLocaleString()} weeks</div>
                            </div>
                        )}
                    >
                        <div>
                            <MetricCard title="% of Weeks With Campaigns Sent" value={`${result.pctWeeksWithCampaignsSent.toFixed(1)}%`} change={0} isPositive={true} dateRange={dateRange} category="campaign" hideSparkline variant="stat" />
                        </div>
                    </TooltipPortal>
                </div>
                {/* Row 2 — Impact & Effectiveness */}
                <div className="relative">
                    <TooltipPortal
                        content={(
                            <div className="max-w-xs text-gray-900 dark:text-gray-100">
                                <div className="text-sm">Conservative estimate of revenue missed during gaps. For short gaps (1–4 weeks), we use nearby typical weeks. For longer gaps, we estimate each week using a local ±8 week window with conservative caps and a gentle decay for very long runs.</div>
                            </div>
                        )}
                    >
                        <div>
                            <MetricCard title="Estimated Lost Revenue" value={formatCurrency(result.estimatedLostRevenue || 0)} change={0} isPositive={false} dateRange={dateRange} category="campaign" hideSparkline variant="stat" />
                        </div>
                    </TooltipPortal>
                </div>
                <div className="relative">
                    <TooltipPortal
                        content={(
                            <div className="max-w-xs text-gray-900 dark:text-gray-100">
                                <div className="text-sm">Campaigns in this range with $0 revenue.</div>
                                {!!(result.zeroRevenueCampaignDetails?.length) && (
                                    <div className="mt-2">
                                        <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Campaigns</div>
                                        <ul className="max-h-48 overflow-auto space-y-1 pr-1">
                                            {result.zeroRevenueCampaignDetails.slice(0, 10).map((c, i) => (
                                                <li key={`${c.date}-${i}`} className="text-xs"><span className="tabular-nums mr-1">{new Date(c.date).toISOString().slice(0, 10)}</span> — <span className="truncate inline-block max-w-[12rem] align-bottom" title={c.title}>{c.title || 'Untitled'}</span></li>
                                            ))}
                                            {result.zeroRevenueCampaignDetails.length > 10 && (
                                                <li className="text-xs text-gray-600 dark:text-gray-400">+{result.zeroRevenueCampaignDetails.length - 10} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    >
                        <div>
                            <MetricCard title="Zero Revenue Campaigns" value={(result.zeroRevenueCampaigns ?? result.lowEffectivenessCampaigns).toLocaleString()} change={0} isPositive={false} dateRange={dateRange} category="campaign" hideSparkline variant="stat" />
                        </div>
                    </TooltipPortal>
                </div>
                <div className="relative">
                    <TooltipPortal
                        content={(
                            <div className="max-w-xs text-gray-900 dark:text-gray-100">
                                <div className="text-sm">Total campaigns divided by the number of full weeks in range.</div>
                                <div className="text-sm font-semibold mt-2 tabular-nums">{(result.totalCampaignsInFullWeeks ?? 0).toLocaleString()} total ÷ {result.weeksInRangeFull.toLocaleString()} weeks</div>
                            </div>
                        )}
                    >
                        <div>
                            <MetricCard title="Average Campaigns per Week" value={result.avgCampaignsPerWeek.toFixed(2)} change={0} isPositive={true} dateRange={dateRange} category="campaign" hideSparkline variant="stat" />
                        </div>
                    </TooltipPortal>
                </div>
            </div>
        </div>
    );
}
