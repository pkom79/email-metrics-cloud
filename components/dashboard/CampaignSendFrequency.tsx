"use client";
import React, { useMemo, useState } from 'react';
import SelectBase from "../ui/SelectBase";
import { CalendarDays } from 'lucide-react';
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

type GuidanceStatus = 'send-more' | 'keep-as-is' | 'send-less' | 'insufficient';

interface GuidanceResult {
    status: GuidanceStatus;
    cadenceLabel: string;
    title: string;
    message: string;
    sample: string | null;
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

    const guidance = useMemo(() => computeSendFrequencyGuidance(buckets, mode), [buckets, mode]);

    if (!campaigns.length) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><CalendarDays className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Send Frequency</h3></div>
                <p className="text-sm text-gray-600 dark:text-gray-400">No campaigns in the selected date range. Adjust the date filter to view frequency performance.</p>
            </div>
        );
    }
    if (!buckets.length) return null;

    const activeMetricOptions = metricOptions.filter(o => !o.mode || o.mode === (mode === 'week' ? 'week' : 'campaign'));
    const selectedMeta = activeMetricOptions.find(o => o.value === metric) || activeMetricOptions[0];
    const getValue = (b: BucketAggregate) => (b as any)[selectedMeta.value] as number;
    const maxVal = Math.max(...buckets.map(getValue), 0) || 1;

    const bucketLabel = (k: BucketKey) => labelForBucket(k);
    const formatVal = (v: number) => selectedMeta.kind === 'currency' ? formatCurrency(v) : selectedMeta.kind === 'percent' ? formatPercent(v) : formatNumber(v);

    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Send Frequency</h3>
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
            {guidance && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4 mb-6">
                    <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{guidance.title}</p>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{guidance.message}</p>
                    {guidance.sample && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{guidance.sample}</p>}
                </div>
            )}
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

const MIN_WEEKS = 4;
const MIN_EMAILS = 1000;
const VARIATION_WEEKS_THRESHOLD = 8;
const LIFT_THRESHOLD = 0.1;
const NEG_LIFT_THRESHOLD = -0.1;
const ENGAGEMENT_DROP_LIMIT = -0.05;
const SPAM_DELTA_LIMIT = 0.05;
const BOUNCE_DELTA_LIMIT = 0.1;
const HIGH_SPAM_ALERT = 0.3;
const HIGH_BOUNCE_ALERT = 0.5;
const OPEN_HEALTHY_MIN = 12;
const CLICK_HEALTHY_MIN = 1;
const UNSUB_WARN = 0.5;
const SPAM_WARN = 0.15;
const BOUNCE_WARN = 0.5;

