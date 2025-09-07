"use client";
import React, { useMemo, useState } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';
import { buildWeeklyAggregatesInRange, buildMonthlyAggregatesInRange, computeReliability } from '../../lib/analytics/reliability';
import { ShieldCheck } from 'lucide-react';

interface Props {
    campaigns: ProcessedCampaign[];
    flows: ProcessedFlowEmail[];
    dateRange: string;
    granularity: 'daily' | 'weekly' | 'monthly';
}

const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

export default function RevenueReliabilityV2({ campaigns, flows, dateRange, granularity }: Props) {
    const [scope, setScope] = useState<'all' | 'campaigns' | 'flows'>('all');
    const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; revenue: number; label: string } | null>(null);

    // Check if the module should be visible
    const shouldShowModule = useMemo(() => {
        if (granularity === 'daily') {
            return false; // Hide for daily granularity
        }

        // Count complete periods
        const allDates = [...campaigns.map(c => c.sentDate.getTime()), ...flows.map(f => f.sentDate.getTime())].sort((a, b) => a - b);
        if (!allDates.length) return false;

        const maxDate = allDates.length ? new Date(allDates[allDates.length - 1]) : new Date();
        const startDate = (() => {
            if (dateRange === '365d') {
                const d = new Date(maxDate); d.setDate(d.getDate() - 364); return d;
            } else if (dateRange === 'all') {
                return allDates.length ? new Date(allDates[0]) : new Date(maxDate.getTime() - 364 * 24 * 3600 * 1000);
            } else if (dateRange === '90d') {
                const d = new Date(maxDate); d.setDate(d.getDate() - 89); return d;
            }
            // Handle other date ranges
            const days = parseInt(dateRange.replace('d', ''));
            if (!isNaN(days)) {
                const d = new Date(maxDate); d.setDate(d.getDate() - days + 1); return d;
            }
            return allDates.length ? new Date(allDates[0]) : new Date(maxDate.getTime() - 364 * 24 * 3600 * 1000);
        })();

        if (granularity === 'weekly') {
            const weeks = buildWeeklyAggregatesInRange(campaigns, flows, startDate, maxDate);
            const completeWeeks = weeks.filter(w => w.isCompleteWeek);
            return completeWeeks.length >= 4; // Need at least 4 complete weeks
        } else if (granularity === 'monthly') {
            const months = buildMonthlyAggregatesInRange(campaigns, flows, startDate, maxDate);
            const completeMonths = months.filter(m => m.isCompleteMonth);
            return completeMonths.length >= 4; // Need at least 4 complete months
        }

        return false;
    }, [campaigns, flows, dateRange, granularity]);

    // Get insufficient data message
    const insufficientDataMessage = useMemo(() => {
        if (granularity === 'daily') {
            return 'Revenue Reliability requires weekly or monthly granularity for meaningful analysis.';
        }
        if (granularity === 'weekly') {
            return 'Insufficient data: Need at least 4 complete weeks for reliability analysis.';
        }
        if (granularity === 'monthly') {
            return 'Insufficient data: Need at least 4 complete months for reliability analysis.';
        }
        return 'Insufficient data for reliability analysis.';
    }, [granularity]);

    // Derive date range bounds (assumes campaigns/flows arrays already filtered by parent for selected dateRange string)
    const allDates = [...campaigns.map(c => c.sentDate.getTime()), ...flows.map(f => f.sentDate.getTime())].sort((a, b) => a - b);
    const maxDate = allDates.length ? new Date(allDates[allDates.length - 1]) : new Date();
    const startDate = useMemo(() => {
        console.log(`📅 Revenue Reliability Date Range Debug:`);
        console.log(`  Selected dateRange: ${dateRange}`);
        console.log(`  Max date from data: ${maxDate.toISOString()}`);
        console.log(`  Total campaigns: ${campaigns.length}, Total flows: ${flows.length}`);

        if (dateRange === '365d') {
            const d = new Date(maxDate); d.setDate(d.getDate() - 364);
            console.log(`  365d range: ${d.toISOString()} to ${maxDate.toISOString()}`);
            return d;
        } else if (dateRange === 'all') {
            const result = allDates.length ? new Date(allDates[0]) : new Date(maxDate.getTime() - 364 * 24 * 3600 * 1000);
            console.log(`  'all' range: ${result.toISOString()} to ${maxDate.toISOString()}`);
            return result;
        } else if (dateRange === '90d') {
            const d = new Date(maxDate); d.setDate(d.getDate() - 89);
            console.log(`  90d range: ${d.toISOString()} to ${maxDate.toISOString()}`);
            return d;
        }
        // Handle other date ranges
        const days = parseInt(dateRange.replace('d', ''));
        if (!isNaN(days)) {
            const d = new Date(maxDate); d.setDate(d.getDate() - days + 1);
            console.log(`  ${days}d range: ${d.toISOString()} to ${maxDate.toISOString()}`);
            return d;
        }
        const fallback = allDates.length ? new Date(allDates[0]) : new Date(maxDate.getTime() - 364 * 24 * 3600 * 1000);
        console.log(`  Fallback range: ${fallback.toISOString()} to ${maxDate.toISOString()}`);
        return fallback;
    }, [dateRange, maxDate.getTime(), allDates.length]);

    // Use appropriate aggregation based on granularity
    const periods = useMemo(() => {
        console.log(`📊 Building ${granularity} periods from ${startDate.toISOString()} to ${maxDate.toISOString()}`);

        const campaignsToUse = scope === 'flows' ? [] : campaigns;
        const flowsToUse = scope === 'campaigns' ? [] : flows;

        console.log(`  Using ${campaignsToUse.length} campaigns, ${flowsToUse.length} flows for scope: ${scope}`);

        let result;
        if (granularity === 'monthly') {
            result = buildMonthlyAggregatesInRange(campaignsToUse, flowsToUse, startDate, maxDate);
        } else {
            // Default to weekly for 'weekly' granularity
            result = buildWeeklyAggregatesInRange(campaignsToUse, flowsToUse, startDate, maxDate);
        }

        console.log(`  Generated ${result.length} ${granularity} periods`);
        console.log(`  Period revenues:`, result.map(p => ({
            label: p.label,
            total: p.totalRevenue,
            campaign: p.campaignRevenue,
            flow: p.flowRevenue
        })));
        console.log(`  Raw revenue values:`, result.map(p => p.totalRevenue));

        // Additional debug for 180d issue - show non-zero periods
        const nonZeroPeriods = result.filter(p => p.totalRevenue > 0);
        if (nonZeroPeriods.length < result.length) {
            console.log(`  🚨 Found ${result.length - nonZeroPeriods.length} zero-revenue periods out of ${result.length} total`);
            console.log(`  Non-zero periods:`, nonZeroPeriods.map(p => ({
                label: p.label,
                total: p.totalRevenue,
                campaign: p.campaignRevenue,
                flow: p.flowRevenue
            })));

            // Show the exact non-zero period details
            if (nonZeroPeriods.length > 0) {
                console.log(`  💰 Revenue-bearing period: "${nonZeroPeriods[0].label}" = $${nonZeroPeriods[0].totalRevenue.toFixed(2)}`);
            }
        }

        return result;
    }, [campaigns, flows, scope, startDate, maxDate, granularity]);

    const result = useMemo(() => {
        const windowSize = granularity === 'monthly' ? 6 : 12; // 6 months or 12 weeks
        return computeReliability(periods, { scope, windowSize, minPeriods: 4 });
    }, [periods, scope, granularity]);

    // If we shouldn't show the module, display message
    if (!shouldShowModule) {
        return (
            <div className="mt-8">
                <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                    <div className="flex items-center justify-center py-8">
                        <div className="text-center">
                            <ShieldCheck className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                                Revenue Reliability
                            </h3>
                            <p className="text-gray-600 dark:text-gray-400 max-w-md">
                                {insufficientDataMessage}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!periods.length) return null;

    const reliability = result.reliability;
    const trend = result.trendDelta;
    const badgeColor = reliability == null ? 'bg-gray-300 text-gray-700' : reliability >= 80 ? 'bg-green-600 text-white' : reliability >= 65 ? 'bg-emerald-500 text-white' : reliability >= 50 ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white';

    // Chart geometry: full period periods (we keep all complete periods in range)
    const chartPoints = periods.filter(p => {
        return 'isCompleteWeek' in p ? p.isCompleteWeek : p.isCompleteMonth;
    });

    console.log(`📈 Chart Data Debug:`);
    console.log(`  Reliability result:`, { reliability: result.reliability, median: result.median, mad: result.mad });
    console.log(`  All periods: ${periods.length}, Complete periods: ${chartPoints.length}`);

    const revenues = chartPoints.map(p => scope === 'campaigns' ? p.campaignRevenue : scope === 'flows' ? p.flowRevenue : p.totalRevenue);
    console.log(`  Chart revenues for scope '${scope}':`, revenues);

    // Ensure chart doesn't go below 0 (fix negative revenue display bug)
    const maxRevenue = Math.max(...revenues.filter(r => r > 0), 1);
    const median = result.median || 0;
    const mad = result.mad || 0;

    console.log(`  Chart scale: max=${maxRevenue}, median=${median}, mad=${mad}`);

    const VIEW_W = 850; const VIEW_H = 190; const GRAPH_H = 130; const PAD_L = 50; const PAD_R = 16;
    const innerW = VIEW_W - PAD_L - PAD_R;
    const xScale = (i: number) => chartPoints.length <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (chartPoints.length - 1)) * innerW;
    const yScale = (rev: number) => GRAPH_H - (Math.max(0, rev) / maxRevenue) * (GRAPH_H - 10); // Clamp to 0 minimum

    // Simple polyline connecting actual points (no smoothing, no fabricated zeros except real zero periods)
    const linePts = chartPoints.map((p, i) => ({ x: xScale(i), y: yScale(revenues[i]) }));
    const linePath = linePts.length ? 'M' + linePts.map(p => `${p.x},${p.y}`).join(' L') : '';

    // Median + band (MAD) shading
    const medianY = median > 0 ? yScale(median) : null;
    const upperBandY = (median > 0 && mad > 0) ? yScale(Math.min(median + mad, maxRevenue)) : null;
    const lowerBandY = (median > 0 && mad > 0) ? yScale(Math.max(median - mad, 0)) : null;
    const showBand = upperBandY != null && lowerBandY != null && Math.abs(lowerBandY - upperBandY) > 2;

    console.log(`  MAD band coordinates: median=${medianY}, upper=${upperBandY}, lower=${lowerBandY}, show=${showBand}`);

    // Dynamic labels based on granularity
    const periodLabel = granularity === 'monthly' ? 'Monthly' : 'Weekly';
    const zeroPeriodsLabel = granularity === 'monthly' ? 'Zero Campaign Months' : 'Zero Campaign Weeks';

    const tiles = [
        { label: `Median ${periodLabel} Rev`, value: result.median ? formatCurrency(result.median) : '—' },
        { label: 'Dispersion (MAD)', value: result.mad ? formatCurrency(result.mad) : '—' },
    ];
    if ((scope === 'campaigns' || scope === 'all') && result.zeroCampaignWeeks && result.zeroCampaignWeeks > 0) {
        tiles.push({ label: zeroPeriodsLabel, value: String(result.zeroCampaignWeeks) });
        if (result.estLostCampaignRevenue) tiles.push({ label: 'Est. Lost Campaign Rev', value: formatCurrency(result.estLostCampaignRevenue) });
    }

    const scopeColor = scope === 'campaigns' ? '#6366F1' : scope === 'flows' ? '#10B981' : '#8B5CF6';
    const bandColorClass = scope === 'campaigns' ? 'fill-blue-500/10' : scope === 'flows' ? 'fill-emerald-500/10' : 'fill-purple-500/10';
    return (
        <div className="mt-8">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5" style={{ color: scopeColor }} />
                        <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            Revenue Reliability
                            <button aria-label="Reliability definition" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xs">ⓘ</button>
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden text-xs font-medium">
                            {['all', 'campaigns', 'flows'].map(opt => (
                                <button key={opt} onClick={() => setScope(opt as any)} className={`px-3 py-1.5 ${scope === opt ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-300'}`}>{opt === 'all' ? 'All' : opt === 'campaigns' ? 'Campaigns' : 'Flows'}</button>
                            ))}
                        </div>
                    </div>
                </div>
                {/* Chart */}
                <div className="relative w-full overflow-hidden">
                    <svg width="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block select-none">
                        <defs>
                            <linearGradient id="rr-area" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
                            </linearGradient>
                        </defs>
                        {/* Y grid (3 lines) */}
                        {[0.25, 0.5, 0.75].map((p, i) => {
                            const y = yScale(maxRevenue * p);
                            return <line key={i} x1={PAD_L} x2={VIEW_W - PAD_R} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="2 2" />
                        })}
                        {/* MAD band only (no area fill) */}
                        {showBand && upperBandY != null && lowerBandY != null && (
                            <rect x={PAD_L} y={upperBandY} width={innerW} height={Math.max(2, lowerBandY - upperBandY)} className={bandColorClass} />
                        )}
                        {/* Line */}
                        {linePath && <path d={linePath} fill="none" stroke={scopeColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

                        {/* Interactive dots for hover - invisible but functional */}
                        {linePts.map((pt, i) => (
                            <circle
                                key={i}
                                cx={pt.x}
                                cy={pt.y}
                                r={6}
                                fill="transparent"
                                className="cursor-pointer"
                                onMouseEnter={() => setHoveredPoint({
                                    x: pt.x,
                                    y: pt.y,
                                    revenue: revenues[i],
                                    label: chartPoints[i].label
                                })}
                                onMouseLeave={() => setHoveredPoint(null)}
                            />
                        ))}

                        {/* Tooltip */}
                        {hoveredPoint && (
                            <g>
                                <rect
                                    x={hoveredPoint.x - 50}
                                    y={hoveredPoint.y - 40}
                                    width={100}
                                    height={30}
                                    fill="rgba(0, 0, 0, 0.8)"
                                    rx={4}
                                />
                                <text
                                    x={hoveredPoint.x}
                                    y={hoveredPoint.y - 30}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill="white"
                                    className="font-medium"
                                >
                                    {hoveredPoint.label}
                                </text>
                                <text
                                    x={hoveredPoint.x}
                                    y={hoveredPoint.y - 18}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill="white"
                                    className="tabular-nums"
                                >
                                    {formatCurrency(hoveredPoint.revenue)}
                                </text>
                            </g>
                        )}

                        {/* Median line */}
                        {medianY != null && <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={medianY} y2={medianY} stroke="#9ca3af" strokeDasharray="4 3" />}
                        {/* X labels (max 6) */}
                        {(() => {
                            const count = Math.min(6, chartPoints.length);
                            const els: React.ReactElement[] = [];
                            for (let i = 0; i < count; i++) { const idx = Math.round((i / (count - 1)) * (chartPoints.length - 1)); const w = chartPoints[idx]; const x = xScale(idx) - 30; els.push(<text key={i} x={x} y={GRAPH_H + 35} textAnchor="start" fontSize={11} fill="#6b7280">{w.label}</text>); }
                            return els;
                        })()}
                        {/* Revenue axis ticks (left) */}
                        {[0, 0.5, 1].map((p, i) => { const val = maxRevenue * p; const y = yScale(val); return <text key={i} x={PAD_L - 6} y={y + 4} fontSize={11} textAnchor="end" fill="#6b7280" className="tabular-nums">{val >= 1000 ? '$' + (val / 1000).toFixed(1) + 'k' : '$' + val.toFixed(0)}</text>; })}
                    </svg>
                </div>
                {/* Stat tiles */}
                <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 relative">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1 flex justify-between items-center">
                            Reliability
                            <span className="text-[10px] font-normal text-gray-400">
                                {result.windowWeeks}{granularity === 'monthly' ? 'm' : 'w'}
                            </span>
                        </p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums flex items-center gap-2">
                            {reliability !== null ? reliability + '%' : '—'}
                            {result.trendDelta !== null && (
                                <span className={`text-xs font-medium ${result.trendDelta > 0 ? 'text-green-600 dark:text-green-400' : result.trendDelta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500'}`}>{result.trendDelta > 0 ? '▲' : '▼'}{Math.abs(result.trendDelta)}</span>
                            )}
                        </p>
                    </div>
                    {tiles.map(t => (
                        <div key={t.label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">{t.label}</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{t.value}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
