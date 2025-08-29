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

    const snap: any = state.data!;
    function fmt(n: number, opts: Intl.NumberFormatOptions = {}) { return new Intl.NumberFormat('en-US', opts).format(n); }
    const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(2)}%`;
    const money = (v: number) => fmt(v, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const makeSeries = (daily?: any[]) => daily?.map(p => ({ date: p.date, value: p.revenue })) || [];
    const makeRateSeries = (numer: keyof any, denom: keyof any, daily?: any[]) => (daily || []).map(p => ({ date: p.date, value: p[denom] ? (p[numer] / p[denom]) * 100 : 0 }));

    const calcChange = (current: number, previous?: number) => {
        if (previous == null || previous === 0) return 0;
        return ((current - previous) / previous) * 100;
    };
    const getPrevDerivedValue = (prev: any, key: string) => {
        if (!prev) return undefined;
        if (prev.derived && key in prev.derived) return prev.derived[key];
        if (prev.totals && key in prev.totals) return prev.totals[key];
        return undefined;
    };
    // Helper to build card props from a block (emailPerformance / campaignPerformance / flowPerformance)
    const buildCards = (block: any) => {
        if (!block) return [] as any[];
        const t = block.totals; const d = block.derived;
        const prev = block.previous;
        const daily = block.daily as any[] | undefined;
        return [
            { key: 'revenue', title: 'Total Revenue', value: money(t.revenue), prev: prev?.totals?.revenue, spark: makeSeries(daily) },
            { key: 'avgOrderValue', title: 'Average Order Value', value: money(d.avgOrderValue), prev: getPrevDerivedValue(prev, 'avgOrderValue'), spark: makeSeries(daily) },
            { key: 'totalOrders', title: 'Total Orders', value: fmt(t.totalOrders), prev: prev?.totals?.totalOrders, spark: (daily || []).map(p => ({ date: p.date, value: p.totalOrders })) },
            { key: 'conversionRate', title: 'Conversion Rate', value: pct(d.conversionRate), prev: getPrevDerivedValue(prev, 'conversionRate'), spark: makeRateSeries('totalOrders', 'uniqueClicks', daily) },
            { key: 'openRate', title: 'Open Rate', value: pct(d.openRate), prev: getPrevDerivedValue(prev, 'openRate'), spark: makeRateSeries('uniqueOpens', 'emailsSent', daily) },
            { key: 'clickRate', title: 'Click Rate', value: pct(d.clickRate), prev: getPrevDerivedValue(prev, 'clickRate'), spark: makeRateSeries('uniqueClicks', 'emailsSent', daily) },
            { key: 'clickToOpenRate', title: 'Click-to-Open Rate', value: pct(d.clickToOpenRate), prev: getPrevDerivedValue(prev, 'clickToOpenRate'), spark: makeRateSeries('uniqueClicks', 'uniqueOpens', daily) },
            { key: 'revenuePerEmail', title: 'Revenue per Email', value: money(d.revenuePerEmail), prev: getPrevDerivedValue(prev, 'revenuePerEmail'), spark: (daily || []).map(p => ({ date: p.date, value: p.emailsSent ? p.revenue / p.emailsSent : 0 })) },
            { key: 'emailsSent', title: 'Emails Sent', value: fmt(t.emailsSent), prev: prev?.totals?.emailsSent, spark: (daily || []).map(p => ({ date: p.date, value: p.emailsSent })) },
            { key: 'unsubscribeRate', title: 'Unsubscribe Rate', value: pct(d.unsubscribeRate), prev: getPrevDerivedValue(prev, 'unsubscribeRate'), spark: makeRateSeries('unsubscribes', 'emailsSent', daily) },
            { key: 'spamRate', title: 'Spam Rate', value: pct(d.spamRate), prev: getPrevDerivedValue(prev, 'spamRate'), spark: makeRateSeries('spamComplaints', 'emailsSent', daily) },
            { key: 'bounceRate', title: 'Bounce Rate', value: pct(d.bounceRate), prev: getPrevDerivedValue(prev, 'bounceRate'), spark: makeRateSeries('bounces', 'emailsSent', daily) },
        ].map(c => ({
            ...c,
            change: calcChange(
                (() => {
                    // Extract numeric portion from formatted value
                    const raw = c.value.replace(/[$,%]/g, '');
                    const num = parseFloat(raw);
                    return Number.isFinite(num) ? num : 0;
                })(),
                c.prev
            )
        }));
    };
    // Detect canonical bundle (schemaVersion=1) or legacy wrapper sharedBundle or legacy snapshot schema
    const canonical = snap.schemaVersion === 1 ? snap : (snap.sharedBundle && snap.sharedBundle.schemaVersion === 1 ? snap.sharedBundle : null);
    const bundle = canonical || snap.sharedBundle || null;
    const usingBundle = !!bundle;
    const dateRangeLabel = (() => {
        if (canonical) {
            const { start, end } = canonical.meta || {};
            if (!start || !end) return 'custom';
            const ms = new Date(end).getTime() - new Date(start).getTime();
            const days = Math.round(ms / 86400000) + 1; return days + 'd';
        }
        if (snap.meta?.dateRange?.start && snap.meta?.dateRange?.end) {
            const { start, end } = snap.meta.dateRange;
            const ms = new Date(end).getTime() - new Date(start).getTime();
            const days = Math.round(ms / 86400000) + 1; return days + 'd';
        }
        return 'custom';
    })();

    // Compute previous period date range if canonical bundle present (previous object lacks explicit range)
    function computePreviousRange(): { startDate: Date; endDate: Date } | undefined {
        if (!canonical) return undefined;
        const { start, end, compareMode } = canonical.meta || {} as any;
        if (!start || !end) return undefined;
        const startDate = new Date(start + 'T00:00:00');
        const endDate = new Date(end + 'T23:59:59');
        const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
        if (compareMode === 'prev-year') {
            const prevStart = new Date(startDate); prevStart.setFullYear(prevStart.getFullYear() - 1);
            const prevEnd = new Date(endDate); prevEnd.setFullYear(prevEnd.getFullYear() - 1);
            return { startDate: prevStart, endDate: prevEnd };
        }
        // default prev-period
        const prevEnd = new Date(startDate); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23, 59, 59, 999);
        const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1)); prevStart.setHours(0, 0, 0, 0);
        return { startDate: prevStart, endDate: prevEnd };
    }
    const canonicalPrevRange = computePreviousRange();
    const buildCardsFromBundle = (blk: any) => {
        if (!blk) return [];
        const t = blk.totals || {}; const d = blk.derived || {}; const prevT = blk.previous?.totals || {}; const prevD = blk.previous?.derived || {}; const daily = blk.daily || [];
        const changeMap = blk.changes || {};
        const series = (fn: (row: any) => number) => daily.map((r: any) => ({ date: r.date, value: fn(r) }));
        const defs: { key: string; label: string; kind: 'currency' | 'pct' | 'number'; current: number; prev: number | undefined; series: any[] }[] = [
            { key: 'revenue', label: 'Total Revenue', kind: 'currency', current: t.revenue || 0, prev: prevT.revenue, series: series(r => r.revenue || 0) },
            { key: 'avgOrderValue', label: 'Average Order Value', kind: 'currency', current: d.avgOrderValue || 0, prev: prevD.avgOrderValue, series: series(r => (r.totalOrders ? (r.revenue || 0) / r.totalOrders : 0)) },
            { key: 'totalOrders', label: 'Total Orders', kind: 'number', current: t.totalOrders || 0, prev: prevT.totalOrders, series: series(r => r.totalOrders || 0) },
            { key: 'conversionRate', label: 'Conversion Rate', kind: 'pct', current: d.conversionRate || 0, prev: prevD.conversionRate, series: series(r => (r.uniqueClicks ? (r.totalOrders || 0) / r.uniqueClicks * 100 : 0)) },
            { key: 'openRate', label: 'Open Rate', kind: 'pct', current: d.openRate || 0, prev: prevD.openRate, series: series(r => (r.emailsSent ? (r.uniqueOpens || 0) / r.emailsSent * 100 : 0)) },
            { key: 'clickRate', label: 'Click Rate', kind: 'pct', current: d.clickRate || 0, prev: prevD.clickRate, series: series(r => (r.emailsSent ? (r.uniqueClicks || 0) / r.emailsSent * 100 : 0)) },
            { key: 'clickToOpenRate', label: 'Click-to-Open Rate', kind: 'pct', current: d.clickToOpenRate || 0, prev: prevD.clickToOpenRate, series: series(r => (r.uniqueOpens ? (r.uniqueClicks || 0) / r.uniqueOpens * 100 : 0)) },
            { key: 'revenuePerEmail', label: 'Revenue per Email', kind: 'currency', current: d.revenuePerEmail || 0, prev: prevD.revenuePerEmail, series: series(r => (r.emailsSent ? (r.revenue || 0) / r.emailsSent : 0)) },
            { key: 'emailsSent', label: 'Emails Sent', kind: 'number', current: t.emailsSent || 0, prev: prevT.emailsSent, series: series(r => r.emailsSent || 0) },
            { key: 'unsubscribeRate', label: 'Unsubscribe Rate', kind: 'pct', current: d.unsubscribeRate || 0, prev: prevD.unsubscribeRate, series: series(r => (r.emailsSent ? (r.unsubscribes || 0) / r.emailsSent * 100 : 0)) },
            { key: 'spamRate', label: 'Spam Rate', kind: 'pct', current: d.spamRate || 0, prev: prevD.spamRate, series: series(r => (r.emailsSent ? (r.spamComplaints || 0) / r.emailsSent * 100 : 0)) },
            { key: 'bounceRate', label: 'Bounce Rate', kind: 'pct', current: d.bounceRate || 0, prev: prevD.bounceRate, series: series(r => (r.emailsSent ? (r.bounces || 0) / r.emailsSent * 100 : 0)) }
        ];
        return defs.map(m => ({
            key: m.key,
            title: m.label,
            value: m.kind === 'currency' ? money(m.current) : (m.kind === 'pct' ? pct(m.current) : fmt(m.current)),
            prev: m.prev,
            change: changeMap[m.key] != null ? changeMap[m.key] : (m.prev != null && m.prev !== 0 ? ((m.current - m.prev) / m.prev) * 100 : 0),
            spark: m.series
        }));
    };

    const emailPerfCards = usingBundle ? buildCardsFromBundle(bundle.emailPerformance) : buildCards(snap.emailPerformance);
    const campaignCards = usingBundle ? buildCardsFromBundle(bundle.campaignPerformance) : buildCards(snap.campaignPerformance);
    const flowCards = usingBundle ? buildCardsFromBundle(bundle.flowPerformance) : buildCards(snap.flowPerformance);

    return (
        <div className="space-y-10">
            {/* Email Performance Overview */}
            {emailPerfCards.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">✉️</span><h2 className="text-xl font-bold">Email Performance Overview</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {emailPerfCards.map(c => <MetricCard key={c.key} title={c.title} value={c.value} change={c.change || 0} isPositive={(c.change || 0) >= 0} previousValue={c.prev} previousPeriod={canonical ? canonicalPrevRange : (snap.emailPerformance?.previous?.range ? { startDate: new Date(snap.emailPerformance.previous.range.start), endDate: new Date(snap.emailPerformance.previous.range.end) } : undefined)} dateRange={dateRangeLabel} metricKey={c.key} sparklineData={c.spark} />)}
                    </div>
                </section>
            )}

            {/* Campaign Overview */}
            {campaignCards.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">📨</span><h2 className="text-xl font-bold">Campaign Overview</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {campaignCards.map(c => <MetricCard key={c.key} title={c.title} value={c.value} change={c.change || 0} isPositive={(c.change || 0) >= 0} previousValue={c.prev} previousPeriod={canonical ? canonicalPrevRange : (snap.campaignPerformance?.previous?.range ? { startDate: new Date(snap.campaignPerformance.previous.range.start), endDate: new Date(snap.campaignPerformance.previous.range.end) } : undefined)} dateRange={dateRangeLabel} metricKey={c.key} sparklineData={c.spark} />)}
                    </div>
                </section>
            )}

            {/* Flow Performance (all flows) */}
            {flowCards.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">⚡</span><h2 className="text-xl font-bold">Flow Performance</h2></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {flowCards.map(c => <MetricCard key={c.key} title={c.title} value={c.value} change={c.change || 0} isPositive={(c.change || 0) >= 0} previousValue={c.prev} previousPeriod={canonical ? canonicalPrevRange : (snap.flowPerformance?.previous?.range ? { startDate: new Date(snap.flowPerformance.previous.range.start), endDate: new Date(snap.flowPerformance.previous.range.end) } : undefined)} dateRange={dateRangeLabel} metricKey={c.key} sparklineData={c.spark} />)}
                    </div>
                </section>
            )}

            {/* Audience Overview */}
            {(usingBundle ? bundle.audienceOverview : snap.audienceOverview) && (
                <section>
                    <div className="flex items-center gap-2 mb-3"><span className="text-purple-600">👥</span><h2 className="text-xl font-bold">Audience Overview</h2></div>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">Total Subscribers</p><p className="text-2xl font-semibold">{fmt((usingBundle ? bundle.audienceOverview : snap.audienceOverview).totalSubscribers)}</p></div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">Subscribed</p><p className="text-2xl font-semibold">{fmt((usingBundle ? bundle.audienceOverview : snap.audienceOverview).subscribedCount)}</p></div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">Unsubscribed</p><p className="text-2xl font-semibold">{fmt((usingBundle ? bundle.audienceOverview : snap.audienceOverview).unsubscribedCount)}</p></div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800"><p className="text-xs uppercase text-gray-500 mb-1">% Subscribed</p><p className="text-2xl font-semibold">{pct((usingBundle ? bundle.audienceOverview : snap.audienceOverview).percentSubscribed)}</p></div>
                    </div>
                </section>
            )}
            <p className="text-[10px] text-gray-400 text-right">Snapshot window {canonical ? canonical.meta.start : (snap.meta?.dateRange?.start || '???')} → {canonical ? canonical.meta.end : (snap.meta?.dateRange?.end || '???')} • Generated {new Date((canonical ? canonical.meta.generatedAt : (snap.meta?.generatedAt || Date.now()))).toLocaleString()}</p>
        </div>
    );
}