function computeSendFrequencyGuidance(buckets: BucketAggregate[], mode: 'week' | 'campaign'): GuidanceResult | null {
    if (!buckets.length) return null;

    const eligible = buckets.filter(b => b.weeksCount >= MIN_WEEKS && b.sumEmails >= MIN_EMAILS);
    const orderMap: Record<BucketKey, number> = { '1': 1, '2': 2, '3': 3, '4+': 4 };

    const metricKey = mode === 'week' ? 'avgWeeklyRevenue' : 'avgCampaignRevenue';
    const getRevenueValue = (b: BucketAggregate) => (b as any)[metricKey] as number;
    const totalWeeksAll = buckets.reduce((sum, b) => sum + b.weeksCount, 0);

    const formatSample = (overrideWeeks?: number, a?: BucketAggregate | null, b?: BucketAggregate | null) => {
        const weeks = overrideWeeks ?? ((a?.weeksCount ?? 0) + (b?.weeksCount ?? 0));
        if (weeks <= 0) return null;
        return `Based on ${weeks} ${pluralize('week', weeks)} of campaign data.`;
    };

    const pickBaseline = (): BucketAggregate | null => {
        if (!eligible.length) return null;
        const sorted = [...eligible].sort((a, b) => {
            if (b.weeksCount !== a.weeksCount) return b.weeksCount - a.weeksCount;
            const revDiff = getRevenueValue(b) - getRevenueValue(a);
            if (Math.abs(revDiff) > 1e-6) return revDiff > 0 ? 1 : -1;
            return orderMap[a.key] - orderMap[b.key];
        });
        return sorted[0] || null;
    };

    const baseline = pickBaseline();
    const baselineLabel = baseline ? labelForBucket(baseline.key) : null;
    const baselineAction = baseline ? actionLabelForBucket(baseline.key) : null;

    if (!baseline) {
        const richest = buckets.reduce((best, curr) => (curr.weeksCount > (best?.weeksCount ?? 0) ? curr : best), null as BucketAggregate | null);
        const cadenceLabel = richest ? labelForBucket(richest.key) : 'current cadence';
        const hasWeeksButLowVolume = buckets.some(b => b.weeksCount >= MIN_WEEKS && b.sumEmails < MIN_EMAILS);
        let message: string;
        if (totalWeeksAll < MIN_WEEKS) {
            if (totalWeeksAll === 0) message = 'No complete campaign weeks fall inside this date range yet. Expand the window or keep sending to unlock guidance.';
            else message = `This date range includes only ${totalWeeksAll} ${pluralize('week', totalWeeksAll)} of campaign data. Expand the range or keep sending before changing cadence.`;
        } else if (hasWeeksButLowVolume) {
            message = `Each cadence ran with fewer than ${MIN_EMAILS.toLocaleString()} emails. Run larger sends at ${cadenceLabel} to measure impact confidently.`;
        } else {
            message = 'Cadence tests were too short to compare. Extend each cadence for at least four weeks before making frequency changes.';
        }
        return { status: 'insufficient', cadenceLabel, title: 'Not enough data for a recommendation', message, sample: formatSample(totalWeeksAll) };
    }

    const higher = eligible.filter(b => orderMap[b.key] > orderMap[baseline.key]).sort((a, b) => orderMap[a.key] - orderMap[b.key]);
    const lower = eligible.filter(b => orderMap[b.key] < orderMap[baseline.key]).sort((a, b) => orderMap[b.key] - orderMap[a.key]);

    const baselineRevenue = getRevenueValue(baseline);
    const acceptance = (candidate: BucketAggregate) => {
        const candidateRevenue = getRevenueValue(candidate);
        const lift = baselineRevenue === 0 ? (candidateRevenue > 0 ? Infinity : 0) : (candidateRevenue - baselineRevenue) / baselineRevenue;
        const openDelta = deltaRatio(candidate.openRate, baseline.openRate);
        const clickDelta = deltaRatio(candidate.clickRate, baseline.clickRate);
        const spamDelta = candidate.spamRate - baseline.spamRate;
        const bounceDelta = candidate.bounceRate - baseline.bounceRate;
        return { lift, openDelta, clickDelta, spamDelta, bounceDelta, candidateRevenue };
    };

    for (const candidate of higher) {
        const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = acceptance(candidate);
        const engagementSafe = openDelta >= ENGAGEMENT_DROP_LIMIT && clickDelta >= ENGAGEMENT_DROP_LIMIT;
        const riskSafe = spamDelta <= SPAM_DELTA_LIMIT && bounceDelta <= BOUNCE_DELTA_LIMIT;
        if (lift >= LIFT_THRESHOLD && engagementSafe && riskSafe) {
            const title = `Send ${actionLabelForBucket(candidate.key)}`;
            const liftPct = lift === Infinity ? 'from zero' : formatPct(lift);
            const msg = lift === Infinity
                ? `${labelForBucket(candidate.key)} has revenue where ${baselineLabel ?? 'your current cadence'} does not. Scale testing into this cadence while monitoring engagement.`
                : `${labelForBucket(candidate.key)} weeks delivered ${liftPct} more weekly revenue than ${baselineLabel}. Open and click rates stayed within 5% and spam/bounce remained under guardrails, so increase cadence toward this level.`;
            const sample = formatSample(undefined, candidate, baseline);
            return { status: 'send-more', cadenceLabel: labelForBucket(candidate.key), title, message: msg, sample };
        }
    }

    const exploratoryHigher = buckets.filter(b => orderMap[b.key] > orderMap[baseline.key] && (b.weeksCount > 0 || b.sumEmails > 0) && !eligible.includes(b));
    for (const candidate of exploratoryHigher) {
        const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = acceptance(candidate);
        const engagementSafe = openDelta >= ENGAGEMENT_DROP_LIMIT && clickDelta >= ENGAGEMENT_DROP_LIMIT;
        const riskSafe = spamDelta <= SPAM_DELTA_LIMIT && bounceDelta <= BOUNCE_DELTA_LIMIT;
        if (lift >= LIFT_THRESHOLD && engagementSafe && riskSafe) {
            const title = `Test ${actionLabelForBucket(candidate.key)}`;
            const liftPct = lift === Infinity ? 'from zero' : formatPct(lift);
            const limitedWeeks = candidate.weeksCount;
            const limitedCopy = limitedWeeks > 0 ? `${limitedWeeks} ${pluralize('week', limitedWeeks)} of ${labelForBucket(candidate.key)} data` : `${labelForBucket(candidate.key)} tests so far`;
            const msg = `${limitedCopy} show ${liftPct} higher weekly revenue than ${baselineLabel}. Schedule a four-week test at this cadence and keep an eye on engagement.`;
            const sample = formatSample(undefined, candidate, baseline);
            return { status: 'send-more', cadenceLabel: labelForBucket(candidate.key), title, message: msg, sample };
        }
    }

    const riskyBaseline = baseline.spamRate >= HIGH_SPAM_ALERT || baseline.bounceRate >= HIGH_BOUNCE_ALERT;

    for (const candidate of lower) {
        const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = acceptance(candidate);
        const lessRisk = spamDelta < -SPAM_DELTA_LIMIT || bounceDelta < -BOUNCE_DELTA_LIMIT || riskyBaseline;
        const revenueOkay = lift >= NEG_LIFT_THRESHOLD;
        if (lessRisk && revenueOkay) {
            const title = `Send ${actionLabelForBucket(candidate.key)}`;
            const msg = `${baselineLabel} shows rising risk (spam or bounce). Drop back to ${labelForBucket(candidate.key)} to stabilize engagement while keeping revenue within 10% of current results.`;
            const sample = formatSample(undefined, baseline, candidate);
            return { status: 'send-less', cadenceLabel: labelForBucket(candidate.key), title, message: msg, sample };
        }
        if (lift >= LIFT_THRESHOLD) {
            const title = `Send ${actionLabelForBucket(candidate.key)}`;
            const msg = `${baselineLabel} underperforms ${labelForBucket(candidate.key)} by ${formatPct(lift)}. Shift down to recover revenue and reduce fatigue.`;
            const sample = formatSample(undefined, baseline, candidate);
            return { status: 'send-less', cadenceLabel: labelForBucket(candidate.key), title, message: msg, sample };
        }
    }

    const onlyBucket = eligible.length === 1 && higher.length === 0 && lower.length === 0;
    if (onlyBucket) {
        const healthy = baselineRevenue > 0 && baseline.spamRate < HIGH_SPAM_ALERT && baseline.bounceRate < HIGH_BOUNCE_ALERT && baseline.openRate >= OPEN_HEALTHY_MIN && baseline.clickRate >= CLICK_HEALTHY_MIN;
        const issueSummary = describeIssues(baseline, baselineRevenue);
        const weeksAtCadence = baseline.weeksCount;
        if (healthy && orderMap[baseline.key] < 4) {
            const nextKey = ['1', '2', '3', '4+'][orderMap[baseline.key]] as BucketKey | undefined;
            const nextLabel = nextKey ? labelForBucket(nextKey) : 'a higher cadence';
            const title = `Test ${nextKey ? actionLabelForBucket(nextKey) : 'a higher cadence'}`;
            const msg = weeksAtCadence >= VARIATION_WEEKS_THRESHOLD
                ? `${baselineLabel} has held strong for ${weeksAtCadence} ${pluralize('week', weeksAtCadence)}. Add ${nextLabel} for a four-week test to see if the lift holds.`
                : `${baselineLabel} is performing well with healthy engagement and low complaints. Run at least four weeks with ${nextKey ? nextLabel : 'a higher cadence'} to validate headroom.`;
            return { status: 'send-more', cadenceLabel: nextLabel, title, message: msg, sample: formatSample(undefined, baseline) };
        }
        if (orderMap[baseline.key] === 4) {
            const title = `Ease back to 3 campaigns per week`;
            const msg = `${baselineLabel} is aggressive with limited comparative data. If you see complaint spikes, test a three-campaign cadence to protect reputation.`;
            return { status: 'send-less', cadenceLabel: '3 campaigns / week', title, message: msg, sample: formatSample(undefined, baseline) };
        }
        if (!healthy) {
            const title = `Stabilize ${actionLabelForBucket(baseline.key)} before scaling`;
            const msg = `${baselineLabel} is struggling—${issueSummary}. Tighten audience segments and creative at this cadence, then revisit higher-frequency tests.`;
            return { status: 'keep-as-is', cadenceLabel: baselineLabel ?? 'current cadence', title, message: msg, sample: formatSample(undefined, baseline) };
        }
    }

    if (riskyBaseline && orderMap[baseline.key] === 4) {
        const title = `Send 3 campaigns per week`;
        const msg = `${baselineLabel} is triggering high spam or bounce rates without a safer alternative measured. Start dialing back to a 3-campaign cadence to protect deliverability.`;
        return { status: 'send-less', cadenceLabel: '3 campaigns / week', title, message: msg, sample: formatSample(undefined, baseline) };
    }

    const title = baselineAction ? `Stay at ${baselineAction}` : 'Keep current cadence';
    const msg = higher.length || lower.length
        ? `${baselineLabel} remains the most balanced cadence. Other buckets either lack enough weeks, miss the 10% revenue lift bar, or add spam/bounce risk. Maintain this schedule and retest after gathering more data.`
        : `${baselineLabel} is the only cadence with enough data. Continue collecting results and test another cadence when ready.`;
    return { status: 'keep-as-is', cadenceLabel: baselineLabel ?? 'current cadence', title, message: msg, sample: formatSample(undefined, baseline) };
}

