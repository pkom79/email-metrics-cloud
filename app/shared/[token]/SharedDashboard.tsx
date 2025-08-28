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
    const dateRangeLabel = `${snap.meta.dateRange.start} → ${snap.meta.dateRange.end}`;

    function fmt(n: number, opts: Intl.NumberFormatOptions = {}) { return new Intl.NumberFormat('en-US', opts).format(n); }
    const pct = (v: number) => `${v.toFixed(1)}%`;
    const money = (v: number) => fmt(v, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const cards: Array<{ key: string; title: string; value: string; isPct?: boolean; }> = [];
    if (snap.emailPerformance) {
        const t = snap.emailPerformance.totals; const d = snap.emailPerformance.derived;
        cards.push(
            { key: 'revenue', title: 'Total Revenue', value: money(t.revenue) },
            { key: 'avgOrderValue', title: 'Avg Order Value', value: money(d.avgOrderValue) },
            { key: 'emailsSent', title: 'Emails Sent', value: fmt(t.emailsSent) },
            { key: 'totalOrders', title: 'Total Orders', value: fmt(t.totalOrders) },
            { key: 'openRate', title: 'Open Rate', value: pct(d.openRate) },
            { key: 'clickRate', title: 'Click Rate', value: pct(d.clickRate) },
            { key: 'clickToOpenRate', title: 'Click-To-Open', value: pct(d.clickToOpenRate) },
            { key: 'conversionRate', title: 'Conversion Rate', value: pct(d.conversionRate) },
            { key: 'revenuePerEmail', title: 'Revenue / Email', value: money(d.revenuePerEmail) },
            { key: 'unsubscribeRate', title: 'Unsub Rate', value: pct(d.unsubscribeRate) },
            { key: 'spamRate', title: 'Spam Rate', value: pct(d.spamRate) },
            { key: 'bounceRate', title: 'Bounce Rate', value: pct(d.bounceRate) },
        );
    }

    return (
        <div className="space-y-10">
            {/* Audience Overview */}
            {snap.audienceOverview && (
                <section>
                    <h3 className="text-lg font-semibold mb-4">Audience Overview</h3>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700">
                            <p className="text-xs uppercase text-gray-500 mb-1">Total Subscribers</p>
                            <p className="text-xl font-semibold">{fmt(snap.audienceOverview.totalSubscribers)}</p>
                        </div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700">
                            <p className="text-xs uppercase text-gray-500 mb-1">Subscribed</p>
                            <p className="text-xl font-semibold">{fmt(snap.audienceOverview.subscribedCount)}</p>
                        </div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700">
                            <p className="text-xs uppercase text-gray-500 mb-1">Unsubscribed</p>
                            <p className="text-xl font-semibold">{fmt(snap.audienceOverview.unsubscribedCount)}</p>
                        </div>
                        <div className="p-4 rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700">
                            <p className="text-xs uppercase text-gray-500 mb-1">% Subscribed</p>
                            <p className="text-xl font-semibold">{pct(snap.audienceOverview.percentSubscribed)}</p>
                        </div>
                    </div>
                </section>
            )}

            {/* Email Performance Cards */}
            {cards.length > 0 && (
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Email Performance</h3>
                        <span className="text-xs text-gray-500">{dateRangeLabel}</span>
                    </div>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                        {cards.map(c => (
                            <MetricCard key={c.key} title={c.title} value={c.value} change={0} isPositive={true} dateRange={snap.meta.dateRange.start} />
                        ))}
                    </div>
                </section>
            )}

            {/* Flows */}
            {snap.flows && (
                <section>
                    <h3 className="text-lg font-semibold mb-3">Flows</h3>
                    <div className="overflow-x-auto border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Flow</th>
                                    <th className="px-3 py-2 text-right font-medium">Emails</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snap.flows.flowNames.slice(0, 25).map(f => (
                                    <tr key={f.name} className="border-t dark:border-gray-800">
                                        <td className="px-3 py-1.5 whitespace-nowrap max-w-xs truncate">{f.name}</td>
                                        <td className="px-3 py-1.5 text-right">{fmt(f.emails)}</td>
                                        <td className="px-3 py-1.5 text-right">{money(f.revenue)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Campaigns */}
            {snap.campaigns && (
                <section>
                    <h3 className="text-lg font-semibold mb-3">Top Campaigns (by Revenue)</h3>
                    <div className="overflow-x-auto border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Campaign</th>
                                    <th className="px-3 py-2 text-right font-medium">Emails Sent</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snap.campaigns.topByRevenue.map(c => (
                                    <tr key={c.name} className="border-t dark:border-gray-800">
                                        <td className="px-3 py-1.5 whitespace-nowrap max-w-xs truncate">{c.name}</td>
                                        <td className="px-3 py-1.5 text-right">{fmt(c.emailsSent)}</td>
                                        <td className="px-3 py-1.5 text-right">{money(c.revenue)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Day of Week & Hour */}
            {(snap.dow || snap.hour) && (
                <section className="grid gap-6 md:grid-cols-2">
                    {snap.dow && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3">Performance by Day of Week</h3>
                            <div className="overflow-x-auto border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium">Day</th>
                                            <th className="px-3 py-2 text-right font-medium">Emails</th>
                                            <th className="px-3 py-2 text-right font-medium">Orders</th>
                                            <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {snap.dow.map(r => (
                                            <tr key={r.dow} className="border-t dark:border-gray-800">
                                                <td className="px-3 py-1.5">{"SunMonTueWedThuFriSat".slice(r.dow * 3, r.dow * 3 + 3)}</td>
                                                <td className="px-3 py-1.5 text-right">{fmt(r.emailsSent)}</td>
                                                <td className="px-3 py-1.5 text-right">{fmt(r.orders)}</td>
                                                <td className="px-3 py-1.5 text-right">{money(r.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {snap.hour && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3">Performance by Hour</h3>
                            <div className="overflow-x-auto border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700 max-h-96">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium">Hour</th>
                                            <th className="px-3 py-2 text-right font-medium">Emails</th>
                                            <th className="px-3 py-2 text-right font-medium">Orders</th>
                                            <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {snap.hour.map(r => (
                                            <tr key={r.hour} className="border-t dark:border-gray-800">
                                                <td className="px-3 py-1.5">{r.hour}:00</td>
                                                <td className="px-3 py-1.5 text-right">{fmt(r.emailsSent)}</td>
                                                <td className="px-3 py-1.5 text-right">{fmt(r.orders)}</td>
                                                <td className="px-3 py-1.5 text-right">{money(r.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>
            )}

            <p className="text-[10px] text-gray-400 text-right">Snapshot generated {new Date(snap.meta.generatedAt).toLocaleString()}</p>
        </div>
    );
}
