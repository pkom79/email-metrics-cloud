"use client";
import React, { useMemo, useState, useCallback } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { sendVolumeGuidanceV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import type { SendVolumeGuidanceResultV2, SendVolumeStatusV2 } from '../../lib/analytics/sendVolumeGuidanceV2';
import { DataManager } from '../../lib/data/dataManager';

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
    
    // Call V2 algorithm - campaigns only, date-range sensitive
    const guidance = useMemo(
        () => sendVolumeGuidanceV2(dateRange, customFrom, customTo),
        [dateRange, customFrom, customTo]
    );

    // Get campaign data for chart
    const chartData = useMemo(() => {
        const campaigns = dm.getCampaigns();
        if (!campaigns.length) return [];
        
        // Group by week and calculate averages
        const weekMap = new Map<string, { volumes: number[], revenues: number[] }>();
        
        campaigns.forEach(c => {
            if (c.emailsSent < 500) return; // Apply same filter as algorithm
            const weekKey = new Date(c.sentDate).toISOString().slice(0, 10); // Use date as key
            if (!weekMap.has(weekKey)) {
                weekMap.set(weekKey, { volumes: [], revenues: [] });
            }
            const week = weekMap.get(weekKey)!;
            week.volumes.push(c.emailsSent);
            week.revenues.push(c.revenue);
        });
        
        // Calculate weekly averages and sort by volume
        const data = Array.from(weekMap.values())
            .map(week => ({
                avgVolume: week.volumes.reduce((a, b) => a + b, 0) / week.volumes.length,
                avgRevenue: week.revenues.reduce((a, b) => a + b, 0) / week.revenues.length
            }))
            .sort((a, b) => b.avgVolume - a.avgVolume); // Sort highest to lowest
        
        return data;
    }, [dm]);

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

            {/* Volume vs Revenue Chart */}
            {chartData.length > 0 && (
                <div className="mt-6 relative" style={{ width: '100%', height: '160px' }}>
                    <svg width="100%" height="160" viewBox="0 0 900 160" className="block">
                        <defs>
                            <linearGradient id="volume-gradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#6366F1" stopOpacity="0.2" />
                                <stop offset="100%" stopColor="#6366F1" stopOpacity="0.05" />
                            </linearGradient>
                        </defs>
                        
                        {/* Render chart with volume on X-axis (high to low) and avg weekly revenue on Y-axis */}
                        {(() => {
                            const VIEW_W = 900;
                            const VIEW_H = 160;
                            const GRAPH_H = 120;
                            const PAD_L = 60;
                            const PAD_R = 40;
                            const innerW = VIEW_W - PAD_L - PAD_R;
                            
                            const maxRevenue = Math.max(...chartData.map(d => d.avgRevenue), 1);
                            const maxVolume = Math.max(...chartData.map(d => d.avgVolume), 1);
                            
                            const xScale = (i: number) => PAD_L + (i / (chartData.length - 1)) * innerW;
                            const yRevenue = (v: number) => GRAPH_H - (v / maxRevenue) * (GRAPH_H - 10);
                            
                            const revenuePts = chartData.map((d, i) => ({
                                x: xScale(i),
                                y: Math.max(10, Math.min(GRAPH_H, yRevenue(d.avgRevenue)))
                            }));
                            
                            const revenuePath = catmullRom2bezier(revenuePts, 10, GRAPH_H);
                            
                            // X-axis labels (volume)
                            const xLabels = [0, Math.floor(chartData.length / 2), chartData.length - 1]
                                .filter(i => i < chartData.length)
                                .map(i => ({
                                    x: xScale(i),
                                    label: `${Math.round(chartData[i].avgVolume / 1000)}k`
                                }));
                            
                            // Y-axis labels (revenue)
                            const yTicks = [
                                { val: maxRevenue, y: 10 },
                                { val: maxRevenue / 2, y: (GRAPH_H + 10) / 2 },
                                { val: 0, y: GRAPH_H }
                            ];
                            
                            return (
                                <>
                                    {/* Y-axis labels */}
                                    {yTicks.map((t, i) => (
                                        <text key={i} x={PAD_L - 8} y={t.y + 4} textAnchor="end" fontSize={11} className="fill-gray-600 dark:fill-gray-400">
                                            {fmtCurrency(t.val)}
                                        </text>
                                    ))}
                                    
                                    {/* Baseline */}
                                    <line x1={PAD_L} y1={GRAPH_H} x2={VIEW_W - PAD_R} y2={GRAPH_H} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />
                                    
                                    {/* Revenue line */}
                                    <path d={revenuePath} fill="none" stroke="#6366F1" strokeWidth={2.5} />
                                    
                                    {/* X-axis labels */}
                                    {xLabels.map((t, i) => (
                                        <text key={i} x={t.x} y={GRAPH_H + 20} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'} fontSize={11} className="fill-gray-600 dark:fill-gray-400">
                                            {t.label}
                                        </text>
                                    ))}
                                    <text x={PAD_L} y={GRAPH_H + 35} textAnchor="start" fontSize={10} className="font-medium fill-gray-600 dark:fill-gray-400">
                                        Send Volume (Highest → Lowest)
                                    </text>
                                </>
                            );
                        })()}
                    </svg>
                </div>
            )}

            {/* Metrics Grid: 4 cards (2x2 on mobile, 1x4 on desktop) */}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Correlation */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Correlation</div>
                    <div className={`text-2xl md:text-3xl font-semibold tabular-nums leading-none ${getCorrelationColor(guidance.correlationCoefficient)}`}>
                        {guidance.correlationCoefficient !== null ? guidance.correlationCoefficient.toFixed(3) : 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {getCorrelationLabel(guidance.correlationCoefficient)}
                    </div>
                </div>

                {/* Campaigns Analyzed */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Campaigns</div>
                    <div className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                        {guidance.sampleSize}
                    </div>
                </div>

                {/* Average Spam Rate with dot indicator */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${getRateDot(guidance.avgSpamRate, 'spam')}`}></span>
                        Avg Spam
                    </div>
                    <div className={`text-2xl md:text-3xl font-semibold tabular-nums leading-none ${getRateColor(guidance.avgSpamRate, 'spam')}`}>
                        {guidance.avgSpamRate.toFixed(3)}%
                    </div>
                </div>

                {/* Average Bounce Rate with dot indicator */}
                <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 flex flex-col justify-between">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${getRateDot(guidance.avgBounceRate, 'bounce')}`}></span>
                        Avg Bounce
                    </div>
                    <div className={`text-2xl md:text-3xl font-semibold tabular-nums leading-none ${getRateColor(guidance.avgBounceRate, 'bounce')}`}>
                        {guidance.avgBounceRate.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* Action Note with Revenue Projection */}
            <div className="mt-8 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campaign Action Note</p>
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{guidance.message}</p>
                        
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
