"use client";

import { useState, useEffect } from 'react';
import type { SnapshotJSON } from '../../../lib/snapshotBuilder';
import MetricCard from '../../../components/dashboard/MetricCard';

interface SharedDashboardProps { snapshotId: string; shareTitle: string; shareDescription: string | null; lastEmailDate: string; shareToken: string; }

type State = { loading: true; data?: undefined; error?: undefined } | { loading: false; data: SnapshotJSON; error?: undefined } | { loading: false; data?: undefined; error: string };

export default function SharedDashboard({ snapshotId, shareTitle, shareDescription, lastEmailDate, shareToken }: SharedDashboardProps) {
    const [state, setState] = useState<State>({ loading: true });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setState({ loading: true });
                const res = await fetch(`/api/shared/${shareToken}/data`, { cache: 'no-store' });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    if (!cancelled) setState({ loading: false, error: body.error || `Request failed (${res.status})` });
                    return;
                }
                const json: SnapshotJSON = await res.json();
                if (!cancelled) setState({ loading: false, data: json });
            } catch (e: any) {
                if (!cancelled) setState({ loading: false, error: String(e?.message || e) });
            }
        })();
        return () => { cancelled = true; };
    }, [shareToken]);

    if (state.loading) {
        return (
            <div className="py-16 flex justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Building snapshot…</p>
                </div>
            </div>
        );
    }
    if (state.error) {
        return (
            <div className="py-16 flex justify-center">
                <div className="max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow">
                    <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Unable to load snapshot</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{state.error}</p>
                    <p className="text-xs text-gray-500">If this persists the share may be expired or data files are missing.</p>
                </div>
            </div>
        );
    }

    const snap = state.data!;
    function fmt(n: number, opts: Intl.NumberFormatOptions = {}) { return new Intl.NumberFormat('en-US', opts).format(n); }
    const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(2)}%`;
    const money = (v: number) => fmt(v, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const makeSeries = (daily?: any[]) => daily?.map(p => ({ date: p.date, value: p.revenue })) || [];
    const makeRateSeries = (numer: keyof any, denom: keyof any, daily?: any[]) => (daily || []).map(p => ({ date: p.date, value: p[denom] ? (p[numer] / p[denom]) * 100 : 0 }));
    // Helper to build card props from a block (emailPerformance / campaignPerformance / flowPerformance)
    const buildCards = (block: any) => {
        if (!block) return [] as any[];
        const t = block.totals; const d = block.derived;
        const daily = block.daily as any[] | undefined;
        return [
            { key: 'revenue', title: 'Total Revenue', value: money(t.revenue), spark: makeSeries(daily) },
            { key: 'avgOrderValue', title: 'Average Order Value', value: money(d.avgOrderValue), spark: makeSeries(daily) },
            { key: 'totalOrders', title: 'Total Orders', value: fmt(t.totalOrders), spark: (daily || []).map(p => ({ date: p.date, value: p.totalOrders })) },
            { key: 'conversionRate', title: 'Conversion Rate', value: pct(d.conversionRate), spark: makeRateSeries('totalOrders', 'uniqueClicks', daily) },
            { key: 'openRate', title: 'Open Rate', value: pct(d.openRate), spark: makeRateSeries('uniqueOpens', 'emailsSent', daily) },
            { key: 'clickRate', title: 'Click Rate', value: pct(d.clickRate), spark: makeRateSeries('uniqueClicks', 'emailsSent', daily) },
            { key: 'clickToOpenRate', title: 'Click-to-Open Rate', value: pct(d.clickToOpenRate), spark: makeRateSeries('uniqueClicks', 'uniqueOpens', daily) },
            { key: 'revenuePerEmail', title: 'Revenue per Email', value: money(d.revenuePerEmail), spark: (daily || []).map(p => ({ date: p.date, value: p.emailsSent ? p.revenue / p.emailsSent : 0 })) },
            { key: 'emailsSent', title: 'Emails Sent', value: fmt(t.emailsSent), spark: (daily || []).map(p => ({ date: p.date, value: p.emailsSent })) },
            { key: 'unsubscribeRate', title: 'Unsubscribe Rate', value: pct(d.unsubscribeRate), spark: makeRateSeries('unsubscribes', 'emailsSent', daily) },
            { key: 'spamRate', title: 'Spam Rate', value: pct(d.spamRate), spark: makeRateSeries('spamComplaints', 'emailsSent', daily) },
            { key: 'bounceRate', title: 'Bounce Rate', value: pct(d.bounceRate), spark: makeRateSeries('bounces', 'emailsSent', daily) },
        ];
    };
    const emailPerfCards = buildCards(snap.emailPerformance);
    const campaignCards = buildCards(snap.campaignPerformance);
    const flowCards = buildCards(snap.flowPerformance);

    return (
        <div className="space-y-10">
            {/* Email Performance Overview */}
            {emailPerfCards.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">✉️</span><h2 className="text-xl font-bold">Email Performance Overview</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {emailPerfCards.map(c => <MetricCard key={c.key} title={c.title} value={c.value} change={0} isPositive={true} dateRange={'30d'} metricKey={c.key} sparklineData={c.spark} />)}
                    </div>
                </section>
            )}

            {/* Campaign Overview */}
            {campaignCards.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">📨</span><h2 className="text-xl font-bold">Campaign Overview</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {campaignCards.map(c => <MetricCard key={c.key} title={c.title} value={c.value} change={0} isPositive={true} dateRange={'30d'} metricKey={c.key} sparklineData={c.spark} />)}
                    </div>
                </section>
            )}

            {/* Flow Performance (all flows) */}
            {flowCards.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">⚡</span><h2 className="text-xl font-bold">Flow Performance</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {flowCards.map(c => <MetricCard key={c.key} title={c.title} value={c.value} change={0} isPositive={true} dateRange={'30d'} metricKey={c.key} sparklineData={c.spark} />)}
                    </div>
                </section>
            )}

            {/* Audience Overview */}
            {snap.audienceOverview && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">👥</span><h2 className="text-xl font-bold">Audience Overview</h2></div>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">Total Subscribers</p><p className="text-2xl font-semibold">{fmt(snap.audienceOverview.totalSubscribers)}</p></div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">Subscribed</p><p className="text-2xl font-semibold">{fmt(snap.audienceOverview.subscribedCount)}</p></div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">Unsubscribed</p><p className="text-2xl font-semibold">{fmt(snap.audienceOverview.unsubscribedCount)}</p></div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">% Subscribed</p><p className="text-2xl font-semibold">{pct(snap.audienceOverview.percentSubscribed)}</p></div>
                    </div>
                </section>
            )}

            <p className="text-[10px] text-gray-400 text-right">Snapshot generated {new Date(snap.meta.generatedAt).toLocaleString()}</p>
        </div>
    );
}
