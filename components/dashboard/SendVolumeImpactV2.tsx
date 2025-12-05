"use client";
import React, { useMemo } from 'react';
import { Activity, AlertTriangle, CalendarRange } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { sendVolumeGuidanceV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import type { SendVolumeStatusV2 } from '../../lib/analytics/sendVolumeGuidanceV2';

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

export default function SendVolumeImpact({ dateRange, granularity, customFrom, customTo }: Props) {
    const guidance = useMemo(
        () => sendVolumeGuidanceV2(dateRange, customFrom, customTo),
        [dateRange, customFrom, customTo]
    );
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
        if (r < 0.1) return 'No Clear Pattern';
        if (r < 0.25) return 'Weak Pattern';
        if (r < 0.5) return 'Moderate Pattern';
        if (r < 0.75) return 'Strong Pattern';
        return 'Very Strong Pattern';
    };

    const getCorrelationColor = (r: number | null) => {
        if (r === null) return 'text-gray-600 dark:text-gray-400';
        // R-squared strength coloring
        if (r > 0.5) return 'text-emerald-600 dark:text-emerald-400';
        if (r > 0.25) return 'text-blue-600 dark:text-blue-400';
        return 'text-gray-600 dark:text-gray-400';
    };

    const minCampaignsRequired = guidance.dataContext?.minCampaignsRequired ?? 12;
    const minLookbackDaysRequired = 90; // Matches the minimum in sendVolumeGuidanceV2
    const lookbackDaysInRange = guidance.dataContext?.lookbackDays ?? 0;
    const insufficientData = guidance.status === 'insufficient';

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

            {insufficientData && (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 flex flex-col items-center justify-center text-center">
                    <CalendarRange className="w-10 h-10 text-gray-300 mb-3" />
                    <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">More campaign data needed</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Send Volume Impact unlocks when this range includes at least {minCampaignsRequired} campaigns across {minLookbackDaysRequired}+ days. Choose a longer range or upload more campaign history to view this analysis.
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                        Campaigns counted {guidance.sampleSize.toLocaleString()} · Range length {lookbackDaysInRange > 0 ? `${Math.round(lookbackDaysInRange)} days` : 'shorter than 90 days'}
                    </p>
                </div>
            )}
            {!insufficientData && (
                <>
                    {/* Metrics Grid: 3 cards (responsive layout) */}
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Correlation */}
                        <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
                            <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Pattern Strength</div>
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
                    {/* Action Note with Revenue Projection */}
                    <div className="mt-8 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recommendation</p>
                                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                    {guidance.message}
                                </p>

                                {guidance.dataContext.capped && (
                                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">
                                        Recommendation: For optimal accuracy, we recommend analyzing the last {guidance.dataContext.optimalCapDays} days based on your volume ({guidance.dataContext.isHighVolume ? 'High' : 'Standard'} Volume Sender).
                                    </p>
                                )}                                {/* Revenue Opportunity Projection */}
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
                </>
            )}
        </div>
    );
}
