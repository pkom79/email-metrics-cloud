"use client";
import React, { useMemo } from 'react';
import { AlertTriangle, CalendarRange, Layers, LineChart, MailX, Percent } from 'lucide-react';
import MetricCard from './MetricCard';
import { DataManager } from '../../lib/data/dataManager';
import { computeCampaignGapsAndLosses } from '../../lib/analytics/campaignGapsLosses';

interface Props { dateRange: string; customFrom?: string; customTo?: string; }

export default function CampaignGapsAndLosses({ dateRange, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const campaigns = dm.getCampaigns();
    const flows = dm.getFlowEmails();

    const range = useMemo(() => {
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
            const all = [...campaigns, ...flows];
            if (!all.length) return null;
            let maxTime = 0; for (const e of all) { const t = e.sentDate?.getTime?.(); if (Number.isFinite(t) && t! > maxTime) maxTime = t!; }
            const end = new Date(maxTime); end.setHours(23, 59, 59, 999);
            const days = parseInt(String(dateRange).replace('d', '')) || 30;
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            return { start, end };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, campaigns, flows]);

    const result = useMemo(() => {
        if (!range) return null;
        return computeCampaignGapsAndLosses({ campaigns, flows, rangeStart: range.start, rangeEnd: range.end });
    }, [range, campaigns, flows]);

    if (!range || !result) return null;

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

    // Render six cards; gray out Estimated Lost Revenue when insufficientHistoryForEstimator; add inline note for deferrals
    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
                {result.deferredWeeksOver4 > 0 && (
                    <div className="text-[11px] text-gray-600 dark:text-gray-400">Long gaps deferred to monthly: {result.deferredWeeksOver4} weeks</div>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Row 1 — Consistency & Gaps */}
                <MetricCard title="Zero Campaign Send Weeks" value={result.zeroCampaignSendWeeks.toLocaleString()} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="Longest Gap Without Campaigns" value={`${result.longestZeroSendGap.toLocaleString()} wk${result.longestZeroSendGap === 1 ? '' : 's'}`} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="% of Weeks With Campaigns Sent" value={`${result.pctWeeksWithCampaignsSent.toFixed(1)}%`} change={0} isPositive={true} dateRange={dateRange} category="campaign" />
                {/* Row 2 — Impact & Effectiveness */}
                <div className={`${result.insufficientHistoryForEstimator ? 'opacity-60' : ''}`}>
                    <MetricCard title="Estimated Lost Revenue" value={formatCurrency(result.estimatedLostRevenue || 0)} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                    {result.insufficientHistoryForEstimator && (
                        <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">Insufficient history to estimate lost revenue (need ≥26 weeks and ≥8 non-zero weeks).</div>
                    )}
                </div>
                <MetricCard title="Low-Effectiveness Campaigns" value={result.lowEffectivenessCampaigns.toLocaleString()} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="Average Campaigns per Week" value={result.avgCampaignsPerWeek.toFixed(2)} change={0} isPositive={true} dateRange={dateRange} category="campaign" />
            </div>
        </div>
    );
}
