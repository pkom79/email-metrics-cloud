"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { DataManager } from '../../lib/data/dataManager';
import MetricCard from './MetricCard';
import DayOfWeekPerformance from './DayOfWeekPerformance';
import HourOfDayPerformance from './HourOfDayPerformance';
import AudienceCharts from './AudienceCharts';
import FlowStepAnalysis from './FlowStepAnalysis';
import CustomSegmentBlock from './CustomSegmentBlock';
import { BarChart3, Calendar, ChevronDown, Mail, Send, Zap, Star, Upload as UploadIcon } from 'lucide-react';

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function formatPercent(value: number) { return `${value.toFixed(2)}%`; }
function formatNumber(value: number) { return Math.round(value).toLocaleString('en-US'); }

export default function DashboardClient() {
    const dm = useMemo(() => DataManager.getInstance(), []);

    // Date range and granularity state
    const [dateRange, setDateRange] = useState<'30d' | '60d' | '90d' | '120d' | '180d' | '365d' | 'all'>('30d');
    const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>(dm.getGranularityForDateRange('30d'));
    useEffect(() => { setGranularity(dm.getGranularityForDateRange(dateRange)); }, [dateRange, dm]);

    // UI state
    const [selectedFlow, setSelectedFlow] = useState<string>('all');
    const [selectedCampaignMetric, setSelectedCampaignMetric] = useState<string>('revenue');
    const [displayedCampaigns, setDisplayedCampaigns] = useState<number>(5);
    const [stickyBar, setStickyBar] = useState(false);
    useEffect(() => {
        const onScroll = () => setStickyBar(window.scrollY > 100);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Data
    const ALL_CAMPAIGNS = dm.getCampaigns();
    const ALL_FLOWS = dm.getFlowEmails();
    const hasData = ALL_CAMPAIGNS.length > 0 || ALL_FLOWS.length > 0;
    const lastUpdated = useMemo(() => dm.getLastEmailDate(), [dm]);

    const REFERENCE_DATE = useMemo(() => (hasData ? dm.getLastEmailDate() : new Date()), [hasData, dm]);

    // Filters
    const filteredCampaigns = useMemo(() => {
        if (!hasData) return [] as typeof ALL_CAMPAIGNS;
        if (dateRange === 'all') return ALL_CAMPAIGNS;
        const days = parseInt(dateRange.replace('d', ''));
        const cutoff = new Date(REFERENCE_DATE); cutoff.setDate(cutoff.getDate() - days);
        return ALL_CAMPAIGNS.filter(c => c.sentDate >= cutoff);
    }, [ALL_CAMPAIGNS, dateRange, REFERENCE_DATE, hasData]);

    const filteredFlowEmails = useMemo(() => {
        if (!hasData) return [] as typeof ALL_FLOWS;
        let flows = ALL_FLOWS;
        if (selectedFlow !== 'all') flows = flows.filter(f => f.flowName === selectedFlow);
        if (dateRange !== 'all') {
            const days = parseInt(dateRange.replace('d', ''));
            const cutoff = new Date(REFERENCE_DATE); cutoff.setDate(cutoff.getDate() - days);
            flows = flows.filter(f => f.sentDate >= cutoff);
        }
        return flows;
    }, [ALL_FLOWS, selectedFlow, dateRange, REFERENCE_DATE, hasData]);

    // Overview metrics (all emails)
    const overviewMetrics = useMemo(() => {
        const all = [...filteredCampaigns, ...filteredFlowEmails];
        if (all.length === 0) return null as any;
        const totalRevenue = all.reduce((s, e) => s + e.revenue, 0);
        const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        const mk = (key: string, value: number) => {
            const d = dm.calculatePeriodOverPeriodChange(key as any, dateRange, 'all');
            return { value, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
        };

        return {
            totalRevenue: mk('totalRevenue', totalRevenue),
            averageOrderValue: mk('avgOrderValue', avgOrderValue),
            revenuePerEmail: mk('revenuePerEmail', revenuePerEmail),
            openRate: mk('openRate', openRate),
            clickRate: mk('clickRate', clickRate),
            clickToOpenRate: mk('clickToOpenRate', clickToOpenRate),
            emailsSent: mk('emailsSent', totalEmailsSent),
            totalOrders: mk('totalOrders', totalOrders),
            conversionRate: mk('conversionRate', conversionRate),
            unsubscribeRate: mk('unsubscribeRate', unsubscribeRate),
            spamRate: mk('spamRate', spamRate),
            bounceRate: mk('bounceRate', bounceRate),
        };
    }, [filteredCampaigns, filteredFlowEmails, dateRange, dm]);

    // Campaign-only metrics
    const campaignMetrics = useMemo(() => {
        const all = filteredCampaigns;
        if (all.length === 0) return null as any;
        const totalRevenue = all.reduce((s, e) => s + e.revenue, 0);
        const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        const mk = (key: string, value: number) => {
            const d = dm.calculatePeriodOverPeriodChange(key as any, dateRange, 'campaigns');
            return { value, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
        };

        return {
            totalRevenue: mk('totalRevenue', totalRevenue),
            averageOrderValue: mk('avgOrderValue', avgOrderValue),
            revenuePerEmail: mk('revenuePerEmail', revenuePerEmail),
            openRate: mk('openRate', openRate),
            clickRate: mk('clickRate', clickRate),
            clickToOpenRate: mk('clickToOpenRate', clickToOpenRate),
            emailsSent: mk('emailsSent', totalEmailsSent),
            totalOrders: mk('totalOrders', totalOrders),
            conversionRate: mk('conversionRate', conversionRate),
            unsubscribeRate: mk('unsubscribeRate', unsubscribeRate),
            spamRate: mk('spamRate', spamRate),
            bounceRate: mk('bounceRate', bounceRate),
        };
    }, [filteredCampaigns, dateRange, dm]);

    // Flow-only metrics
    const flowMetrics = useMemo(() => {
        const all = filteredFlowEmails;
        if (all.length === 0) return null as any;
        const totalRevenue = all.reduce((s, e) => s + e.revenue, 0);
        const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        const mk = (key: string, value: number) => {
            const d = dm.calculatePeriodOverPeriodChange(key as any, dateRange, 'flows', { flowName: selectedFlow });
            return { value, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
        };

        return {
            totalRevenue: mk('totalRevenue', totalRevenue),
            averageOrderValue: mk('avgOrderValue', avgOrderValue),
            revenuePerEmail: mk('revenuePerEmail', revenuePerEmail),
            openRate: mk('openRate', openRate),
            clickRate: mk('clickRate', clickRate),
            clickToOpenRate: mk('clickToOpenRate', clickToOpenRate),
            emailsSent: mk('emailsSent', totalEmailsSent),
            totalOrders: mk('totalOrders', totalOrders),
            conversionRate: mk('conversionRate', conversionRate),
            unsubscribeRate: mk('unsubscribeRate', unsubscribeRate),
            spamRate: mk('spamRate', spamRate),
            bounceRate: mk('bounceRate', bounceRate),
        };
    }, [filteredFlowEmails, dateRange, selectedFlow, dm]);

    // Sparkline data
    const overviewSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'revenue', dateRange, granularity),
        averageOrderValue: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'avgOrderValue', dateRange, granularity),
        revenuePerEmail: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'revenuePerEmail', dateRange, granularity),
        openRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'openRate', dateRange, granularity),
        clickRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'clickRate', dateRange, granularity),
        clickToOpenRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'clickToOpenRate', dateRange, granularity),
        emailsSent: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'emailsSent', dateRange, granularity),
        totalOrders: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'totalOrders', dateRange, granularity),
        conversionRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'conversionRate', dateRange, granularity),
        unsubscribeRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'unsubscribeRate', dateRange, granularity),
        spamRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'spamRate', dateRange, granularity),
        bounceRate: dm.getMetricTimeSeries(filteredCampaigns, filteredFlowEmails, 'bounceRate', dateRange, granularity),
    }), [filteredCampaigns, filteredFlowEmails, dateRange, granularity, dm]);

    const campaignSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries(filteredCampaigns, [], 'revenue', dateRange, granularity),
        averageOrderValue: dm.getMetricTimeSeries(filteredCampaigns, [], 'avgOrderValue', dateRange, granularity),
        revenuePerEmail: dm.getMetricTimeSeries(filteredCampaigns, [], 'revenuePerEmail', dateRange, granularity),
        openRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'openRate', dateRange, granularity),
        clickRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'clickRate', dateRange, granularity),
        clickToOpenRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'clickToOpenRate', dateRange, granularity),
        emailsSent: dm.getMetricTimeSeries(filteredCampaigns, [], 'emailsSent', dateRange, granularity),
        totalOrders: dm.getMetricTimeSeries(filteredCampaigns, [], 'totalOrders', dateRange, granularity),
        conversionRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'conversionRate', dateRange, granularity),
        unsubscribeRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'unsubscribeRate', dateRange, granularity),
        spamRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'spamRate', dateRange, granularity),
        bounceRate: dm.getMetricTimeSeries(filteredCampaigns, [], 'bounceRate', dateRange, granularity),
    }), [filteredCampaigns, dateRange, granularity, dm]);

    const flowSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries([], filteredFlowEmails, 'revenue', dateRange, granularity),
        averageOrderValue: dm.getMetricTimeSeries([], filteredFlowEmails, 'avgOrderValue', dateRange, granularity),
        revenuePerEmail: dm.getMetricTimeSeries([], filteredFlowEmails, 'revenuePerEmail', dateRange, granularity),
        openRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'openRate', dateRange, granularity),
        clickRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'clickRate', dateRange, granularity),
        clickToOpenRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'clickToOpenRate', dateRange, granularity),
        emailsSent: dm.getMetricTimeSeries([], filteredFlowEmails, 'emailsSent', dateRange, granularity),
        totalOrders: dm.getMetricTimeSeries([], filteredFlowEmails, 'totalOrders', dateRange, granularity),
        conversionRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'conversionRate', dateRange, granularity),
        unsubscribeRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'unsubscribeRate', dateRange, granularity),
        spamRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'spamRate', dateRange, granularity),
        bounceRate: dm.getMetricTimeSeries([], filteredFlowEmails, 'bounceRate', dateRange, granularity),
    }), [filteredFlowEmails, dateRange, granularity, dm]);

    const uniqueFlowNames = useMemo(() => Array.from(new Set(ALL_FLOWS.filter(e => (e.status || '').toLowerCase() === 'live').map(e => e.flowName))).sort(), [ALL_FLOWS]);

    const campaignMetricOptions = [
        { value: 'revenue', label: 'Revenue' },
        { value: 'avgOrderValue', label: 'Avg Order Value' },
        { value: 'revenuePerEmail', label: 'Revenue per Email' },
        { value: 'openRate', label: 'Open Rate' },
        { value: 'clickRate', label: 'Click Rate' },
        { value: 'clickToOpenRate', label: 'Click-to-Open Rate' },
        { value: 'emailsSent', label: 'Emails Sent' },
        { value: 'totalOrders', label: 'Total Orders' },
        { value: 'conversionRate', label: 'Conversion Rate' },
        { value: 'unsubscribeRate', label: 'Unsubscribe Rate' },
        { value: 'spamRate', label: 'Spam Rate' },
        { value: 'bounceRate', label: 'Bounce Rate' },
    ];

    const formatMetricValue = (v: number, metric: string) => {
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) return formatCurrency(v);
        if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) return formatPercent(v);
        return formatNumber(v);
    };

    const getSortedCampaigns = () => {
        return [...filteredCampaigns].sort((a, b) => {
            const av = Number((a as any)[selectedCampaignMetric]) || 0;
            const bv = Number((b as any)[selectedCampaignMetric]) || 0;
            return bv - av;
        });
    };

    return (
        <div className="min-h-screen">
            {/* Top header (card, same width as modules) */}
            <div className="pt-4 sm:pt-6">
                <div className="max-w-7xl mx-auto">
                    <div className="p-6 sm:p-8 mb-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Performance Dashboard</h1>
                            </div>
                            <a href="/" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                                <UploadIcon className="h-4 w-4" />
                                Upload New Reports
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters bar (no separators, centered, equal-sized buttons) */}
            <div className="sticky top-0 z-50 pt-2">
                <div className="max-w-7xl mx-auto px-4">
                    <div className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${stickyBar ? 'shadow-lg' : 'shadow-sm'} px-3 py-2`}>
                        <div className="flex items-center justify-center gap-3 flex-nowrap whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-4 h-4 text-gray-500" />
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Date Range:</span>
                                <div className="flex gap-1.5 ml-2 flex-nowrap">
                                    {[
                                        { value: '30d', label: 'Last 30 days' },
                                        { value: '60d', label: 'Last 60 days' },
                                        { value: '90d', label: 'Last 90 days' },
                                        { value: '120d', label: 'Last 120 days' },
                                        { value: '180d', label: 'Last 180 days' },
                                        { value: '365d', label: 'Last 365 days' },
                                        { value: 'all', label: 'All time' },
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => setDateRange(opt.value as any)}
                                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors
                                                ${dateRange === opt.value
                                                    ? 'bg-purple-600 text-white border-purple-600'
                                                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <BarChart3 className="w-4 h-4 text-gray-500" />
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Granularity:</span>
                                <div className="flex gap-1.5 ml-2 flex-nowrap">
                                    {(['daily', 'weekly', 'monthly'] as const).map(g => (
                                        <button
                                            key={g}
                                            onClick={() => setGranularity(g)}
                                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors
                                                ${granularity === g
                                                    ? 'bg-purple-600 text-white border-purple-600'
                                                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}
                                        >
                                            {g.charAt(0).toUpperCase() + g.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Data Coverage Notice with outer horizontal space (no white band) */}
            <div className="py-3">
                <div className="max-w-7xl mx-auto">
                    <div className="mx-4 sm:mx-6">
                        <div className="p-0 text-purple-700 dark:text-purple-200">
                            <span className="text-xs">
                                <span className="font-medium">Data Coverage Notice:</span> All date range selections reflect data up to the most recent email activity recorded on {lastUpdated.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className={`${stickyBar ? 'mt-0' : ''} p-6`}>
                <div className="max-w-7xl mx-auto space-y-8">
                    {/* Overview metrics */}
                    {overviewMetrics && (
                        <section>
                            <div className="mb-3">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Overview</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                <MetricCard
                                    title="Total Revenue"
                                    value={formatCurrency(overviewMetrics.totalRevenue.value)}
                                    change={overviewMetrics.totalRevenue.change}
                                    isPositive={overviewMetrics.totalRevenue.isPositive}
                                    previousValue={overviewMetrics.totalRevenue.previousValue}
                                    previousPeriod={overviewMetrics.totalRevenue.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="revenue"
                                    sparklineData={overviewSeries.totalRevenue}
                                />
                                <MetricCard
                                    title="Avg Order Value"
                                    value={formatCurrency(overviewMetrics.averageOrderValue.value)}
                                    change={overviewMetrics.averageOrderValue.change}
                                    isPositive={overviewMetrics.averageOrderValue.isPositive}
                                    previousValue={overviewMetrics.averageOrderValue.previousValue}
                                    previousPeriod={overviewMetrics.averageOrderValue.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="avgOrderValue"
                                    sparklineData={overviewSeries.averageOrderValue}
                                />
                                <MetricCard
                                    title="Revenue per Email"
                                    value={formatCurrency(overviewMetrics.revenuePerEmail.value)}
                                    change={overviewMetrics.revenuePerEmail.change}
                                    isPositive={overviewMetrics.revenuePerEmail.isPositive}
                                    previousValue={overviewMetrics.revenuePerEmail.previousValue}
                                    previousPeriod={overviewMetrics.revenuePerEmail.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="revenuePerEmail"
                                    sparklineData={overviewSeries.revenuePerEmail}
                                />
                                <MetricCard
                                    title="Open Rate"
                                    value={formatPercent(overviewMetrics.openRate.value)}
                                    change={overviewMetrics.openRate.change}
                                    isPositive={overviewMetrics.openRate.isPositive}
                                    previousValue={overviewMetrics.openRate.previousValue}
                                    previousPeriod={overviewMetrics.openRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="openRate"
                                    sparklineData={overviewSeries.openRate}
                                />
                                <MetricCard
                                    title="Click Rate"
                                    value={formatPercent(overviewMetrics.clickRate.value)}
                                    change={overviewMetrics.clickRate.change}
                                    isPositive={overviewMetrics.clickRate.isPositive}
                                    previousValue={overviewMetrics.clickRate.previousValue}
                                    previousPeriod={overviewMetrics.clickRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="clickRate"
                                    sparklineData={overviewSeries.clickRate}
                                />
                                <MetricCard
                                    title="Click-to-Open Rate"
                                    value={formatPercent(overviewMetrics.clickToOpenRate.value)}
                                    change={overviewMetrics.clickToOpenRate.change}
                                    isPositive={overviewMetrics.clickToOpenRate.isPositive}
                                    previousValue={overviewMetrics.clickToOpenRate.previousValue}
                                    previousPeriod={overviewMetrics.clickToOpenRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="clickToOpenRate"
                                    sparklineData={overviewSeries.clickToOpenRate}
                                />
                                <MetricCard
                                    title="Emails Sent"
                                    value={formatNumber(overviewMetrics.emailsSent.value)}
                                    change={overviewMetrics.emailsSent.change}
                                    isPositive={overviewMetrics.emailsSent.isPositive}
                                    previousValue={overviewMetrics.emailsSent.previousValue}
                                    previousPeriod={overviewMetrics.emailsSent.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="emailsSent"
                                    sparklineData={overviewSeries.emailsSent}
                                />
                                <MetricCard
                                    title="Total Orders"
                                    value={formatNumber(overviewMetrics.totalOrders.value)}
                                    change={overviewMetrics.totalOrders.change}
                                    isPositive={overviewMetrics.totalOrders.isPositive}
                                    previousValue={overviewMetrics.totalOrders.previousValue}
                                    previousPeriod={overviewMetrics.totalOrders.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="totalOrders"
                                    sparklineData={overviewSeries.totalOrders}
                                />
                                <MetricCard
                                    title="Conversion Rate"
                                    value={formatPercent(overviewMetrics.conversionRate.value)}
                                    change={overviewMetrics.conversionRate.change}
                                    isPositive={overviewMetrics.conversionRate.isPositive}
                                    previousValue={overviewMetrics.conversionRate.previousValue}
                                    previousPeriod={overviewMetrics.conversionRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="conversionRate"
                                    sparklineData={overviewSeries.conversionRate}
                                />
                                <MetricCard
                                    title="Unsubscribe Rate"
                                    value={formatPercent(overviewMetrics.unsubscribeRate.value)}
                                    change={overviewMetrics.unsubscribeRate.change}
                                    isPositive={overviewMetrics.unsubscribeRate.isPositive}
                                    previousValue={overviewMetrics.unsubscribeRate.previousValue}
                                    previousPeriod={overviewMetrics.unsubscribeRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="unsubscribeRate"
                                    sparklineData={overviewSeries.unsubscribeRate}
                                    isNegativeMetric
                                />
                                <MetricCard
                                    title="Spam Rate"
                                    value={formatPercent(overviewMetrics.spamRate.value)}
                                    change={overviewMetrics.spamRate.change}
                                    isPositive={overviewMetrics.spamRate.isPositive}
                                    previousValue={overviewMetrics.spamRate.previousValue}
                                    previousPeriod={overviewMetrics.spamRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="spamRate"
                                    sparklineData={overviewSeries.spamRate}
                                    isNegativeMetric
                                />
                                <MetricCard
                                    title="Bounce Rate"
                                    value={formatPercent(overviewMetrics.bounceRate.value)}
                                    change={overviewMetrics.bounceRate.change}
                                    isPositive={overviewMetrics.bounceRate.isPositive}
                                    previousValue={overviewMetrics.bounceRate.previousValue}
                                    previousPeriod={overviewMetrics.bounceRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="bounceRate"
                                    sparklineData={overviewSeries.bounceRate}
                                    isNegativeMetric
                                />
                            </div>
                        </section>
                    )}

                    {/* Campaign-only metrics */}
                    {campaignMetrics && (
                        <section>
                            <div className="mb-3">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Campaigns</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                <MetricCard
                                    title="Revenue (Campaigns)"
                                    value={formatCurrency(campaignMetrics.totalRevenue.value)}
                                    change={campaignMetrics.totalRevenue.change}
                                    isPositive={campaignMetrics.totalRevenue.isPositive}
                                    previousValue={campaignMetrics.totalRevenue.previousValue}
                                    previousPeriod={campaignMetrics.totalRevenue.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="revenue"
                                    sparklineData={campaignSeries.totalRevenue}
                                />
                                <MetricCard
                                    title="Avg Order Value"
                                    value={formatCurrency(campaignMetrics.averageOrderValue.value)}
                                    change={campaignMetrics.averageOrderValue.change}
                                    isPositive={campaignMetrics.averageOrderValue.isPositive}
                                    previousValue={campaignMetrics.averageOrderValue.previousValue}
                                    previousPeriod={campaignMetrics.averageOrderValue.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="avgOrderValue"
                                    sparklineData={campaignSeries.averageOrderValue}
                                />
                                <MetricCard
                                    title="Revenue per Email"
                                    value={formatCurrency(campaignMetrics.revenuePerEmail.value)}
                                    change={campaignMetrics.revenuePerEmail.change}
                                    isPositive={campaignMetrics.revenuePerEmail.isPositive}
                                    previousValue={campaignMetrics.revenuePerEmail.previousValue}
                                    previousPeriod={campaignMetrics.revenuePerEmail.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="revenuePerEmail"
                                    sparklineData={campaignSeries.revenuePerEmail}
                                />
                                <MetricCard
                                    title="Open Rate"
                                    value={formatPercent(campaignMetrics.openRate.value)}
                                    change={campaignMetrics.openRate.change}
                                    isPositive={campaignMetrics.openRate.isPositive}
                                    previousValue={campaignMetrics.openRate.previousValue}
                                    previousPeriod={campaignMetrics.openRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="openRate"
                                    sparklineData={campaignSeries.openRate}
                                />
                                <MetricCard
                                    title="Click Rate"
                                    value={formatPercent(campaignMetrics.clickRate.value)}
                                    change={campaignMetrics.clickRate.change}
                                    isPositive={campaignMetrics.clickRate.isPositive}
                                    previousValue={campaignMetrics.clickRate.previousValue}
                                    previousPeriod={campaignMetrics.clickRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="clickRate"
                                    sparklineData={campaignSeries.clickRate}
                                />
                                <MetricCard
                                    title="Click-to-Open Rate"
                                    value={formatPercent(campaignMetrics.clickToOpenRate.value)}
                                    change={campaignMetrics.clickToOpenRate.change}
                                    isPositive={campaignMetrics.clickToOpenRate.isPositive}
                                    previousValue={campaignMetrics.clickToOpenRate.previousValue}
                                    previousPeriod={campaignMetrics.clickToOpenRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="clickToOpenRate"
                                    sparklineData={campaignSeries.clickToOpenRate}
                                />
                                <MetricCard
                                    title="Emails Sent"
                                    value={formatNumber(campaignMetrics.emailsSent.value)}
                                    change={campaignMetrics.emailsSent.change}
                                    isPositive={campaignMetrics.emailsSent.isPositive}
                                    previousValue={campaignMetrics.emailsSent.previousValue}
                                    previousPeriod={campaignMetrics.emailsSent.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="emailsSent"
                                    sparklineData={campaignSeries.emailsSent}
                                />
                                <MetricCard
                                    title="Total Orders"
                                    value={formatNumber(campaignMetrics.totalOrders.value)}
                                    change={campaignMetrics.totalOrders.change}
                                    isPositive={campaignMetrics.totalOrders.isPositive}
                                    previousValue={campaignMetrics.totalOrders.previousValue}
                                    previousPeriod={campaignMetrics.totalOrders.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="totalOrders"
                                    sparklineData={campaignSeries.totalOrders}
                                />
                                <MetricCard
                                    title="Conversion Rate"
                                    value={formatPercent(campaignMetrics.conversionRate.value)}
                                    change={campaignMetrics.conversionRate.change}
                                    isPositive={campaignMetrics.conversionRate.isPositive}
                                    previousValue={campaignMetrics.conversionRate.previousValue}
                                    previousPeriod={campaignMetrics.conversionRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="conversionRate"
                                    sparklineData={campaignSeries.conversionRate}
                                />
                                <MetricCard
                                    title="Unsubscribe Rate"
                                    value={formatPercent(campaignMetrics.unsubscribeRate.value)}
                                    change={campaignMetrics.unsubscribeRate.change}
                                    isPositive={campaignMetrics.unsubscribeRate.isPositive}
                                    previousValue={campaignMetrics.unsubscribeRate.previousValue}
                                    previousPeriod={campaignMetrics.unsubscribeRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="unsubscribeRate"
                                    sparklineData={campaignSeries.unsubscribeRate}
                                    isNegativeMetric
                                />
                                <MetricCard
                                    title="Spam Rate"
                                    value={formatPercent(campaignMetrics.spamRate.value)}
                                    change={campaignMetrics.spamRate.change}
                                    isPositive={campaignMetrics.spamRate.isPositive}
                                    previousValue={campaignMetrics.spamRate.previousValue}
                                    previousPeriod={campaignMetrics.spamRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="spamRate"
                                    sparklineData={campaignSeries.spamRate}
                                    isNegativeMetric
                                />
                                <MetricCard
                                    title="Bounce Rate"
                                    value={formatPercent(campaignMetrics.bounceRate.value)}
                                    change={campaignMetrics.bounceRate.change}
                                    isPositive={campaignMetrics.bounceRate.isPositive}
                                    previousValue={campaignMetrics.bounceRate.previousValue}
                                    previousPeriod={campaignMetrics.bounceRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="bounceRate"
                                    sparklineData={campaignSeries.bounceRate}
                                    isNegativeMetric
                                />
                            </div>
                        </section>
                    )}

                    {/* Flow-only metrics */}
                    {flowMetrics && (
                        <section>
                            <div className="mb-3">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Flows</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                <MetricCard
                                    title="Revenue (Flows)"
                                    value={formatCurrency(flowMetrics.totalRevenue.value)}
                                    change={flowMetrics.totalRevenue.change}
                                    isPositive={flowMetrics.totalRevenue.isPositive}
                                    previousValue={flowMetrics.totalRevenue.previousValue}
                                    previousPeriod={flowMetrics.totalRevenue.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="revenue"
                                    sparklineData={flowSeries.totalRevenue}
                                />
                                <MetricCard
                                    title="Avg Order Value"
                                    value={formatCurrency(flowMetrics.averageOrderValue.value)}
                                    change={flowMetrics.averageOrderValue.change}
                                    isPositive={flowMetrics.averageOrderValue.isPositive}
                                    previousValue={flowMetrics.averageOrderValue.previousValue}
                                    previousPeriod={flowMetrics.averageOrderValue.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="avgOrderValue"
                                    sparklineData={flowSeries.averageOrderValue}
                                />
                                <MetricCard
                                    title="Revenue per Email"
                                    value={formatCurrency(flowMetrics.revenuePerEmail.value)}
                                    change={flowMetrics.revenuePerEmail.change}
                                    isPositive={flowMetrics.revenuePerEmail.isPositive}
                                    previousValue={flowMetrics.revenuePerEmail.previousValue}
                                    previousPeriod={flowMetrics.revenuePerEmail.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="revenuePerEmail"
                                    sparklineData={flowSeries.revenuePerEmail}
                                />
                                <MetricCard
                                    title="Open Rate"
                                    value={formatPercent(flowMetrics.openRate.value)}
                                    change={flowMetrics.openRate.change}
                                    isPositive={flowMetrics.openRate.isPositive}
                                    previousValue={flowMetrics.openRate.previousValue}
                                    previousPeriod={flowMetrics.openRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="openRate"
                                    sparklineData={flowSeries.openRate}
                                />
                                <MetricCard
                                    title="Click Rate"
                                    value={formatPercent(flowMetrics.clickRate.value)}
                                    change={flowMetrics.clickRate.change}
                                    isPositive={flowMetrics.clickRate.isPositive}
                                    previousValue={flowMetrics.clickRate.previousValue}
                                    previousPeriod={flowMetrics.clickRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="clickRate"
                                    sparklineData={flowSeries.clickRate}
                                />
                                <MetricCard
                                    title="Click-to-Open Rate"
                                    value={formatPercent(flowMetrics.clickToOpenRate.value)}
                                    change={flowMetrics.clickToOpenRate.change}
                                    isPositive={flowMetrics.clickToOpenRate.isPositive}
                                    previousValue={flowMetrics.clickToOpenRate.previousValue}
                                    previousPeriod={flowMetrics.clickToOpenRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="clickToOpenRate"
                                    sparklineData={flowSeries.clickToOpenRate}
                                />
                                <MetricCard
                                    title="Emails Sent"
                                    value={formatNumber(flowMetrics.emailsSent.value)}
                                    change={flowMetrics.emailsSent.change}
                                    isPositive={flowMetrics.emailsSent.isPositive}
                                    previousValue={flowMetrics.emailsSent.previousValue}
                                    previousPeriod={flowMetrics.emailsSent.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="emailsSent"
                                    sparklineData={flowSeries.emailsSent}
                                />
                                <MetricCard
                                    title="Total Orders"
                                    value={formatNumber(flowMetrics.totalOrders.value)}
                                    change={flowMetrics.totalOrders.change}
                                    isPositive={flowMetrics.totalOrders.isPositive}
                                    previousValue={flowMetrics.totalOrders.previousValue}
                                    previousPeriod={flowMetrics.totalOrders.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="totalOrders"
                                    sparklineData={flowSeries.totalOrders}
                                />
                                <MetricCard
                                    title="Conversion Rate"
                                    value={formatPercent(flowMetrics.conversionRate.value)}
                                    change={flowMetrics.conversionRate.change}
                                    isPositive={flowMetrics.conversionRate.isPositive}
                                    previousValue={flowMetrics.conversionRate.previousValue}
                                    previousPeriod={flowMetrics.conversionRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="conversionRate"
                                    sparklineData={flowSeries.conversionRate}
                                />
                                <MetricCard
                                    title="Unsubscribe Rate"
                                    value={formatPercent(flowMetrics.unsubscribeRate.value)}
                                    change={flowMetrics.unsubscribeRate.change}
                                    isPositive={flowMetrics.unsubscribeRate.isPositive}
                                    previousValue={flowMetrics.unsubscribeRate.previousValue}
                                    previousPeriod={flowMetrics.unsubscribeRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="unsubscribeRate"
                                    sparklineData={flowSeries.unsubscribeRate}
                                    isNegativeMetric
                                />
                                <MetricCard
                                    title="Spam Rate"
                                    value={formatPercent(flowMetrics.spamRate.value)}
                                    change={flowMetrics.spamRate.change}
                                    isPositive={flowMetrics.spamRate.isPositive}
                                    previousValue={flowMetrics.spamRate.previousValue}
                                    previousPeriod={flowMetrics.spamRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="spamRate"
                                    sparklineData={flowSeries.spamRate}
                                    isNegativeMetric
                                />
                                <MetricCard
                                    title="Bounce Rate"
                                    value={formatPercent(flowMetrics.bounceRate.value)}
                                    change={flowMetrics.bounceRate.change}
                                    isPositive={flowMetrics.bounceRate.isPositive}
                                    previousValue={flowMetrics.bounceRate.previousValue}
                                    previousPeriod={flowMetrics.bounceRate.previousPeriod}
                                    dateRange={dateRange}
                                    metricKey="bounceRate"
                                    sparklineData={flowSeries.bounceRate}
                                    isNegativeMetric
                                />
                            </div>
                        </section>
                    )}

                    {/* Charts: stack one below the other */}
                    <div className="space-y-6">
                        <DayOfWeekPerformance filteredCampaigns={filteredCampaigns} dateRange={dateRange} />
                        <HourOfDayPerformance filteredCampaigns={filteredCampaigns} dateRange={dateRange} />
                    </div>

                    {/* Audience Overview */}
                    <AudienceCharts />

                    {/* Flow Step Analysis */}
                    <FlowStepAnalysis dateRange={dateRange} granularity={granularity} />

                    {/* Custom Segment Ideas */}
                    <CustomSegmentBlock />
                </div>
            </div>
        </div>
    );
}
