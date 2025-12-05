"use client";
import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { sendVolumeGuidanceV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import type { SendVolumeGuidanceResultV2, SendVolumeStatusV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import { DataManager } from '../../lib/data/dataManager';
import dayjs from '../../lib/dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

interface Props {
    dateRange: string;
    granularity: 'daily' | 'weekly' | 'monthly';
    customFrom?: string;
    customTo?: string;
    compareMode?: 'none' | 'prev-period' | 'prev-year';
}

const STATUS_LABELS: Record<SendVolumeStatusV2, string> = {
    'send-more': 'Send More',
    'send-less': 'Send Less',
    'optimize': 'Optimize',
    'insufficient': 'Not Enough Data'
};

const STATUS_BADGE_CLASSES: Record<SendVolumeStatusV2, string> = {
    'send-more': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    'send-less': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    'optimize': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'insufficient': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
};

const fmtCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(v);

const fmtPercent = (v: number) => `${v.toFixed(1)}%`;

export default function SendVolumeImpact({ dateRange, granularity, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();

    // Call V2 algorithm - campaigns only, date-range sensitive
    const [showDebug, setShowDebug] = useState(false);

    const guidance = useMemo(
        () => sendVolumeGuidanceV2(dateRange, customFrom, customTo),
        [dateRange, customFrom, customTo]
    );    // Store date range for display in debug section
    const [debugDateRange, setDebugDateRange] = useState<{ from: string; to: string; lastDataDate: string } | null>(null);

    // Get weekly data for debug display
    const weeklyDebugData = useMemo(() => {
        const campaigns = dm.getCampaigns();
        if (!campaigns.length) return [];

        // Parse the user's selected date range using last data date as reference
        // MUST match the exact logic in sendVolumeGuidanceV2.ts
        const { fromDate, toDate } = (() => {
            if (dateRange === 'custom' && customFrom && customTo) {
                return { fromDate: dayjs(customFrom), toDate: dayjs(customTo) };
            }
            // For preset ranges, need to compute from actual last email date
            // Calculate robust last data date (max of campaigns and flows)
            const flows = dm.getFlowEmails();
            const lastCampaignDate = campaigns.length > 0
                ? Math.max(...campaigns.map(c => c.sentDate.getTime()))
                : 0;
            const lastFlowDate = flows.length > 0
                ? Math.max(...flows.map(f => f.sentDate.getTime()))
                : 0;
            const maxTime = Math.max(lastCampaignDate, lastFlowDate);
            const lastDataDate = maxTime > 0 ? dayjs(maxTime) : dayjs();

            const ranges: Record<string, { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs }> = {
                "7d": { fromDate: lastDataDate.subtract(7, "days"), toDate: lastDataDate },
                "14d": { fromDate: lastDataDate.subtract(14, "days"), toDate: lastDataDate },
                "30d": { fromDate: lastDataDate.subtract(30, "days"), toDate: lastDataDate },
                "60d": { fromDate: lastDataDate.subtract(60, "days"), toDate: lastDataDate },
                "90d": { fromDate: lastDataDate.subtract(90, "days"), toDate: lastDataDate },
                "120d": { fromDate: lastDataDate.subtract(120, "days"), toDate: lastDataDate },
                "180d": { fromDate: lastDataDate.subtract(180, "days"), toDate: lastDataDate },
                "365d": { fromDate: lastDataDate.subtract(365, "days"), toDate: lastDataDate },
                "730d": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
                "all": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
            };
            return ranges[dateRange] || ranges["90d"];
        })();

        // Store for debug display
        const flows = dm.getFlowEmails();
        const lastCampaignDate = campaigns.length > 0
            ? Math.max(...campaigns.map(c => c.sentDate.getTime()))
            : 0;
        const lastFlowDate = flows.length > 0
            ? Math.max(...flows.map(f => f.sentDate.getTime()))
            : 0;
        const maxTime = Math.max(lastCampaignDate, lastFlowDate);
        const lastDataDate = maxTime > 0 ? dayjs(maxTime) : dayjs();

        setDebugDateRange({
            from: fromDate.format('MMM D, YYYY'),
            to: toDate.format('MMM D, YYYY'),
            lastDataDate: lastDataDate.format('MMM D, YYYY')
        });

        // Filter campaigns in date range
        const filteredCampaigns = campaigns.filter(c => {
            const sentDate = dayjs(c.sentDate);
            return (sentDate.isAfter(fromDate) || sentDate.isSame(fromDate, 'day')) &&
                (sentDate.isBefore(toDate) || sentDate.isSame(toDate, 'day')) &&
                c.emailsSent >= 500;
        });

        if (filteredCampaigns.length === 0) return [];

        // Aggregate by week
        const weeklyData: Record<string, { volume: number; revenue: number; count: number; weekStart: string }> = {};

        filteredCampaigns.forEach(c => {
            const sentDate = dayjs(c.sentDate);
            const weekKey = `${sentDate.year()}-W${sentDate.isoWeek()}`;

            if (!weeklyData[weekKey]) {
                weeklyData[weekKey] = {
                    volume: 0,
                    revenue: 0,
                    count: 0,
                    weekStart: sentDate.startOf('isoWeek').format('MMM D')
                };
            }

            weeklyData[weekKey].volume += (c.emailsSent || 0);
            weeklyData[weekKey].revenue += (c.revenue || 0);
            weeklyData[weekKey].count += 1;
        });

        // Convert to array and sort by week (descending)
        return Object.entries(weeklyData)
            .map(([key, data]) => ({
                weekKey: key,
                ...data
            }))
            .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
    }, [dm, dateRange, customFrom, customTo]);

    // Render helpers
    const getRateColor = (rate: number, type: 'spam' | 'bounce') => {
        if (type === 'spam') {
            if (rate < 0.1) return 'text-emerald-600 dark:text-emerald-400';
            if (rate <= 0.2) return 'text-yellow-600 dark:text-yellow-400';
            return 'text-rose-600 dark:text-rose-400';
        } else { // bounce
            if (rate < 2.0) return 'text-emerald-600 dark:text-emerald-400';
            if (rate <= 3.0) return 'text-yellow-600 dark:text-yellow-400';
            return 'text-rose-600 dark:text-rose-400';
        }
    };

    const getRateDot = (rate: number, type: 'spam' | 'bounce') => {
        if (type === 'spam') {
            if (rate < 0.1) return 'bg-emerald-500 dark:bg-emerald-400';
            if (rate <= 0.2) return 'bg-yellow-500 dark:bg-yellow-400';
            return 'bg-rose-500 dark:bg-rose-400';
        } else {
            if (rate < 2.0) return 'bg-emerald-500 dark:bg-emerald-400';
            if (rate <= 3.0) return 'bg-yellow-500 dark:bg-yellow-400';
            return 'bg-rose-500 dark:bg-rose-400';
        }
    };

    const getCorrelationLabel = (r: number | null) => {
        if (r === null) return 'N/A';
        // R-squared is always positive
        if (r < 0.1) return 'Negligible Fit';
        if (r < 0.25) return 'Weak Fit';
        if (r < 0.5) return 'Moderate Fit';
        if (r < 0.75) return 'Strong Fit';
        return 'Very Strong Fit';
    };

    const getCorrelationColor = (r: number | null) => {
        if (r === null) return 'text-gray-600 dark:text-gray-400';
        // R-squared strength coloring
        if (r > 0.5) return 'text-emerald-600 dark:text-emerald-400';
        if (r > 0.25) return 'text-blue-600 dark:text-blue-400';
        return 'text-gray-600 dark:text-gray-400';
    };

    return (
        <div className="mt-10 section-card">
            <div className="section-header">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-2">
                        Campaign Send Volume Impact
                        <InfoTooltipIcon
                            placement="top"
                            content={
                                <div className="leading-snug">
                                    <div>
                                        <span className="font-semibold">What:</span> Statistical analysis of how send volume affects revenue.
                                    </div>
                                    <div className="mt-1">
                                        <span className="font-semibold">How:</span> Logarithmic Regression ($y = a + b \cdot \ln(x)$) between campaign volume and revenue (12+ sends required).
                                    </div>
                                    <div className="mt-1">
                                        <span className="font-semibold">Why:</span> Know whether to send more, optimize content, or reduce volume based on actual data.
                                    </div>
                                </div>
                            }
                        />
                    </h3>
                </div>
            </div>

            {/* Metrics Grid: 3 cards (responsive layout) */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Correlation */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Model Fit ($R^2$)</div>
                    <div className={`text-3xl font-semibold tabular-nums ${getCorrelationColor(guidance.correlationCoefficient)}`}>
                        {guidance.correlationCoefficient !== null ? guidance.correlationCoefficient.toFixed(3) : 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        {getCorrelationLabel(guidance.correlationCoefficient)}
                    </div>
                </div>

                {/* Average Spam Rate with dot indicator */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${getRateDot(guidance.avgSpamRate, 'spam')}`}></span>
                        Avg Spam
                    </div>
                    <div className={`text-3xl font-semibold tabular-nums ${getRateColor(guidance.avgSpamRate, 'spam')}`}>
                        {guidance.avgSpamRate.toFixed(3)}%
                    </div>
                </div>

                {/* Average Bounce Rate with dot indicator */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${getRateDot(guidance.avgBounceRate, 'bounce')}`}></span>
                        Avg Bounce
                    </div>
                    <div className={`text-3xl font-semibold tabular-nums ${getRateColor(guidance.avgBounceRate, 'bounce')}`}>
                        {guidance.avgBounceRate.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* Campaign List Debug - Collapsible */}
            <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
                <button
                    onClick={() => setShowDebug(!showDebug)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-lg"
                >
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Weekly Data Points ({weeklyDebugData.length})
                    </span>
                    {showDebug ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                </button>

                {showDebug && (
                    <div className="border-t border-gray-200 dark:border-gray-700 p-4 max-h-96 overflow-y-auto">
                        <div className="space-y-2">
                            {weeklyDebugData.map((w, idx) => (
                                <div key={w.weekKey} className="text-xs border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
                                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                                        {idx + 1}. Week of {w.weekStart}
                                    </div>
                                    <div className="mt-1 space-y-1 text-gray-600 dark:text-gray-400">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <span className="font-medium">Campaigns:</span> {w.count}
                                            </div>
                                            <div>
                                                <span className="font-medium">Total Volume:</span> {w.volume.toLocaleString()}
                                            </div>
                                            <div>
                                                <span className="font-medium">Total Revenue:</span> {fmtCurrency(w.revenue)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {weeklyDebugData.length === 0 && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
                                    No data found in selected date range
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Action Note with Revenue Projection */}
            <div className="mt-8 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recommendation</p>
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            {guidance.message}
                        </p>

                        {/* Revenue Opportunity Projection */}
                        {guidance.projectedMonthlyGain !== null && guidance.projectedMonthlyGain > 0 && (
                            <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                                <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
                                    Revenue Opportunity Projection
                                </div>
                                <div className="text-sm text-emerald-800 dark:text-emerald-200">
                                    Increasing volume by 20% is projected to add {fmtCurrency(guidance.projectedMonthlyGain)} in monthly revenue.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Badge(s) */}
                    <div className="flex flex-wrap gap-2 self-start">
                        <span
                            className={`px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${STATUS_BADGE_CLASSES[guidance.status]
                                }`}
                        >
                            {STATUS_LABELS[guidance.status]}
                        </span>

                        {/* Yellow Zone: High Risk Badge */}
                        {guidance.highRisk && (
                            <span className="px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Higher Risk
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
