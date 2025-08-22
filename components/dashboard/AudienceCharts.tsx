"use client";
import React from 'react';
import { Users, UserCheck, DollarSign, TrendingUp, Calendar, AlertCircle } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

export default function AudienceCharts() {
    const dataManager = DataManager.getInstance();
    const audienceInsights = dataManager.getAudienceInsights();
    const subscribers = dataManager.getSubscribers();
    const hasData = subscribers.length > 0;

    const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    const formatPercent = (value: number) => `${value.toFixed(1)}%`;

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
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Subscribers</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{audienceInsights.totalSubscribers.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <UserCheck className="w-5 h-5 text-purple-600" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Buyers</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{audienceInsights.buyerCount.toLocaleString()}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{`${(audienceInsights.buyerPercentage || 0).toFixed(1)}% of total`}</p>
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
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Subscriber Lifetime</h3>
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
        </section>
    );
}