function deltaRatio(candidate: number, baseline: number) {
    if (!isFinite(candidate) || !isFinite(baseline)) return 0;
    if (baseline === 0) return candidate === 0 ? 0 : Infinity;
    return (candidate - baseline) / baseline;
}

function labelForBucket(key: BucketKey) {
    return ({ '1': '1 campaign / week', '2': '2 campaigns / week', '3': '3 campaigns / week', '4+': '4+ campaigns / week' }[key]);
}

function actionLabelForBucket(key: BucketKey) {
    switch (key) {
        case '1':
            return '1 campaign per week';
        case '2':
            return '2 campaigns per week';
        case '3':
            return '3 campaigns per week';
        default:
            return '4 or more campaigns per week';
    }
}

function formatPct(value: number) {
    if (!isFinite(value)) return '∞%';
    return `${(value * 100).toFixed(Math.abs(value) >= 1 ? 0 : 1)}%`;
}

function pluralize(word: string, count: number) {
    return count === 1 ? word : `${word}s`;
}

function describeIssues(bucket: BucketAggregate, revenue: number) {
    const issues: string[] = [];
    if (revenue <= 0) issues.push('revenue is flat');
    if (bucket.openRate < OPEN_HEALTHY_MIN) issues.push(`opens are below ${OPEN_HEALTHY_MIN}%`);
    if (bucket.clickRate < CLICK_HEALTHY_MIN) issues.push(`clicks are below ${CLICK_HEALTHY_MIN}%`);
    if (bucket.unsubscribeRate > UNSUB_WARN) issues.push(`unsubscribes exceed ${UNSUB_WARN}%`);
    if (bucket.spamRate > SPAM_WARN) issues.push(`spam complaints are elevated`);
    if (bucket.bounceRate > BOUNCE_WARN) issues.push(`bounce rate is high`);
    if (!issues.length) return 'engagement needs improvement';
    if (issues.length === 1) return issues[0];
    return `${issues.slice(0, -1).join(', ')}, and ${issues[issues.length - 1]}`;
}
