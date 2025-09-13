"use client";
import React, { useMemo } from 'react';
import { AlertTriangle, CalendarRange, Layers, LineChart, MailX, Percent } from 'lucide-react';
import MetricCard from './MetricCard';
import InfoTooltipIcon from '../InfoTooltipIcon';
import TooltipPortal from '../TooltipPortal';
import { DataManager } from '../../lib/data/dataManager';
import type { ProcessedCampaign } from '../../lib/data/dataTypes';
import { computeCampaignGapsAndLosses } from '../../lib/analytics/campaignGapsLosses';

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

    if (!range || !result) return null;

    // Visibility gate: show only in Weekly view for ranges >= 90 days (presets or custom)
    const daysSpan = Math.floor((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const weekly90Plus = granularity === 'weekly' && daysSpan >= 90;
    if (!weekly90Plus) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Campaign Gaps & Losses
                    <InfoTooltipIcon placement="top" content={(
                        <div>
                            <p className="font-semibold mb-1">What</p>
                            <p>Weeks you did not send and what that might have cost.</p>
                            <p className="font-semibold mt-2 mb-1">How</p>
                            <p>We find weeks without campaigns and estimate missed revenue.</p>
                            <p className="font-semibold mt-2 mb-1">Why</p>
                            <p>Keep a steady weekly cadence going forward. Plan a realistic schedule and monitor for new gaps.</p>
                        </div>
                    )} />
                </h3></div>
                <div className="text-sm text-gray-600 dark:text-gray-400">This module is available only in the Weekly view for ranges 90 days or longer.</div>
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

    const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

    // Empty state if the selected range contains zero full weeks
    if (result.weeksInRangeFull === 0) {
        return (
            <div className="mt-6">
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
                    <div className="text-sm text-amber-800 dark:text-amber-200">Insufficient data to estimate weekly losses. Need ≥66% of weeks with campaigns sent in this period. Try expanding your time range.</div>
                    {result.suspectedCsvCoverageGap && (
                        <div className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                            Heads up: We detected a long {result.suspectedCsvCoverageGap.weeks} week stretch without any campaigns ({result.suspectedCsvCoverageGap.start} → {result.suspectedCsvCoverageGap.end}). If this looks wrong, re-export your Campaigns CSV for that span.
                        </div>
                    )}
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
                                <div className="text-sm">Conservative estimate of revenue missed during short gaps (1–4 weeks). We look at typical nearby weeks, cap outliers, and multiply by the number of missing weeks.</div>
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
