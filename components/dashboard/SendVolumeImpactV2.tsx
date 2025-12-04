"use client";
import React, { useMemo, useState, useCallback } from 'react';
import { Activity, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { sendVolumeGuidanceV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import type { SendVolumeGuidanceResultV2, SendVolumeStatusV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import { DataManager } from '../../lib/data/dataManager';
import dayjs from '../../lib/dayjs';

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

// Catmull-Rom to Bezier spline for smooth curves
function catmullRom2bezier(points: { x: number, y: number }[], yMin?: number, yMax?: number) {
    if (points.length < 2) return '';
    const d: string[] = [];
    d.push(`M${points[0].x} ${points[0].y}`);
    const clamp = (v: number) => {
        if (typeof yMin === 'number' && v < yMin) return yMin;
        if (typeof yMax === 'number' && v > yMax) return yMax;
        return v;
    };
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = clamp(p1.y + (p2.y - p0.y) / 6);
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = clamp(p2.y - (p3.y - p1.y) / 6);
        d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
    }
    return d.join(' ');
}

export default function SendVolumeImpact({ dateRange, granularity, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; volume: number; revenue: number; name: string } | null>(null);

    // Call V2 algorithm - campaigns only, date-range sensitive
    const [showDebug, setShowDebug] = useState(false);

    const guidance = useMemo(
        () => sendVolumeGuidanceV2(dateRange, customFrom, customTo),
        [dateRange, customFrom, customTo]
    );    // Store date range for display in debug section
    const [debugDateRange, setDebugDateRange] = useState<{ from: string; to: string; lastDataDate: string } | null>(null);

    // Get campaign data for chart - use all campaigns that passed the algorithm filter
    const chartData = useMemo(() => {
        const campaigns = dm.getCampaigns();
        if (!campaigns.length) return [];

        // Calculate actual last date from campaigns in memory
        const actualLastDate = campaigns.length > 0
            ? dayjs(Math.max(...campaigns.map(c => new Date(c.sentDate).getTime())))
            : dayjs();

        // Parse the user's selected date range using last data date as reference
        // MUST match the exact logic in sendVolumeGuidanceV2.ts
        const { fromDate, toDate } = (() => {
            if (dateRange === 'custom' && customFrom && customTo) {
                return { fromDate: dayjs(customFrom), toDate: dayjs(customTo) };
            }
            // For preset ranges, need to compute from actual last email date
            // Use actualLastDate (max campaign date) to match sendVolumeGuidanceV2.ts
            const lastDataDate = actualLastDate;
            const ranges: Record<string, { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs }> = {
                "7d": { fromDate: lastDataDate.subtract(7, "days"), toDate: lastDataDate },
                "14d": { fromDate: lastDataDate.subtract(14, "days"), toDate: lastDataDate },
                "30d": { fromDate: lastDataDate.subtract(30, "days"), toDate: lastDataDate },
                "60d": { fromDate: lastDataDate.subtract(60, "days"), toDate: lastDataDate },
                "90d": { fromDate: lastDataDate.subtract(90, "days"), toDate: lastDataDate },
                "180d": { fromDate: lastDataDate.subtract(180, "days"), toDate: lastDataDate },
                "365d": { fromDate: lastDataDate.subtract(365, "days"), toDate: lastDataDate },
                "730d": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
                "all": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
            };
            return ranges[dateRange] || ranges["90d"];
        })();

        // Store for debug display
        setDebugDateRange({
            from: fromDate.format('MMM D, YYYY'),
            to: toDate.format('MMM D, YYYY'),
            lastDataDate: actualLastDate.format('MMM D, YYYY')
        });

        // Filter campaigns in date range - EXACT SAME LOGIC AS ALGORITHM
        const filteredCampaigns = campaigns.filter(c => {
            const sentDate = dayjs(c.sentDate);
            return (sentDate.isAfter(fromDate) || sentDate.isSame(fromDate, 'day')) &&
                (sentDate.isBefore(toDate) || sentDate.isSame(toDate, 'day')) &&
                c.emailsSent >= 500;
        });

        if (filteredCampaigns.length === 0) return [];

        // Sort by volume descending (highest to lowest) - THIS IS THE POINT OF THE MODULE
        return filteredCampaigns
            .map(c => ({
                id: c.id,
                campaignName: c.campaignName,
                volume: c.emailsSent,
                revenue: c.revenue,
                sentDate: c.sentDate
            }))
            .sort((a, b) => b.volume - a.volume);
    }, [dm, dateRange, customFrom, customTo]);

    // Calculate monthly revenue for projections
    const monthlyRevenue = useMemo(() => {
        const campaigns = dm.getCampaigns();
        const totalRevenue = campaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
        // Estimate monthly from available data
        const daysCovered = guidance.dataContext.lookbackDays || 90;
        return (totalRevenue / daysCovered) * 30;
    }, [dm, guidance.dataContext.lookbackDays]);

    // Calculate revenue opportunity projection for "Send More" status
    const revenueProjection = useMemo(() => {
        if (guidance.status !== 'send-more' || !guidance.correlationCoefficient) return null;

        const r = guidance.correlationCoefficient;
        let efficiency: number;
        let tier: string;

        // Tiered efficiency based on correlation strength
        if (r >= 0.4) {
            efficiency = 0.85;
            tier = 'Strong';
        } else if (r >= 0.3) {
            efficiency = 0.80;
            tier = 'Moderate';
        } else if (r >= 0.2) {
            efficiency = 0.70;
            tier = 'Weak';
        } else {
            return null; // Below threshold
        }

        const volumeIncrease = 0.20; // 20% volume increase
        const projectedLift = volumeIncrease * efficiency;
        const projectedIncrease = monthlyRevenue * projectedLift;

        return {
            amount: projectedIncrease,
            percentage: projectedLift * 100,
            tier,
            efficiency: efficiency * 100
        };
    }, [guidance.status, guidance.correlationCoefficient, monthlyRevenue]);

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
        const abs = Math.abs(r);
        if (abs < 0.1) return 'Negligible';
        if (abs < 0.3) return 'Weak';
        if (abs < 0.5) return 'Moderate';
        if (abs < 0.7) return 'Strong';
        return 'Very Strong';
    };

    const getCorrelationColor = (r: number | null) => {
        if (r === null) return 'text-gray-600 dark:text-gray-400';
        if (r > 0.05) return 'text-emerald-600 dark:text-emerald-400';
        if (r < -0.05) return 'text-rose-600 dark:text-rose-400';
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

            {/* Metrics Grid: 3 cards (responsive layout) */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Correlation */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Correlation</div>
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
                        Campaigns Included ({chartData.length})
                    </span>
                    {showDebug ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                </button>

                {showDebug && (
                    <div className="border-t border-gray-200 dark:border-gray-700 p-4 max-h-96 overflow-y-auto">
                        {/* Date Range Info */}
                        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">
                            <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Date Range Filter (ACTUAL):</div>
                            {debugDateRange && (
                                <div className="space-y-1 text-gray-600 dark:text-gray-400">
                                    <div>
                                        <span className="font-medium">Last Data Date:</span> {debugDateRange.lastDataDate}
                                    </div>
                                    <div>
                                        <span className="font-medium">From:</span> {debugDateRange.from}
                                    </div>
                                    <div>
                                        <span className="font-medium">To:</span> {debugDateRange.to}
                                    </div>
                                    <div>
                                        <span className="font-medium">Filter Type:</span> {dateRange === 'custom' ? 'Custom Range' : `Last ${dateRange}`}
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600">
                                        <span className="font-medium">Campaigns Found:</span> {chartData.length} matching filter criteria (≥500 emails sent)
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            {chartData.map((c, idx) => (
                                <div key={c.id} className="text-xs border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
                                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                                        {idx + 1}. {c.campaignName}
                                    </div>
                                    <div className="mt-1 space-y-1 text-gray-600 dark:text-gray-400">
                                        <div>
                                            <span className="font-medium">Campaign ID:</span> {c.id}
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <span className="font-medium">Date:</span> {dayjs(c.sentDate).format('MMM D, YYYY')}
                                            </div>
                                            <div>
                                                <span className="font-medium">Emails:</span> {c.volume.toLocaleString()}
                                            </div>
                                            <div>
                                                <span className="font-medium">Revenue:</span> {fmtCurrency(c.revenue)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {chartData.length === 0 && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
                                    No campaigns found in selected date range
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
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campaign Action Note</p>
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            {guidance.message}
                            {guidance.sampleSize > 0 && (
                                <span className="text-gray-500 dark:text-gray-500"> (Based on {guidance.sampleSize} campaign{guidance.sampleSize !== 1 ? 's' : ''})</span>
                            )}
                        </p>

                        {/* Revenue Opportunity Projection */}
                        {revenueProjection && (
                            <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                                <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
                                    Revenue Opportunity Projection
                                </div>
                                <div className="text-sm text-emerald-800 dark:text-emerald-200">
                                    Increasing volume by 20% could generate an additional{' '}
                                    <span className="font-bold">{fmtCurrency(revenueProjection.amount)}</span>
                                    {' '}per month ({revenueProjection.percentage.toFixed(0)}% lift).
                                </div>
                                <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                                    Based on {revenueProjection.tier} correlation (r = {guidance.correlationCoefficient?.toFixed(3)})
                                    with {revenueProjection.efficiency.toFixed(0)}% efficiency factor.
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
