"use client";
import React, { useMemo, useState } from 'react';
import SelectBase from "../ui/SelectBase";
import { Layers, Info } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { ProcessedCampaign } from '../../lib/data/dataTypes';

type BucketKey = '1' | '2' | '3' | '4+';

interface BucketAggregate {
    key: BucketKey;
    weeksCount: number;           // number of weeks in this bucket
    totalCampaigns: number;       // total campaigns across those weeks
    // Sums across all campaigns in bucket
    sumRevenue: number;
    sumEmails: number;
    sumOrders: number;
    sumOpens: number;
    sumClicks: number;
    sumUnsubs: number;
    sumSpam: number;
    sumBounces: number;
    // Per-week (averages) (computed lazily)
    avgWeeklyRevenue: number;
    avgWeeklyOrders: number;
    avgWeeklyEmails: number;
    // Per-campaign (averages)
    avgCampaignRevenue: number;
    avgCampaignOrders: number;
    avgCampaignEmails: number;
    // Weighted ratios (same regardless of mode)
    aov: number;
    revenuePerEmail: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    unsubscribeRate: number;
    spamRate: number;
    bounceRate: number;
}

interface Props {
    campaigns: ProcessedCampaign[];
}

const metricOptions = [
    { value: 'avgWeeklyRevenue', label: 'Avg Weekly Revenue', kind: 'currency', mode: 'week' },
    { value: 'avgCampaignRevenue', label: 'Avg Campaign Revenue', kind: 'currency', mode: 'campaign' },
    { value: 'aov', label: 'Average Order Value (AOV)', kind: 'currency' },
    { value: 'avgWeeklyOrders', label: 'Avg Weekly Orders', kind: 'number', mode: 'week' },
    { value: 'avgCampaignOrders', label: 'Avg Campaign Orders', kind: 'number', mode: 'campaign' },
    { value: 'avgWeeklyEmails', label: 'Avg Weekly Emails Sent', kind: 'number', mode: 'week' },
    { value: 'avgCampaignEmails', label: 'Avg Campaign Emails Sent', kind: 'number', mode: 'campaign' },
    { value: 'revenuePerEmail', label: 'Revenue per Email', kind: 'currency' },
    { value: 'openRate', label: 'Open Rate', kind: 'percent' },
    { value: 'clickRate', label: 'Click Rate', kind: 'percent' },
    { value: 'clickToOpenRate', label: 'Click-to-Open Rate', kind: 'percent' },
    { value: 'conversionRate', label: 'Conversion Rate', kind: 'percent' },
    { value: 'unsubscribeRate', label: 'Unsubscribe Rate', kind: 'percent' },
    { value: 'spamRate', label: 'Spam Rate', kind: 'percent' },
    { value: 'bounceRate', label: 'Bounce Rate', kind: 'percent' }
];

function formatCurrency(v: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
}
function formatPercent(v: number) { return `${(v || 0).toFixed(2)}%`; }
function formatNumber(v: number) { return v.toLocaleString('en-US', { maximumFractionDigits: 2 }); }

