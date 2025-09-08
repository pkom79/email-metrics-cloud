"use client";
import React, { useMemo } from 'react';
import { AlertTriangle, CalendarRange, Layers, LineChart, MailX, Percent } from 'lucide-react';
import MetricCard from './MetricCard';
import { DataManager } from '../../lib/data/dataManager';
import { computeCampaignGapsAndLosses } from '../../lib/analytics/campaignGapsLosses';

interface Props { dateRange: string; granularity?: 'daily' | 'weekly' | 'monthly'; customFrom?: string; customTo?: string; }

export default function CampaignGapsAndLosses({ dateRange, granularity, customFrom, customTo }: Props) {
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

    // Visibility gate: only in 90-day Weekly view
    const weekly90 = dateRange === '90d' && granularity === 'weekly';
    if (!weekly90) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
                <div className="text-sm text-gray-600 dark:text-gray-400">This module is available only in the 90-day Weekly view.</div>
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

    const showInsufficientBanner = result.insufficientWeeklyData || result.hasLongGaps;
    if (showInsufficientBanner) {
        const msg = result.insufficientWeeklyData
            ? 'Insufficient data to estimate weekly losses. Need ≥66% of weeks with campaigns sent in this 90-day period. Try expanding your time range.'
            : 'Insufficient data for weekly analysis in this period. Try a different time range.';
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
                <div className="text-sm text-amber-700 dark:text-amber-300">{msg}</div>
            </div>
        );
    }

    // Render six cards when sufficient data
    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><CalendarRange className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Gaps & Losses</h3></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Row 1 — Consistency & Gaps */}
                <MetricCard title="Zero Campaign Send Weeks" value={result.zeroCampaignSendWeeks.toLocaleString()} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="Longest Gap Without Campaigns" value={`${result.longestZeroSendGap.toLocaleString()} wk${result.longestZeroSendGap === 1 ? '' : 's'}`} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="% of Weeks With Campaigns Sent" value={`${result.pctWeeksWithCampaignsSent.toFixed(1)}%`} change={0} isPositive={true} dateRange={dateRange} category="campaign" />
                {/* Row 2 — Impact & Effectiveness */}
                <MetricCard title="Estimated Lost Revenue" value={formatCurrency(result.estimatedLostRevenue || 0)} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="Low-Effectiveness Campaigns" value={result.lowEffectivenessCampaigns.toLocaleString()} change={0} isPositive={false} dateRange={dateRange} category="campaign" />
                <MetricCard title="Average Campaigns per Week" value={result.avgCampaignsPerWeek.toFixed(2)} change={0} isPositive={true} dateRange={dateRange} category="campaign" />
            </div>
        </div>
    );
}
