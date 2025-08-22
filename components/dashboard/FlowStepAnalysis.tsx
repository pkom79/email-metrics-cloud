"use client";
import React, { useState, useMemo } from 'react';
import { ChevronDown, Workflow, GitBranch, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

interface FlowStepAnalysisProps {
    dateRange: string;
    granularity: 'daily' | 'weekly' | 'monthly';
    customFrom?: string;
    customTo?: string;
}

interface FlowStepMetrics {
    sequencePosition: number;
    emailName: string;
    emailsSent: number;
    revenue: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    unsubscribeRate: number;
    avgOrderValue: number;
    dropOffRate: number;
    bounceRate: number;
    spamRate: number;
    revenuePerEmail: number;
    totalOrders: number;
    totalClicks: number;
}

export default function FlowStepAnalysis({ dateRange, granularity, customFrom, customTo }: FlowStepAnalysisProps) {
    const [tooltip] = useState<{
        chartIndex: number;
        x: number;
        y: number;
        value: number;
        date: string;
    } | null>(null);

    const metricOptions = [
        { value: 'revenue', label: 'Revenue', format: 'currency' },
        { value: 'emailsSent', label: 'Emails Sent', format: 'number' },
        { value: 'openRate', label: 'Open Rate', format: 'percentage' },
        { value: 'clickRate', label: 'Click Rate', format: 'percentage' },
        { value: 'clickToOpenRate', label: 'Click to Open Rate', format: 'percentage' },
        { value: 'conversionRate', label: 'Conversion Rate', format: 'percentage' },
        { value: 'unsubscribeRate', label: 'Unsubscribe Rate', format: 'percentage', isNegative: true },
        { value: 'bounceRate', label: 'Bounce Rate', format: 'percentage', isNegative: true },
        { value: 'spamRate', label: 'Spam Rate', format: 'percentage', isNegative: true },
        { value: 'avgOrderValue', label: 'Average Order Value', format: 'currency' },
        { value: 'revenuePerEmail', label: 'Revenue per Email', format: 'currency' },
        { value: 'totalOrders', label: 'Total Orders', format: 'number' }
    ] as const;

    const [selectedFlow, setSelectedFlow] = useState<string>('');
    const [selectedMetric, setSelectedMetric] = useState<string>('revenue');

    const dataManager = DataManager.getInstance();
    const ALL_FLOW_EMAILS = dataManager.getFlowEmails();

    const toDateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const dateWindows = useMemo(() => {
        let startDate: Date, endDate: Date;

        // Handle custom date range
        if (dateRange === 'custom' && customFrom && customTo) {
            startDate = new Date(customFrom + 'T00:00:00');
            endDate = new Date(customTo + 'T23:59:59');
        } else if (dateRange === 'all') {
            return null; // All time doesn't need windowing
        } else {
            // Preset ranges
            const days = parseInt(dateRange.replace('d', ''));
            endDate = toDateOnly(dataManager.getLastEmailDate());
            startDate = toDateOnly(new Date(endDate));
            startDate.setDate(endDate.getDate() - days);
        }

        // Calculate previous period for comparison
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const prevEndDate = toDateOnly(new Date(startDate));
        const prevStartDate = toDateOnly(new Date(prevEndDate));
        prevStartDate.setDate(prevEndDate.getDate() - daysDiff);

        return {
            startDateOnly: toDateOnly(startDate),
            endDateOnly: toDateOnly(endDate),
            prevStartDateOnly: prevStartDate,
            prevEndDateOnly: prevEndDate,
            days: daysDiff
        };
    }, [dateRange, customFrom, customTo, dataManager]);

    const liveFlowEmails = useMemo(() => ALL_FLOW_EMAILS.filter(e => e.status && e.status.toLowerCase() === 'live'), [ALL_FLOW_EMAILS]);

    const uniqueFlowNames = useMemo(() => {
        const names = new Set<string>();
        for (const e of liveFlowEmails) if (e.flowName) names.add(e.flowName);
        return Array.from(names).sort();
    }, [liveFlowEmails]);

    const currentFlowEmails = useMemo(() => {
        if (!dateWindows) return liveFlowEmails; // All time
        const { startDateOnly, endDateOnly } = dateWindows;
        return liveFlowEmails.filter(e => {
            const sent = new Date(e.sentDate);
            return sent >= startDateOnly && sent <= endDateOnly;
        });
    }, [liveFlowEmails, dateWindows]);

    const previousFlowEmails = useMemo(() => {
        if (!dateWindows) return []; // No comparison for all time
        const { prevStartDateOnly, prevEndDateOnly } = dateWindows;
        return liveFlowEmails.filter(e => {
            const sent = new Date(e.sentDate);
            return sent >= prevStartDateOnly && sent <= prevEndDateOnly;
        });
    }, [liveFlowEmails, dateWindows]);

    const flowSequenceInfo = useMemo(() => {
        if (!selectedFlow) return null;
        return dataManager.getFlowSequenceInfo(selectedFlow);
    }, [selectedFlow, dataManager]);

    const duplicateNameCounts = useMemo((): Record<string, number> => {
        const counts: Record<string, number> = {};
        const names = flowSequenceInfo?.emailNames || [];
        for (const raw of names) {
            const name = (raw || '').trim();
            if (!name) continue;
            counts[name] = (counts[name] || 0) + 1;
        }
        return counts;
    }, [flowSequenceInfo]);

    const hasDuplicateNames = useMemo(() => Object.values(duplicateNameCounts).some(c => c > 1), [duplicateNameCounts]);

    const flowStepMetrics = useMemo((): FlowStepMetrics[] => {
        if (!selectedFlow || !flowSequenceInfo) {
            console.log('No selected flow or sequence info');
            return [];
        }

        const flowEmails = currentFlowEmails.filter(email => email.flowName === selectedFlow);
        console.log(`Flow emails for ${selectedFlow}:`, flowEmails.length);

        if (flowEmails.length === 0) {
            console.warn(`No emails found for flow: ${selectedFlow}`);
            return [];
        }

        const stepMetrics: FlowStepMetrics[] = [];
        let previousEmailsSent = 0;

        flowSequenceInfo.messageIds.forEach((messageId, idx) => {
            let stepEmails = flowEmails.filter(email => email.flowMessageId === messageId);

            // Fallback: if no emails match messageId, try sequence position
            if (stepEmails.length === 0) {
                console.warn(`No emails for messageId ${messageId}, trying sequence position ${idx + 1}`);
                stepEmails = flowEmails.filter(email => email.sequencePosition === idx + 1);
            }

            // If still no emails, create empty step
            if (stepEmails.length === 0) {
                console.warn(`No emails found for step ${idx + 1} in flow ${selectedFlow}`);
                const emailName = flowSequenceInfo.emailNames[idx] || `Step ${idx + 1}`;
                stepMetrics.push({
                    sequencePosition: idx + 1,
                    emailName,
                    emailsSent: 0,
                    revenue: 0,
                    openRate: 0,
                    clickRate: 0,
                    clickToOpenRate: 0,
                    conversionRate: 0,
                    unsubscribeRate: 0,
                    avgOrderValue: 0,
                    dropOffRate: 0,
                    bounceRate: 0,
                    spamRate: 0,
                    revenuePerEmail: 0,
                    totalOrders: 0,
                    totalClicks: 0
                });
                return;
            }

            const sortedStepEmails = [...stepEmails].sort((a, b) => a.sentDate.getTime() - b.sentDate.getTime());
            const emailName = flowSequenceInfo.emailNames[idx] ||
                (sortedStepEmails.length > 0 ? sortedStepEmails[sortedStepEmails.length - 1].emailName : `Step ${idx + 1}`);

            // Calculate aggregated metrics for this step
            const totalEmailsSent = sortedStepEmails.reduce((sum, email) => sum + email.emailsSent, 0);
            const totalRevenue = sortedStepEmails.reduce((sum, email) => sum + email.revenue, 0);
            const totalOrders = sortedStepEmails.reduce((sum, email) => sum + email.totalOrders, 0);
            const totalOpens = sortedStepEmails.reduce((sum, email) => sum + email.uniqueOpens, 0);
            const totalClicks = sortedStepEmails.reduce((sum, email) => sum + email.uniqueClicks, 0);
            const totalUnsubscribes = sortedStepEmails.reduce((sum, email) => sum + email.unsubscribesCount, 0);
            const totalBounces = sortedStepEmails.reduce((sum, email) => sum + email.bouncesCount, 0);
            const totalSpam = sortedStepEmails.reduce((sum, email) => sum + email.spamComplaintsCount, 0);

            // Calculate rates
            const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
            const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
            const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
            const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
            const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubscribes / totalEmailsSent) * 100 : 0;
            const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;
            const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
            const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
            const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;

            // Calculate drop-off rate
            let dropOffRate = 0;
            if (idx > 0 && previousEmailsSent > 0) {
                dropOffRate = ((previousEmailsSent - totalEmailsSent) / previousEmailsSent) * 100;
            }

            stepMetrics.push({
                sequencePosition: idx + 1,
                emailName,
                emailsSent: totalEmailsSent,
                revenue: totalRevenue,
                openRate,
                clickRate,
                clickToOpenRate,
                conversionRate,
                unsubscribeRate,
                avgOrderValue,
                dropOffRate,
                bounceRate,
                spamRate,
                revenuePerEmail,
                totalOrders,
                totalClicks
            });

            previousEmailsSent = totalEmailsSent;
        });

        console.log(`Generated ${stepMetrics.length} step metrics for ${selectedFlow}`);
        return stepMetrics;
    }, [selectedFlow, currentFlowEmails, flowSequenceInfo]);

    const getStepSparklineData = React.useCallback((sequencePosition: number, metric: string) => {
        if (!selectedFlow) return [] as { value: number; date: string }[];
        const chartEmails = currentFlowEmails;
        return dataManager.getFlowStepTimeSeries(chartEmails, selectedFlow, sequencePosition, metric, dateRange, granularity, customFrom, customTo);
    }, [selectedFlow, currentFlowEmails, dataManager, dateRange, granularity, customFrom, customTo]);

    const sharedYAxisRange = useMemo(() => {
        if (!selectedFlow) return { min: 0, max: 10 };
        let allValues: number[] = [];
        for (let position = 1; flowSequenceInfo && position <= flowSequenceInfo.sequenceLength; position++) {
            const data = getStepSparklineData(position, selectedMetric);
            allValues = allValues.concat(data.map(d => d.value));
        }
        if (allValues.length === 0) return { min: 0, max: 10 };
        const minValue = Math.min(...allValues);
        const maxValue = Math.max(...allValues);
        let min = 0;
        let max = maxValue;
        if (maxValue - minValue < 0.01 || maxValue === 0) max = maxValue > 0 ? maxValue * 1.5 : 10; else max = maxValue * 1.2;
        const metricConfig = metricOptions.find(m => m.value === selectedMetric);
        if (metricConfig?.format === 'currency') {
            if (max > 10000) max = Math.ceil(max / 1000) * 1000;
            else if (max > 1000) max = Math.ceil(max / 100) * 100;
            else if (max > 100) max = Math.ceil(max / 10) * 10;
            else max = Math.ceil(max);
        } else if (metricConfig?.format === 'percentage') {
            if (max < 1) max = Math.ceil(max * 100) / 100;
            else if (max < 10) max = Math.ceil(max);
            else max = Math.ceil(max / 5) * 5;
        } else {
            if (max > 1000) max = Math.ceil(max / 100) * 100;
            else if (max > 100) max = Math.ceil(max / 10) * 10;
            else max = Math.ceil(max);
        }
        return { min, max };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFlow, selectedMetric, flowSequenceInfo, getStepSparklineData]);

    const getStepPeriodChange = (sequencePosition: number, metric: string): { change: number; isPositive: boolean; previousValue: number; previousPeriod: { startDate: Date; endDate: Date } } | null => {
        if (!selectedFlow || dateRange === 'all') return null;
        const currStepEmails = currentFlowEmails.filter(e => e.flowName === selectedFlow && e.sequencePosition === sequencePosition);
        const prevStepEmails = previousFlowEmails.filter(e => e.flowName === selectedFlow && e.sequencePosition === sequencePosition);
        if (currStepEmails.length === 0) return null;
        const totals = (emails: typeof currStepEmails) => emails.reduce((acc, e) => ({
            emailsSent: acc.emailsSent + (e.emailsSent || 0),
            revenue: acc.revenue + (e.revenue || 0),
            orders: acc.orders + (e.totalOrders || 0),
            opens: acc.opens + (e.uniqueOpens || 0),
            clicks: acc.clicks + (e.uniqueClicks || 0),
            unsubs: acc.unsubs + (e.unsubscribesCount || 0),
            bounces: acc.bounces + (e.bouncesCount || 0),
            spam: acc.spam + (e.spamComplaintsCount || 0),
        }), { emailsSent: 0, revenue: 0, orders: 0, opens: 0, clicks: 0, unsubs: 0, bounces: 0, spam: 0 });
        const calc = (emails: typeof currStepEmails) => {
            const t = totals(emails);
            switch (metric) {
                case 'revenue': return t.revenue;
                case 'emailsSent': return t.emailsSent;
                case 'totalOrders': return t.orders;
                case 'avgOrderValue': return t.orders > 0 ? t.revenue / t.orders : 0;
                case 'revenuePerEmail': return t.emailsSent > 0 ? t.revenue / t.emailsSent : 0;
                case 'openRate': return t.emailsSent > 0 ? (t.opens / t.emailsSent) * 100 : 0;
                case 'clickRate': return t.emailsSent > 0 ? (t.clicks / t.emailsSent) * 100 : 0;
                case 'clickToOpenRate': return t.opens > 0 ? (t.clicks / t.opens) * 100 : 0;
                case 'conversionRate': return t.clicks > 0 ? (t.orders / t.clicks) * 100 : 0;
                case 'unsubscribeRate': return t.emailsSent > 0 ? (t.unsubs / t.emailsSent) * 100 : 0;
                case 'bounceRate': return t.emailsSent > 0 ? (t.bounces / t.emailsSent) * 100 : 0;
                case 'spamRate': return t.emailsSent > 0 ? (t.spam / t.emailsSent) * 100 : 0;
                default: return 0;
            }
        };
        const currentValue = calc(currStepEmails);
        const previousValue = calc(prevStepEmails);
        if (prevStepEmails.length === 0 || previousValue === 0) return null;
        const change = ((currentValue - previousValue) / previousValue) * 100;

        // Match MetricCard zero change logic: exactly 0.0%
        const isZeroChange = Math.abs(change) < 0.01;

        let isPositive: boolean;
        if (isZeroChange) {
            isPositive = true; // Neutral for zero change
        } else {
            const isNegativeMetric = ['unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric);
            isPositive = isNegativeMetric ? change < 0 : change > 0;
        }

        const previousPeriod = { startDate: dateWindows!.prevStartDateOnly, endDate: dateWindows!.prevEndDateOnly };
        return { change, isPositive, previousValue, previousPeriod };
    };

    const formatMetricValue = (value: number, metric: string) => {
        const metricConfig = (metricOptions as any).find((m: any) => m.value === metric);
        if (!metricConfig) return value.toString();
        if (metricConfig.format === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        if (metricConfig.format === 'percentage') return `${(metric === 'spamRate' ? value.toFixed(3) : value.toFixed(2))}%`;
        if (metric === 'emailsSent' || metric === 'totalOrders') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    };

    const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const renderStepChart = (step: FlowStepMetrics, index: number) => {
        const sparklineData = getStepSparklineData(step.sequencePosition, selectedMetric);
        const periodChange = getStepPeriodChange(step.sequencePosition, selectedMetric);
        const metricConfig = (metricOptions as any).find((m: any) => m.value === selectedMetric);
        const value = step[selectedMetric as keyof FlowStepMetrics] as number;
        const yAxisRange = sharedYAxisRange;
        let chartColor = '#8b5cf6';
        let dotColor = chartColor;
        let changeNode: React.ReactNode = null;
        if (periodChange && dateRange !== 'all') {
            const isIncrease = periodChange.change > 0;
            const isGood = periodChange.isPositive;

            // Match MetricCard logic: exactly 0.0% change should be treated specially
            const isZeroChange = Math.abs(periodChange.change) < 0.01;

            let colorClass: string;
            if (isZeroChange) {
                colorClass = 'text-purple-600'; // Purple for zero change
            } else {
                colorClass = isGood ? 'text-green-600' : 'text-red-600';
            }

            const trendTooltip = `Previous period (${formatDate(periodChange.previousPeriod.startDate)} – ${formatDate(periodChange.previousPeriod.endDate)}): ${formatMetricValue(periodChange.previousValue, selectedMetric)}`;

            // Set chart colors based on change state
            if (isZeroChange) {
                chartColor = '#9333ea'; // Purple for zero change
            } else {
                chartColor = isGood ? '#10b981' : '#ef4444';
            }
            dotColor = chartColor;

            changeNode = (
                <span className={`text-lg font-bold px-2 py-1 rounded ${colorClass}`} title={trendTooltip} aria-label={trendTooltip}>
                    {!isZeroChange && (isIncrease ? (<ArrowUp className="inline w-4 h-4 mr-1" />) : (<ArrowDown className="inline w-4 h-4 mr-1" />))}
                    {Math.abs(periodChange.change).toFixed(1)}%
                </span>
            );
        }
        if (value === 0 && sparklineData.length === 0) { chartColor = '#9ca3af'; dotColor = chartColor; }
        const chartGradient = `linear-gradient(180deg, ${chartColor}40 0%, ${chartColor}10 100%)`;
        let xTicks: { x: number; label: string }[] = [];
        if (sparklineData.length > 1) {
            const tickCount = Math.min(6, sparklineData.length);
            for (let i = 0; i < tickCount; i++) { const idx = Math.round((i / (tickCount - 1)) * (sparklineData.length - 1)); const point = sparklineData[idx]; const x = (idx / (sparklineData.length - 1)) * 900; const label = new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); xTicks.push({ x, label }); }
        }
        let yTicks: { y: number; label: string }[] = [];
        if (yAxisRange.max > yAxisRange.min) {
            const tickCount = 3;
            for (let i = 0; i < tickCount; i++) { const value = yAxisRange.min + ((yAxisRange.max - yAxisRange.min) * (i / (tickCount - 1))); const y = 120 - ((value - yAxisRange.min) / (yAxisRange.max - yAxisRange.min)) * 100; yTicks.push({ y, label: formatMetricValue(value, selectedMetric) }); }
        }
        return (
            <div key={step.sequencePosition} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: dotColor, display: 'inline-block' }} />
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{step.emailName}</span>
                        {duplicateNameCounts[step.emailName] > 1 && (
                            <span className="inline-flex items-center" title={`Multiple emails share the name "${step.emailName}" (${duplicateNameCounts[step.emailName]}).`} aria-label="Duplicate step name warning">
                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                            </span>
                        )}
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMetricValue(value, selectedMetric)}</span>
                            {selectedMetric === 'conversionRate' && value > 100 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 text-purple-700 bg-purple-50 dark:border-purple-700 dark:text-purple-200 dark:bg-purple-900/30">Includes view-through</span>
                            )}
                            {periodChange && dateRange !== 'all' && (
                                <span className="text-lg font-bold px-2 py-1 rounded" style={{ color: chartColor, background: 'transparent' }}>{changeNode}</span>
                            )}
                        </div>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{(metricConfig as any)?.label}</span>
                    </div>
                </div>
                <div className="mt-6 relative" style={{ height: '160px' }}>
                    {sparklineData.length > 1 ? (
                        <div className="relative h-full flex">
                            <svg width="100%" height="100%" viewBox="0 0 900 160" style={{ position: 'absolute', left: 0, top: 0 }}>
                                <defs>
                                    <linearGradient id={`gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={chartColor} stopOpacity="0.25" />
                                        <stop offset="100%" stopColor={chartColor} stopOpacity="0.05" />
                                    </linearGradient>
                                </defs>
                                {yTicks.map((tick, i) => (
                                    <g key={i}>
                                        <line x1={0} y1={tick.y} x2={900} y2={tick.y} stroke="#e5e7eb" strokeDasharray="2,2" />
                                        <text x={-5} y={tick.y + 4} textAnchor="end" fontSize="12" fill="#6b7280">{tick.label}</text>
                                    </g>
                                ))}
                                {xTicks.map((tick, i) => (
                                    <g key={i}>
                                        <line x1={tick.x} y1={120} x2={tick.x} y2={130} stroke="#e5e7eb" />
                                        <text x={tick.x} y={145} textAnchor="middle" fontSize="12" fill="#6b7280">{tick.label}</text>
                                    </g>
                                ))}
                                {(() => {
                                    const points = sparklineData.map((point, i) => { const x = (i / (sparklineData.length - 1)) * 900; const y = 120 - ((point.value - yAxisRange.min) / (yAxisRange.max - yAxisRange.min)) * 100; return { x, y, value: point.value, date: point.date }; });
                                    if (points.length === 0) return null;
                                    let pathD = `M ${points[0].x},${points[0].y}`;
                                    for (let i = 1; i < points.length; i++) {
                                        const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) * 0.4;
                                        const cp1y = points[i - 1].y;
                                        const cp2x = points[i].x - (points[i].x - points[i - 1].x) * 0.4;
                                        const cp2y = points[i].y;
                                        pathD += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i].x},${points[i].y}`;
                                    }
                                    const areaPath = pathD + ` L 900,120 L 0,120 Z`;
                                    return (<g><path d={areaPath} fill={`url(#gradient-${index})`} /><path d={pathD} fill="none" stroke={chartColor} strokeWidth="2" /></g>);
                                })()}
                            </svg>
                        </div>
                    ) : value === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <span className="text-sm text-gray-500">No data available</span>
                        </div>
                    ) : (
                        <div className="relative h-full flex items-end">
                            <div className="relative" style={{ width: '100%', height: `${Math.max((value / yAxisRange.max) * 100, 5)}%`, background: chartGradient, borderTop: `2px solid ${chartColor}`, borderRadius: '4px 4px 0 0' }} />
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <section>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Workflow className="w-6 h-6 text-purple-600" />
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Flow Step Analysis</h3>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <select value={selectedFlow} onChange={(e) => setSelectedFlow(e.target.value)} className="appearance-none px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                            <option value="">Select a flow</option>
                            {uniqueFlowNames.map((flow: string) => (<option key={flow} value={flow}>{flow}</option>))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="relative">
                        <select value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)} className="appearance-none px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                            {metricOptions.map(metric => (<option key={metric.value} value={metric.value}>{metric.label}</option>))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                    </div>
                </div>
            </div>

            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${hasDuplicateNames ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'}`}>
                <AlertTriangle className={`mt-0.5 w-4 h-4 ${hasDuplicateNames ? 'text-amber-600' : 'text-gray-500'}`} />
                <div>
                    <div className="font-medium">Naming affects step order{hasDuplicateNames && (<span className="ml-2 font-normal">Duplicate step names detected in this flow.</span>)}</div>
                    <div className="text-xs mt-0.5">Use unique, consistent names for each step. A/B tests can create multiple messages with similar names; add clear suffixes like “- A” and “- B”.</div>
                </div>
            </div>

            {!selectedFlow ? (
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
                    <GitBranch className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-600 dark:text-gray-400">Select a flow to view step-by-step analysis</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {flowStepMetrics.map((step, index) => renderStepChart(step, index))}
                </div>
            )}
        </section>
    );
}