export default function CampaignSendFrequency({ campaigns }: Props) {
    const [mode, setMode] = useState<'week' | 'campaign'>('week');
    // Default metric for each mode
    const [metric, setMetric] = useState<string>('avgWeeklyRevenue');

    const buckets = useMemo<BucketAggregate[]>(() => {
        if (!campaigns.length) return [];

        // Helper: Monday of week
        const mondayOf = (d: Date) => {
            const n = new Date(d); n.setHours(0, 0, 0, 0);
            const day = n.getDay();
            const diff = n.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
            n.setDate(diff);
            return n;
        };

        interface WeekAgg { key: string; campaignCount: number; campaigns: ProcessedCampaign[]; }
        const weekMap = new Map<string, WeekAgg>();
        for (const c of campaigns) {
            if (!(c.sentDate instanceof Date) || isNaN(c.sentDate.getTime())) continue;
            const m = mondayOf(c.sentDate);
            const wk = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
            let agg = weekMap.get(wk);
            if (!agg) { agg = { key: wk, campaignCount: 0, campaigns: [] }; weekMap.set(wk, agg); }
            agg.campaignCount += 1;
            agg.campaigns.push(c);
        }

        const weekAggs = Array.from(weekMap.values());
        const bucketMap: Record<BucketKey, WeekAgg[]> = { '1': [], '2': [], '3': [], '4+': [] };
        for (const w of weekAggs) {
            if (w.campaignCount >= 4) bucketMap['4+'].push(w);
            else if (w.campaignCount === 3) bucketMap['3'].push(w);
            else if (w.campaignCount === 2) bucketMap['2'].push(w);
            else if (w.campaignCount === 1) bucketMap['1'].push(w);
        }

        const result: BucketAggregate[] = [];
        const pushBucket = (key: BucketKey, arr: WeekAgg[]) => {
            if (!arr.length) return; // hide empty bucket
            const weeksCount = arr.length;
            let sumRevenue = 0, sumEmails = 0, sumOrders = 0, sumOpens = 0, sumClicks = 0, sumUnsubs = 0, sumSpam = 0, sumBounces = 0, totalCampaigns = 0;
            arr.forEach(w => {
                totalCampaigns += w.campaignCount;
                w.campaigns.forEach(c => {
                    sumRevenue += c.revenue;
                    sumEmails += c.emailsSent;
                    sumOrders += c.totalOrders;
                    sumOpens += c.uniqueOpens;
                    sumClicks += c.uniqueClicks;
                    sumUnsubs += c.unsubscribesCount;
                    sumSpam += c.spamComplaintsCount;
                    sumBounces += c.bouncesCount;
                });
            });

            // Per-week averages
            const avgWeeklyRevenue = weeksCount > 0 ? sumRevenue / weeksCount : 0;
            const avgWeeklyOrders = weeksCount > 0 ? sumOrders / weeksCount : 0;
            const avgWeeklyEmails = weeksCount > 0 ? sumEmails / weeksCount : 0;
            // Per-campaign averages
            const avgCampaignRevenue = totalCampaigns > 0 ? sumRevenue / totalCampaigns : 0;
            const avgCampaignOrders = totalCampaigns > 0 ? sumOrders / totalCampaigns : 0;
            const avgCampaignEmails = totalCampaigns > 0 ? sumEmails / totalCampaigns : 0;
            // Weighted rates
            const aov = sumOrders > 0 ? sumRevenue / sumOrders : 0;
            const revenuePerEmail = sumEmails > 0 ? sumRevenue / sumEmails : 0;
            const openRate = sumEmails > 0 ? (sumOpens / sumEmails) * 100 : 0;
            const clickRate = sumEmails > 0 ? (sumClicks / sumEmails) * 100 : 0;
            const clickToOpenRate = sumOpens > 0 ? (sumClicks / sumOpens) * 100 : 0;
            const conversionRate = sumClicks > 0 ? (sumOrders / sumClicks) * 100 : 0;
            const unsubscribeRate = sumEmails > 0 ? (sumUnsubs / sumEmails) * 100 : 0;
            const spamRate = sumEmails > 0 ? (sumSpam / sumEmails) * 100 : 0;
            const bounceRate = sumEmails > 0 ? (sumBounces / sumEmails) * 100 : 0;

            result.push({ key, weeksCount, totalCampaigns, sumRevenue, sumEmails, sumOrders, sumOpens, sumClicks, sumUnsubs, sumSpam, sumBounces, avgWeeklyRevenue, avgWeeklyOrders, avgWeeklyEmails, avgCampaignRevenue, avgCampaignOrders, avgCampaignEmails, aov, revenuePerEmail, openRate, clickRate, clickToOpenRate, conversionRate, unsubscribeRate, spamRate, bounceRate });
        };

        pushBucket('1', bucketMap['1']);
        pushBucket('2', bucketMap['2']);
        pushBucket('3', bucketMap['3']);
        pushBucket('4+', bucketMap['4+']);
        return result;
    }, [campaigns]);

    // Adjust metric if switching modes and current metric not valid in new mode
    React.useEffect(() => {
        if (mode === 'week' && metric.startsWith('avgCampaign')) setMetric('avgWeeklyRevenue');
        if (mode === 'campaign' && metric.startsWith('avgWeekly')) setMetric('avgCampaignRevenue');
    }, [mode, metric]);

    if (!campaigns.length) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><Layers className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Send Frequency</h3></div>
                <p className="text-sm text-gray-600 dark:text-gray-400">No campaigns in the selected date range. Adjust the date filter to view frequency performance.</p>
            </div>
        );
    }
    if (!buckets.length) return null;

    const activeMetricOptions = metricOptions.filter(o => !o.mode || o.mode === (mode === 'week' ? 'week' : 'campaign'));
    const selectedMeta = activeMetricOptions.find(o => o.value === metric) || activeMetricOptions[0];
    const getValue = (b: BucketAggregate) => (b as any)[selectedMeta.value] as number;
    const maxVal = Math.max(...buckets.map(getValue), 0) || 1;

    const bucketLabel = (k: BucketKey) => ({ '1': '1 campaign / week', '2': '2 campaigns / week', '3': '3 campaigns / week', '4+': '4+ campaigns / week' }[k]);
    const formatVal = (v: number) => selectedMeta.kind === 'currency' ? formatCurrency(v) : selectedMeta.kind === 'percent' ? formatPercent(v) : formatNumber(v);

    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Send Frequency</h3>
                    <InfoTooltipIcon
                        placement="bottom-start"
                        content={(
                            <div className="w-80">
                                <p>Bars show averages across weeks grouped by how many campaigns were sent. Toggle to view averages per week or per campaign. Rates and efficiency metrics are weighted using total emails/events.</p>
                            </div>
                        )}
                    />
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <div className="flex items-center gap-1.5">
                        {(['week', 'campaign'] as const).map(m => (
                            <button key={m} onClick={() => setMode(m)} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${mode === m ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>{m === 'week' ? 'Per Week' : 'Per Campaign'}</button>
                        ))}
                    </div>
                    <div className="relative">
                        <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value)} className="pl-3 pr-8 py-2 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer">
                            {activeMetricOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </SelectBase>
                    </div>
                </div>
            </div>
            {/* description moved into tooltip above */}
            <div className={`grid gap-6 ${buckets.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' : buckets.length === 2 ? 'grid-cols-2 max-w-md mx-auto' : buckets.length === 3 ? 'grid-cols-3 max-w-3xl mx-auto' : 'grid-cols-2 md:grid-cols-4'}`}>
                {buckets.map(b => {
                    const val = getValue(b);
                    const heightPct = (val / maxVal) * 100;
                    return (
                        <div key={b.key} className="flex flex-col">
                            <div className="group relative flex-1 flex flex-col justify-end min-h-[160px]">
                                <div className="w-full relative bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden flex items-end" style={{ minHeight: '160px' }}>
                                    {/* subtle indigo-tinted backdrop */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-indigo-500/5 to-transparent pointer-events-none" />
                                    <div className="w-full rounded-t-lg bg-indigo-500 transition-all duration-500" style={{ height: `${heightPct}%` }} aria-label={`${bucketLabel(b.key)}: ${formatVal(val)}`} />
                                </div>
                                <div className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">{formatVal(val)}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">{bucketLabel(b.key)}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-500">{b.weeksCount} {b.weeksCount === 1 ? 'week' : 'weeks'}</div>
                                {/* Tooltip */}
                                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition z-10 absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                                    <div className="font-semibold mb-1">{bucketLabel(b.key)}</div>
                                    <ul className="space-y-0.5">
                                        <li><span className="text-gray-500 dark:text-gray-400">Weeks:</span> {b.weeksCount}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Campaigns:</span> {b.totalCampaigns}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Avg Weekly Revenue:</span> {formatCurrency(b.avgWeeklyRevenue)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Avg Campaign Revenue:</span> {formatCurrency(b.avgCampaignRevenue)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">AOV:</span> {formatCurrency(b.aov)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Rev / Email:</span> {formatCurrency(b.revenuePerEmail)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Open Rate:</span> {formatPercent(b.openRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Click Rate:</span> {formatPercent(b.clickRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">CTO Rate:</span> {formatPercent(b.clickToOpenRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Conversion:</span> {formatPercent(b.conversionRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Unsub Rate:</span> {formatPercent(b.unsubscribeRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Spam Rate:</span> {formatPercent(b.spamRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Bounce Rate:</span> {formatPercent(b.bounceRate)}</li>
                                    </ul>
                                    <div className="absolute left-1/2 bottom-0 translate-y-full -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-900 border-b border-r border-gray-200 dark:border-gray-700" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
