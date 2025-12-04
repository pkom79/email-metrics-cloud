"use client";
import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { sendVolumeGuidanceV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import type { SendVolumeGuidanceResultV2, SendVolumeStatusV2 } from '../../lib/analytics/sendVolumeGuidanceV2';

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
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(v);

export default function SendVolumeImpact({ dateRange, granularity, customFrom, customTo }: Props) {
    // Call V2 algorithm - campaigns only, date-range sensitive
    const guidance = useMemo(
        () => sendVolumeGuidanceV2(dateRange, customFrom, customTo),
        [dateRange, customFrom, customTo]
    );

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
                                        <span className="font-semibold">How:</span> Pearson correlation between campaign volume and total revenue (campaigns only, 12+ sends required, 90+ days minimum).
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

            {/* Metrics Grid */}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3 text-[11px]">
                {/* Sample Size */}
                <div
                    className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between"
                    title="Number of qualified campaigns analyzed (>= 500 recipients, excluding last 72 hours)."
                >
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Campaigns Analyzed</div>
                    <div className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                        {guidance.sampleSize}
                    </div>
                </div>

                {/* Average Spam Rate */}
                <div
                    className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between"
                    title="Average spam complaint rate across analyzed campaigns."
                >
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Avg Spam Rate</div>
                    <div className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                        {guidance.avgSpamRate.toFixed(3)}%
                    </div>
                </div>

                {/* Average Bounce Rate */}
                <div
                    className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between"
                    title="Average bounce rate across analyzed campaigns."
                >
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Avg Bounce Rate</div>
                    <div className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                        {guidance.avgBounceRate.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* Action Note */}
            <div className="mt-8 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campaign Action Note</p>
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{guidance.message}</p>
                        
                        {/* Data Context */}
                        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                            <div>Lookback: {guidance.dataContext.lookbackDays} days</div>
                            {guidance.correlationCoefficient !== null && (
                                <div>Correlation: {guidance.correlationCoefficient.toFixed(3)}</div>
                            )}
                            {!guidance.dataContext.hasVariance && (
                                <div>Variance: {guidance.dataContext.variancePercent.toFixed(1)}% (too low for analysis)</div>
                            )}
                        </div>
                    </div>

                    {/* Badge(s) */}
                    <div className="flex flex-wrap gap-2 self-start">
                        <span
                            className={`px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${
                                STATUS_BADGE_CLASSES[guidance.status]
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
