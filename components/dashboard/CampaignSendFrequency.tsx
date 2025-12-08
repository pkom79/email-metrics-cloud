"use client";
import React, { useMemo, useState } from 'react';
import SelectBase from "../ui/SelectBase";
import { CalendarDays } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import { ProcessedCampaign } from '../../lib/data/dataTypes';
import {
    computeCampaignSendFrequency,
    computeSendFrequencyGuidance,
    type FrequencyBucketAggregate,
    type FrequencyBucketKey,
    labelForFrequencyBucket,
    type SendFrequencyGuidanceResult,
} from '../../lib/analytics/campaignSendFrequency';

type BucketKey = FrequencyBucketKey;
type BucketAggregate = FrequencyBucketAggregate;
type GuidanceResult = SendFrequencyGuidanceResult;

interface Props {
    campaigns: ProcessedCampaign[];
    allCampaigns?: ProcessedCampaign[];
    onGuidance?: (g: GuidanceResult | null) => void;
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

export default function CampaignSendFrequency({ campaigns, allCampaigns, onGuidance }: Props) {
    const [mode, setMode] = useState<'week' | 'campaign'>('week');
    // Default metric for each mode
    const [metric, setMetric] = useState<string>('avgWeeklyRevenue');

    const { buckets, dataContext } = useMemo(() => computeCampaignSendFrequency(campaigns, allCampaigns), [campaigns, allCampaigns]);

    // Adjust metric if switching modes and current metric not valid in new mode
    React.useEffect(() => {
        if (mode === 'week' && metric.startsWith('avgCampaign')) setMetric('avgWeeklyRevenue');
        if (mode === 'campaign' && metric.startsWith('avgWeekly')) setMetric('avgCampaignRevenue');
    }, [mode, metric]);

    const guidance = useMemo<GuidanceResult | null>(() => computeSendFrequencyGuidance(buckets, mode), [buckets, mode]);

    React.useEffect(() => {
        if (onGuidance) onGuidance(guidance);
    }, [guidance, onGuidance]);

    if (!campaigns.length) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><CalendarDays className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Send Frequency Optimization</h3></div>
                <p className="text-sm text-gray-600 dark:text-gray-400">No campaigns in the selected date range. Adjust the date filter to view frequency performance.</p>
            </div>
        );
    }
    if (!buckets.length) return null;

    const activeMetricOptions = metricOptions.filter(o => !o.mode || o.mode === (mode === 'week' ? 'week' : 'campaign'));
    const selectedMeta = activeMetricOptions.find(o => o.value === metric) || activeMetricOptions[0];
    const getValue = (b: BucketAggregate) => (b as any)[selectedMeta.value] as number;
    const maxVal = Math.max(...buckets.map(getValue), 0) || 1;

    const bucketLabel = (k: BucketKey) => labelForFrequencyBucket(k);
    const formatVal = (v: number) => selectedMeta.kind === 'currency' ? formatCurrency(v) : selectedMeta.kind === 'percent' ? formatPercent(v) : formatNumber(v);
    const optimalDays = dataContext.optimalCapDays;
    const currentDays = dataContext.selectedRangeDays;
    const hasOptimalWindow = optimalDays > 0;
    const isOptimalRange = hasOptimalWindow && currentDays >= optimalDays * 0.9 && currentDays <= optimalDays * 1.1;

    // Dynamic grid layout based on number of buckets
    const gridClass = buckets.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' :
        buckets.length === 2 ? 'grid-cols-2 max-w-md mx-auto' :
            buckets.length === 3 ? 'grid-cols-3 max-w-3xl mx-auto' :
                buckets.length === 4 ? 'grid-cols-2 md:grid-cols-4' :
                    'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'; // Wrap for > 4

    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Send Frequency Optimization</h3>
                    <InfoTooltipIcon
                        placement="bottom-start"
                        content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>How results change as you send more or fewer campaigns in a week.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>We group weeks by the number of campaigns sent and show averages. Use the toggle to switch between per week and per campaign views. Rates are weighted by total emails and events.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Find your sweet spot. If more sending doesn&apos;t improve revenue per email or lifts unsub/spam, pull back. If results hold steady, a higher cadence may be safe.</p>
                            </div>
                        )}
                    />
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 mr-1">View:</span>
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
            <div className={`grid gap-6 ${gridClass}`}>
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
            {guidance && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4 mt-6">
                    {/* Optimal Lookback Recommendation - Show banner if not optimal */}
                    {hasOptimalWindow && !isOptimalRange && (
                        <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                            For optimal accuracy, we recommend analyzing the last {optimalDays} days based on your account&apos;s volume.
                        </div>
                    )}

                    {/* Insufficient Data Banner - Only if optimal range is selected but still insufficient */}
                    {isOptimalRange && guidance.status === 'insufficient' && (
                        <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                            {guidance.message}
                        </div>
                    )}

                    {/* Only show Action Notes and Recommendations if optimal AND sufficient */}
                    {isOptimalRange && guidance.status !== 'insufficient' && (
                        <>
                            <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{guidance.title}</p>
                            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{guidance.message}</p>

                            {hasOptimalWindow && (
                                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 italic">
                                    ✓ You're analyzing the optimal date range ({optimalDays} days) for your account.
                                </p>
                            )}

                            {/* Revenue Opportunity Projection */}
                            {guidance.estimatedMonthlyGain != null && guidance.estimatedMonthlyGain > 0 && (
                                <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                                    <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
                                        Revenue Opportunity Projection
                                    </div>
                                    <div className="text-sm text-emerald-800 dark:text-emerald-200">
                                        Optimizing send frequency could generate an estimated {formatCurrency(guidance.estimatedMonthlyGain)} increase in monthly revenue.
                                    </div>
                                    <div className="mt-1 text-xs text-emerald-800 dark:text-emerald-200/80">
                                        Current monthly revenue over the last {optimalDays} days: {formatCurrency(guidance.totalMonthlyRevenue ?? 0)}
                                    </div>
                                </div>
                            )}

                            {guidance.sample && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{guidance.sample}</p>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
