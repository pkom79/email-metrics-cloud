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
    const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; volume: number; revenue: number; name: string } | null>(null);
    
    // Call V2 algorithm - campaigns only, date-range sensitive
    const guidance = useMemo(
        () => sendVolumeGuidanceV2(dateRange, customFrom, customTo),
        [dateRange, customFrom, customTo]
    );    // Get campaign data for chart - respects date range
    const chartData = useMemo(() => {
        const campaigns = dm.getCampaigns();
        if (!campaigns.length) return [];

        // Parse the user's selected date range using last data date as reference
        const lastDataDate = dm.getLastEmailDate();
        const { fromDate, toDate } = (() => {
            if (dateRange === 'custom' && customFrom && customTo) {
                return { fromDate: new Date(customFrom), toDate: new Date(customTo) };
            }
            const days = parseInt(dateRange.replace('d', '')) || 90;
            const to = new Date(lastDataDate);
            const from = new Date(to);
            from.setDate(from.getDate() - days);
            return { fromDate: from, toDate: to };
        })();

        // Filter campaigns in date range
        const filteredCampaigns = campaigns.filter(c => {
            const sentDate = new Date(c.sentDate);
            return sentDate >= fromDate && sentDate <= toDate && c.emailsSent >= 500;
        });

        if (filteredCampaigns.length === 0) return [];

        // Sort by volume and return individual campaigns (not grouped)
        return filteredCampaigns
            .map((c: any) => ({
                volume: c.emailsSent,
                revenue: c.revenue,
                name: c.name || c.subject || 'Campaign'
            }))
            .sort((a, b) => b.volume - a.volume); // Highest to lowest
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

            {/* Volume vs Revenue Chart - Full Width with Y-axis */}
            {chartData.length > 0 && (
                <div className="mt-6 relative">
                    <svg width="100%" height="280" viewBox="0 0 900 280" className="block" style={{ minHeight: '280px' }}>
                        <defs>
                            <linearGradient id="volume-gradient-blue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.05" />
                            </linearGradient>
                        </defs>
                        
                        {(() => {
                            if (chartData.length < 2) return null;
                            
                            const PAD_L = 70;
                            const PAD_R = 20;
                            const PAD_T = 20;
                            const PAD_B = 60;
                            const WIDTH = 900 - PAD_L - PAD_R;
                            const HEIGHT = 280 - PAD_T - PAD_B;
                            
                            const maxRevenue = Math.max(...chartData.map(d => d.revenue), 1);
                            const maxVolume = Math.max(...chartData.map(d => d.volume), 1);
                            
                            // Scale functions
                            const xScale = (i: number) => PAD_L + (i / (chartData.length - 1)) * WIDTH;
                            const yRevenue = (v: number) => PAD_T + HEIGHT - (v / maxRevenue) * HEIGHT;
                            const yVolume = (v: number) => PAD_T + HEIGHT - (v / maxVolume) * HEIGHT;
                            
                            // Create data points
                            const points = chartData.map((d, i) => ({
                                x: xScale(i),
                                yRevenue: yRevenue(d.revenue),
                                yVolume: yVolume(d.volume),
                                volume: d.volume,
                                revenue: d.revenue,
                                name: d.name
                            }));
                            
                            // Volume area path
                            const volumeArea = [
                                `M ${PAD_L} ${PAD_T + HEIGHT}`,
                                ...points.map(p => `L ${p.x} ${p.yVolume}`),
                                `L ${points[points.length - 1].x} ${PAD_T + HEIGHT}`,
                                'Z'
                            ].join(' ');
                            
                            // Revenue line path (smooth)
                            const revenuePts = points.map(p => ({ x: p.x, y: p.yRevenue }));
                            const revenuePath = catmullRom2bezier(revenuePts, PAD_T, PAD_T + HEIGHT);
                            
                            // Y-axis ticks for revenue
                            const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
                                value: maxRevenue * t,
                                y: PAD_T + HEIGHT - (HEIGHT * t)
                            }));
                            
                            return (
                                <>
                                    {/* Y-axis line */}
                                    <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + HEIGHT} stroke="#9CA3AF" strokeWidth="1" />
                                    
                                    {/* Y-axis labels (Revenue) */}
                                    {yTicks.map((tick, i) => (
                                        <g key={i}>
                                            <line x1={PAD_L - 5} y1={tick.y} x2={PAD_L} y2={tick.y} stroke="#9CA3AF" strokeWidth="1" />
                                            <text x={PAD_L - 8} y={tick.y + 4} textAnchor="end" fontSize="11" className="fill-gray-600 dark:fill-gray-400">
                                                {fmtCurrency(tick.value)}
                                            </text>
                                        </g>
                                    ))}
                                    
                                    {/* X-axis baseline */}
                                    <line x1={PAD_L} y1={PAD_T + HEIGHT} x2={900 - PAD_R} y2={PAD_T + HEIGHT} stroke="#9CA3AF" strokeWidth="1" />
                                    
                                    {/* Volume shaded area (blue) */}
                                    <path d={volumeArea} fill="url(#volume-gradient-blue)" />
                                    
                                    {/* Revenue line (blue, thicker) */}
                                    <path d={revenuePath} fill="none" stroke="#3B82F6" strokeWidth="2.5" />
                                    
                                    {/* X-axis volume labels */}
                                    {[0, Math.floor(chartData.length / 4), Math.floor(chartData.length / 2), Math.floor(chartData.length * 3 / 4), chartData.length - 1].map((idx, i) => {
                                        if (idx >= chartData.length) return null;
                                        const x = PAD_L + (idx / (chartData.length - 1)) * WIDTH;
                                        const vol = chartData[idx].volume;
                                        return (
                                            <text key={i} x={x} y={PAD_T + HEIGHT + 20} textAnchor="middle" fontSize="11" className="fill-gray-600 dark:fill-gray-400">
                                                {vol >= 1000 ? Math.round(vol / 1000) + 'k' : vol}
                                            </text>
                                        );
                                    })}
                                    
                                    {/* Interactive hover areas */}
                                    {points.map((p, i) => (
                                        <g key={i}>
                                            <circle
                                                cx={p.x}
                                                cy={p.yRevenue}
                                                r="6"
                                                fill="transparent"
                                                className="cursor-pointer"
                                                onMouseEnter={() => {
                                                    setHoveredPoint({
                                                        x: p.x,
                                                        y: p.yRevenue,
                                                        volume: p.volume,
                                                        revenue: p.revenue,
                                                        name: p.name
                                                    });
                                                }}
                                                onMouseLeave={() => setHoveredPoint(null)}
                                            />
                                            <circle
                                                cx={p.x}
                                                cy={p.yRevenue}
                                                r="3"
                                                fill="#3B82F6"
                                                className="pointer-events-none"
                                                style={{ opacity: hoveredPoint?.x === p.x ? 1 : 0 }}
                                            />
                                        </g>
                                    ))}
                                    
                                    {/* X-axis label */}
                                    <text x={PAD_L + WIDTH / 2} y={280 - 10} textAnchor="middle" fontSize="12" className="fill-gray-600 dark:fill-gray-400 font-medium">
                                        Send Volume (Highest → Lowest)
                                    </text>
                                    
                                    {/* Y-axis label */}
                                    <text x={20} y={PAD_T + HEIGHT / 2} textAnchor="middle" fontSize="12" className="fill-gray-600 dark:fill-gray-400 font-medium" transform={`rotate(-90 20 ${PAD_T + HEIGHT / 2})`}>
                                        Revenue
                                    </text>
                                </>
                            );
                        })()}
                    </svg>
                    
                    {/* Tooltip */}
                    {hoveredPoint && (
                        <div
                            className="absolute z-50 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none whitespace-nowrap"
                            style={{
                                left: `${(hoveredPoint.x / 900) * 100}%`,
                                top: `${(hoveredPoint.y / 280) * 100}%`,
                                transform: 'translate(-50%, -120%)'
                            }}
                        >
                            <div className="font-semibold mb-1">{hoveredPoint.name}</div>
                            <div>Volume: {hoveredPoint.volume.toLocaleString()}</div>
                            <div>Revenue: {fmtCurrency(hoveredPoint.revenue)}</div>
                        </div>
                    )}
                    
                    {/* Legend */}
                    <div className="mt-3 px-2 text-xs text-gray-500 dark:text-gray-500 flex items-center justify-center gap-4">
                        <span className="inline-flex items-center gap-1">
                            <span className="w-3 h-3 bg-blue-200 dark:bg-blue-800 rounded-sm"></span>
                            Volume (shaded) 
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <span className="w-3 h-0.5 bg-blue-500 rounded"></span>
                            Revenue (line)
                        </span>
                    </div>
                </div>
            )}            {/* Metrics Grid: 3 cards (responsive layout) */}
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
