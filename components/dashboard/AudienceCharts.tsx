"use client";
import React from 'react';
import { Users, UserCheck, DollarSign, TrendingUp, Calendar, AlertCircle, Trash2, PiggyBank, CheckCircle } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import InactivityRevenueDrain from './InactivityRevenueDrain';
import EngagementByTenure from './EngagementByTenure';
import { DataManager } from '../../lib/data/dataManager';

export default function AudienceCharts({ dateRange, granularity, customFrom, customTo }: { dateRange: string; granularity: 'daily' | 'weekly' | 'monthly'; customFrom?: string; customTo?: string }) {
    const dataManager = DataManager.getInstance();
    const audienceInsights = dataManager.getAudienceInsights();
    const subscribers = dataManager.getSubscribers();
    const hasData = subscribers.length > 0;
    const [showDeadWeightGuide, setShowDeadWeightGuide] = React.useState(false);

    const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    const formatPercent = (value: number) => {
        const formatted = value.toFixed(1);
        const num = parseFloat(formatted);
        return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
    };

    const purchaseFrequencyData = [
        { label: 'Never', value: audienceInsights.purchaseFrequency.never, percentage: (audienceInsights.purchaseFrequency.never / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '1 Order', value: audienceInsights.purchaseFrequency.oneOrder, percentage: (audienceInsights.purchaseFrequency.oneOrder / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '2 Orders', value: audienceInsights.purchaseFrequency.twoOrders, percentage: (audienceInsights.purchaseFrequency.twoOrders / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '3-5 Orders', value: audienceInsights.purchaseFrequency.threeTo5, percentage: (audienceInsights.purchaseFrequency.threeTo5 / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '6+ Orders', value: audienceInsights.purchaseFrequency.sixPlus, percentage: (audienceInsights.purchaseFrequency.sixPlus / (audienceInsights.totalSubscribers || 1)) * 100 }
    ];

    const lifetimeData = [
        { label: '0-3 months', value: audienceInsights.lifetimeDistribution.zeroTo3Months, percentage: (audienceInsights.lifetimeDistribution.zeroTo3Months / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '3-6 months', value: audienceInsights.lifetimeDistribution.threeTo6Months, percentage: (audienceInsights.lifetimeDistribution.threeTo6Months / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '6-12 months', value: audienceInsights.lifetimeDistribution.sixTo12Months, percentage: (audienceInsights.lifetimeDistribution.sixTo12Months / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '1-2 years', value: audienceInsights.lifetimeDistribution.oneToTwoYears, percentage: (audienceInsights.lifetimeDistribution.oneToTwoYears / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '2+ years', value: audienceInsights.lifetimeDistribution.twoYearsPlus, percentage: (audienceInsights.lifetimeDistribution.twoYearsPlus / (audienceInsights.totalSubscribers || 1)) * 100 }
    ];

    // High-value customer segments (2x, 3x, 6x AOV of buyers)
    const highValueSegments = React.useMemo(() => {
        if (!hasData) return [] as { label: string; threshold: number; customers: number; revenue: number; revenuePercentage: number }[];
        const aov = audienceInsights.avgClvBuyers;
        const segments = [
            { label: `2x AOV (${formatCurrency(aov * 2)}+)`, threshold: aov * 2, customers: 0, revenue: 0, revenuePercentage: 0 },
            { label: `3x AOV (${formatCurrency(aov * 3)}+)`, threshold: aov * 3, customers: 0, revenue: 0, revenuePercentage: 0 },
            { label: `6x AOV (${formatCurrency(aov * 6)}+)`, threshold: aov * 6, customers: 0, revenue: 0, revenuePercentage: 0 },
        ];
        let totalBuyerRevenue = 0;
        subscribers.forEach(s => { if (s.isBuyer && s.totalClv > 0) totalBuyerRevenue += s.totalClv; });
        subscribers.forEach(s => {
            if (s.isBuyer && s.totalClv > 0) {
                segments.forEach(seg => { if (s.totalClv >= seg.threshold) { seg.customers++; seg.revenue += s.totalClv; } });
            }
        });
        segments.forEach(seg => { seg.revenuePercentage = totalBuyerRevenue > 0 ? (seg.revenue / totalBuyerRevenue) * 100 : 0; });
        return segments;
    }, [hasData, audienceInsights.avgClvBuyers, subscribers]);

    // Last Active segments
    const lastActiveSegments = React.useMemo(() => {
        if (!hasData) return [] as { label: string; count: number; percent: number }[];
        const lastEmailDate = dataManager.getLastEmailDate();
        const total = subscribers.length;
        const neverActiveCount = subscribers.filter(sub => {
            if (sub.lastActive == null) return true;
            if (sub.lastActive instanceof Date) {
                const t = sub.lastActive.getTime();
                return isNaN(t) || t === 0;
            }
            return true;
        }).length;
        const counters = [
            { label: 'Never Active', count: neverActiveCount },
            { label: 'Inactive for 90+ days', days: 90, count: 0 },
            { label: 'Inactive for 120+ days', days: 120, count: 0 },
            { label: 'Inactive for 180+ days', days: 180, count: 0 },
            { label: 'Inactive for 365+ days', days: 365, count: 0 },
        ] as any[];
        subscribers.forEach(sub => {
            if (sub.lastActive && lastEmailDate) {
                const diffDays = Math.floor((lastEmailDate.getTime() - sub.lastActive.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays >= 90) counters[1].count++;
                if (diffDays >= 120) counters[2].count++;
                if (diffDays >= 180) counters[3].count++;
                if (diffDays >= 365) counters[4].count++;
            }
        });
        return counters.map(c => ({ label: c.label, count: c.count, percent: total > 0 ? (c.count / total) * 100 : 0 }));
    }, [hasData, subscribers, dataManager]);

    // Dead Weight Subscribers & Savings module
    const deadWeight = React.useMemo(() => {
        if (!hasData) return null as null | {
            segment1: string[]; // emails
            segment2: string[];
            combined: string[];
            currentPrice: number | null;
            newPrice: number | null;
            monthlySavings: number | null;
            annualSavings: number | null;
        };

        const anchor = dataManager.getLastEmailDate();
        const daysDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

        // Pricing tiers (min, max, price)
        const pricing: { min: number; max: number; price: number }[] = [
            { min: 0, max: 250, price: 0 },
            { min: 251, max: 500, price: 20 },
            { min: 501, max: 1000, price: 30 },
            { min: 1001, max: 1500, price: 45 },
            { min: 1501, max: 2500, price: 60 },
            { min: 2501, max: 3000, price: 70 },
            { min: 3001, max: 3500, price: 80 },
            { min: 3501, max: 5000, price: 100 },
            { min: 5001, max: 5500, price: 110 },
            { min: 5501, max: 6000, price: 130 },
            { min: 6001, max: 6500, price: 140 },
            { min: 6501, max: 10000, price: 150 },
            { min: 10001, max: 10500, price: 175 },
            { min: 10501, max: 11000, price: 200 },
            { min: 11001, max: 11500, price: 225 },
            { min: 11501, max: 12000, price: 250 },
            { min: 12001, max: 12500, price: 275 },
            { min: 12501, max: 13000, price: 300 },
            { min: 13001, max: 13500, price: 325 },
            { min: 13501, max: 15000, price: 350 },
            { min: 15001, max: 20000, price: 375 },
            { min: 20001, max: 25000, price: 400 },
            { min: 25001, max: 26000, price: 425 },
            { min: 26001, max: 27000, price: 450 },
            { min: 27001, max: 28000, price: 475 },
            { min: 28001, max: 30000, price: 500 },
            { min: 30001, max: 35000, price: 550 },
            { min: 35001, max: 40000, price: 600 },
            { min: 40001, max: 45000, price: 650 },
            { min: 45001, max: 50000, price: 720 },
            { min: 50001, max: 55000, price: 790 },
            { min: 55001, max: 60000, price: 860 },
            { min: 60001, max: 65000, price: 930 },
            { min: 65001, max: 70000, price: 1000 },
            { min: 70001, max: 75000, price: 1070 },
            { min: 75001, max: 80000, price: 1140 },
            { min: 80001, max: 85000, price: 1205 },
            { min: 85001, max: 90000, price: 1265 },
            { min: 90001, max: 95000, price: 1325 },
            { min: 95001, max: 100000, price: 1380 },
            { min: 100001, max: 105000, price: 1440 },
            { min: 105001, max: 110000, price: 1495 },
            { min: 110001, max: 115000, price: 1555 },
            { min: 115001, max: 120000, price: 1610 },
            { min: 120001, max: 125000, price: 1670 },
            { min: 125001, max: 130000, price: 1725 },
            { min: 130001, max: 135000, price: 1785 },
            { min: 135001, max: 140000, price: 1840 },
            { min: 140001, max: 145000, price: 1900 },
            { min: 145001, max: 150000, price: 1955 },
            { min: 150001, max: 200000, price: 2070 },
            { min: 200001, max: 250000, price: 2300 },
        ];

        const priceFor = (count: number): number | null => {
            if (count > 250000) return null; // custom pricing
            const tier = pricing.find(t => count >= t.min && count <= t.max);
            return tier ? tier.price : null;
        };

        // Segment 1: First Active not set AND Last Active not set AND Created at least 30 days ago
        const seg1Emails: string[] = [];
        // Segment 2: Last Click >= 90 days ago AND Last Open >= 90 days ago AND Created >= 90 days ago
        const seg2Emails: string[] = [];

        subscribers.forEach(sub => {
            const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
            const createdAge = created ? daysDiff(anchor, created) : 0;
            const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
            const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;

            // Segment 1 condition (using firstActiveRaw to detect unset)
            const firstActiveUnset = !sub.firstActiveRaw; // raw missing
            const lastActiveUnset = !sub.lastActive;
            if (firstActiveUnset && lastActiveUnset && createdAge >= 30) {
                seg1Emails.push(sub.email.toLowerCase());
            }

            // Segment 2 condition
            if (createdAge >= 90) {
                const openAge = lastOpen ? daysDiff(anchor, lastOpen) : Infinity; // if missing treat as very old
                const clickAge = lastClick ? daysDiff(anchor, lastClick) : Infinity;
                if (openAge >= 90 && clickAge >= 90) {
                    seg2Emails.push(sub.email.toLowerCase());
                }
            }
        });

        // Combine & dedupe
        const combinedSet = new Set<string>([...seg1Emails, ...seg2Emails]);
        const combined = Array.from(combinedSet);

        const currentCount = subscribers.length;
        const deadWeightCount = combined.length;
        const projectedCount = Math.max(0, currentCount - deadWeightCount);

        const currentPrice = priceFor(currentCount);
        const newPrice = priceFor(projectedCount);
        const monthlySavings = currentPrice !== null && newPrice !== null ? currentPrice - newPrice : null;
        const annualSavings = monthlySavings !== null ? monthlySavings * 12 : null;

        return {
            segment1: seg1Emails,
            segment2: seg2Emails,
            combined,
            currentPrice,
            newPrice,
            monthlySavings,
            annualSavings,
        };
    }, [hasData, subscribers, dataManager]);

    if (!hasData) {
        return (
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <Users className="w-6 h-6 text-purple-600" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audience Overview</h2>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-500" />
                    <p className="text-gray-600 dark:text-gray-400">No subscriber data available. Upload subscriber CSV to see audience insights.</p>
                </div>
            </section>
        );
    }

    return (
        <section>
            <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-purple-600" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audience Overview</h2>
            </div>
            <div className="mb-6">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Snapshot data collected through {dataManager.getLastEmailDate().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <Users className="w-5 h-5 text-purple-600" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Active Audience</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{audienceInsights.totalSubscribers.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <UserCheck className="w-5 h-5 text-purple-600" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Buyers</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{audienceInsights.buyerCount.toLocaleString()}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{(() => {
                        const value = (audienceInsights.buyerPercentage || 0);
                        const formatted = value.toFixed(1);
                        const num = parseFloat(formatted);
                        return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
                    })()} of total</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <DollarSign className="w-5 h-5 text-purple-600" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Avg CLV (All)</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(audienceInsights.avgClvAll)}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <TrendingUp className="w-5 h-5 text-purple-600" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Avg CLV (Buyers)</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(audienceInsights.avgClvBuyers)}</p>
                </div>
            </div>

            <div className="mb-6">
                {/* Audience Growth module */}
                {React.createElement(require('./AudienceGrowth').default, { dateRange, granularity, customFrom, customTo })}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <UserCheck className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Purchase Frequency Distribution</h3>
                    </div>
                    <div className="space-y-3">
                        {purchaseFrequencyData.map((item) => (
                            <div key={item.label}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{`${item.value.toLocaleString()} (${formatPercent(item.percentage)})`}</span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${item.percentage}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Calendar className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Audience Lifetime</h3>
                    </div>
                    <div className="space-y-3">
                        {lifetimeData.map((item) => (
                            <div key={item.label}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{`${item.value.toLocaleString()} (${formatPercent(item.percentage)})`}</span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${item.percentage}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* High-Value Customer Segments */}
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">High-Value Customer Segments</h3>
                </div>
                <div className="space-y-3">
                    {highValueSegments.map((seg) => (
                        <div key={seg.label}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{seg.label}</span>
                                <span className="text-sm text-gray-900 dark:text-gray-100">{seg.customers.toLocaleString()} customers • {formatCurrency(seg.revenue)} revenue</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${seg.revenuePercentage}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Last Active Segments */}
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Calendar className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Last Active Segments</h3>
                </div>
                <div className="space-y-3">
                    {lastActiveSegments.map((seg) => (
                        <div key={seg.label}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{seg.label}</span>
                                <span className="text-sm text-gray-900 dark:text-gray-100">{seg.count.toLocaleString()} ({formatPercent(seg.percent)})</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${seg.percent}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Engagement by Tenure heatmap */}
            <EngagementByTenure subscribers={subscribers} dateRange={dateRange} customTo={customTo} />

            {/* Inactivity Revenue Drain (placed after Last Active Segments and heatmap) */}
            <InactivityRevenueDrain subscribers={subscribers} />

            {/* Dead Weight Audience & Potential Savings */}
            {deadWeight && (
                <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Trash2 className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Dead Weight Audience
                            <InfoTooltipIcon placement="top" content={(
                                <div>
                                    <p className="font-semibold mb-1">What</p>
                                    <p>People who never engaged or have been inactive for a long time and the cost impact.</p>
                                    <p className="font-semibold mt-2 mb-1">How</p>
                                    <p>We detect never active and long inactive profiles and estimate Klaviyo plan savings if suppressed.</p>
                                    <p className="font-semibold mt-2 mb-1">Why</p>
                                    <p>Try a light re engagement first. Then suppress to cut costs and protect deliverability.</p>
                                </div>
                            )} />
                        </h3>
                    </div>

                    {/* Summary */}
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div>
                            <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{deadWeight.combined.length.toLocaleString()}</p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Dead weight audience ({((deadWeight.combined.length / subscribers.length) * 100).toFixed(1)}% of list)</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Projected List After Purge</p>
                            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{(subscribers.length - deadWeight.combined.length).toLocaleString()}</p>
                        </div>
                    </div>

                    {/* Bar visualization */}
                    <div className="mt-6">
                        <div className="flex items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <span>Dead Weight</span>
                            <span>Total {subscribers.length.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${(deadWeight.combined.length / subscribers.length) * 100}%` }} />
                        </div>
                    </div>

                    {/* Savings */}
                    <div className="mt-8">
                        {deadWeight.combined.length === 0 ? (
                            <div className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                                <CheckCircle className="w-4 h-4 mt-0.5" />
                                <div>
                                    <p className="font-medium mb-1 text-green-800 dark:text-green-300">No dead‑weight detected</p>
                                    <p className="text-xs leading-relaxed text-green-700 dark:text-green-400">You’re not overpaying for your Klaviyo account. Good job!</p>
                                </div>
                            </div>
                        ) : deadWeight.currentPrice === null ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">Custom pricing tier (&gt; 250,000). Savings not calculated.</div>
                        ) : deadWeight.monthlySavings !== null && deadWeight.monthlySavings > 0 ? (
                            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <PiggyBank className="w-5 h-5 text-purple-600" />
                                        <h4 className="text-md font-semibold text-gray-900 dark:text-gray-100">Potential Savings</h4>
                                    </div>
                                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">${deadWeight.annualSavings!.toLocaleString('en-US', { minimumFractionDigits: 0 })}<span className="text-lg font-medium text-gray-500 dark:text-gray-400"> / yr</span></p>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{deadWeight.monthlySavings!.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })} per month</p>
                                </div>
                                <div className="grid grid-cols-2 gap-6 text-sm">
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400">Current Monthly</p>
                                        <p className="font-medium text-gray-900 dark:text-gray-100">{deadWeight.currentPrice !== null ? deadWeight.currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }) : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400">After Purge</p>
                                        <p className="font-medium text-gray-900 dark:text-gray-100">{deadWeight.newPrice !== null ? deadWeight.newPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }) : '—'}</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-gray-600 dark:text-gray-400">You’re not overpaying for your Klaviyo account. Good job!</div>
                        )}
                    </div>
                    {deadWeight && deadWeight.monthlySavings !== null && deadWeight.monthlySavings > 0 && (
                        <p className="mt-6 text-xs text-gray-500 dark:text-gray-500">Estimation only. Klaviyo pricing may change at any time; actual savings may vary.</p>
                    )}
                    <div className="mt-3">
                        <button
                            type="button"
                            onClick={() => setShowDeadWeightGuide(true)}
                            className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline"
                        >How to suppress dead-weight audience in Klaviyo?</button>
                    </div>
                    {showDeadWeightGuide && (
                        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeadWeightGuide(false)}></div>
                            <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-6 animate-fade-in">
                                <div className="flex items-start justify-between mb-4">
                                    <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                        <Trash2 className="w-5 h-5 text-purple-600" /> Suppress Dead‑Weight Audience
                                    </h4>
                                    <button onClick={() => setShowDeadWeightGuide(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Close">
                                        ✕
                                    </button>
                                </div>
                                <div className="space-y-6 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                                    <div>
                                        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Create two Klaviyo segments:</p>
                                        <div className="space-y-4">
                                            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                                <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-1">Segment 1</p>
                                                <p className="font-medium mb-2">Inactive but emailable for 90+ days</p>
                                                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                                    <li>Person can receive email marketing</li>
                                                    <li>AND Opened Email equals 0 times in the last 90 days</li>
                                                    <li>AND Clicked Email equals 0 times in the last 90 days</li>
                                                    <li>AND Created at least 90 days ago</li>
                                                </ul>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                                <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-1">Segment 2</p>
                                                <p className="font-medium mb-2">Never active and older than 30 days</p>
                                                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                                    <li>Person can receive email marketing</li>
                                                    <li>AND First Active is not set</li>
                                                    <li>AND Last Active is not set</li>
                                                    <li>AND Created at least 30 days ago</li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Then suppress both segments:</p>
                                        <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                            <li>Go to <span className="font-medium">Lists & Segments</span>.</li>
                                            <li>For each segment, click the three vertical dots.</li>
                                            <li>Select <span className="font-medium">“Suppress current members.”</span></li>
                                            <li>Confirm with <span className="font-medium">“Bulk suppress.”</span></li>
                                        </ol>
                                    </div>
                                    <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg p-4 text-xs text-purple-800 dark:text-purple-200">
                                        After suppression, Klaviyo usually adjusts billing automatically. If it doesn’t update, go to <span className="font-medium">Billing → Change plan</span> and select the plan matching your new active subscriber count.
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-500">Tip: Keep a short re‑engagement flow before suppressing to attempt last‑chance activation.</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
