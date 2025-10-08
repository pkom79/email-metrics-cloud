"use client";
import React, { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import SelectBase from "../ui/SelectBase";
import InfoTooltipIcon from '../InfoTooltipIcon';
import { ProcessedCampaign } from '../../lib/data/dataTypes';

interface Props {
    campaigns: ProcessedCampaign[];
}

type Bucket = {
    key: string;
    rangeLabel: string;
    rangeMin: number;
    rangeMax: number;
    campaigns: ProcessedCampaign[];
    // sums
    sumRevenue: number;
    sumEmails: number;
    sumOrders: number;
    sumOpens: number;
    sumClicks: number;
    sumUnsubs: number;
    sumSpam: number;
    sumBounces: number;
    // derived
    avgCampaignRevenue: number;
    avgCampaignEmails: number;
    aov: number;
    revenuePerEmail: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    unsubscribeRate: number;
    spamRate: number;
    bounceRate: number;
};

const metricOptions = [
    { value: 'avgCampaignRevenue', label: 'Avg Campaign Revenue', kind: 'currency' }, // default
    { value: 'sumRevenue', label: 'Total Revenue', kind: 'currency' },
    { value: 'aov', label: 'Average Order Value (AOV)', kind: 'currency' },
    { value: 'revenuePerEmail', label: 'Revenue per Email', kind: 'currency' },
    { value: 'openRate', label: 'Open Rate', kind: 'percent' },
    { value: 'clickRate', label: 'Click Rate', kind: 'percent' },
    { value: 'clickToOpenRate', label: 'Click-to-Open Rate', kind: 'percent' },
    { value: 'avgCampaignEmails', label: 'Avg Campaign Emails Sent', kind: 'number' },
    { value: 'sumOrders', label: 'Total Orders', kind: 'number' },
    { value: 'conversionRate', label: 'Conversion Rate', kind: 'percent' },
    { value: 'unsubscribeRate', label: 'Unsubscribe Rate', kind: 'percent' },
    { value: 'spamRate', label: 'Spam Rate', kind: 'percent' },
    { value: 'bounceRate', label: 'Bounce Rate', kind: 'percent' },
];

function formatCurrency(v: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
}
function formatPercent(v: number) { return `${(v || 0).toFixed(2)}%`; }
function formatNumber(v: number) { return (v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function formatEmailsShort(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
    return `${n}`;
}

interface AudienceGuidanceResult {
    title: string;
    message: string;
    sample: string | null;
    baselineRange?: string;
    targetRange?: string;
    estimatedWeeklyGain?: number | null;
    estimatedMonthlyGain?: number | null;
}

function niceRangeLabel(min: number, max: number) {
    const roundTo = (x: number) => {
        if (x >= 1_000_000) return Math.round(x / 100_000) * 100_000;
        if (x >= 100_000) return Math.round(x / 10_000) * 10_000;
        if (x >= 10_000) return Math.round(x / 1_000) * 1_000;
        if (x >= 1_000) return Math.round(x / 100) * 100;
        return Math.round(x);
    };
    const a = roundTo(min);
    const b = roundTo(max);
    return `${formatEmailsShort(a)}–${formatEmailsShort(b)}`;
}

function computeBuckets(campaigns: ProcessedCampaign[]): { buckets: Bucket[]; limited: boolean; lookbackWeeks: number } {
    if (!campaigns.length) return { buckets: [], limited: true, lookbackWeeks: 0 };

    const valid = campaigns.filter(c => typeof c.emailsSent === 'number' && c.emailsSent >= 0);
    const total = valid.length;

    // Hybrid threshold: P5 clamped to [100, 1000]; if < 12 campaigns, do not exclude
    let filtered = valid;
    if (total >= 12) {
        const sortedForP = [...valid].sort((a, b) => a.emailsSent - b.emailsSent);
        const p5Index = Math.max(0, Math.floor(0.05 * (sortedForP.length - 1)));
        const p5 = sortedForP[p5Index]?.emailsSent ?? 0;
        const threshold = Math.max(100, Math.min(1000, p5));
        filtered = sortedForP.filter(c => c.emailsSent >= threshold);
    }

    const sample = filtered.length;
    const limited = sample < 12; // display limited data notice

    if (sample === 0) return { buckets: [], limited: true, lookbackWeeks: 0 };

    // Determine bucket boundaries: quantiles if sample >= 12, else linear
    const sorted = [...filtered].sort((a, b) => a.emailsSent - b.emailsSent);
    const min = sorted[0].emailsSent;
    const max = sorted[sorted.length - 1].emailsSent;

    const boundaries: number[] = [min];
    if (sample >= 12 && min !== max) {
        const q = (p: number) => {
            const idx = (sorted.length - 1) * p;
            const lo = Math.floor(idx);
            const hi = Math.ceil(idx);
            const val = lo === hi ? sorted[lo].emailsSent : (sorted[lo].emailsSent * (hi - idx) + sorted[hi].emailsSent * (idx - lo));
            return Math.round(val);
        };
        const q25 = q(0.25);
        const q50 = q(0.50);
        const q75 = q(0.75);
        boundaries.push(q25, q50, q75, max);
    } else {
        if (min === max) {
            boundaries.push(max, max, max, max);
        } else {
            for (let i = 1; i <= 4; i++) {
                const v = Math.round(min + (i * (max - min)) / 4);
                boundaries.push(v);
            }
        }
    }

    // Build 4 buckets using boundaries: [b0,b1], (b1,b2], (b2,b3], (b3,b4]
    const bRanges = [
        [boundaries[0], boundaries[1]],
        [boundaries[1], boundaries[2]],
        [boundaries[2], boundaries[3]],
        [boundaries[3], boundaries[4]],
    ] as const;

    const buckets: Bucket[] = bRanges.map((r, idx) => {
        const [lo, hi] = r;
        const bucketCampaigns = sorted.filter((c, i) => {
            const val = c.emailsSent;
            if (idx === 0) return val >= lo && val <= hi;
            return val > lo && val <= hi;
        });

        let sumRevenue = 0, sumEmails = 0, sumOrders = 0, sumOpens = 0, sumClicks = 0, sumUnsubs = 0, sumSpam = 0, sumBounces = 0;
        for (const c of bucketCampaigns) {
            sumRevenue += c.revenue;
            sumEmails += c.emailsSent;
            sumOrders += c.totalOrders;
            sumOpens += c.uniqueOpens;
            sumClicks += c.uniqueClicks;
            sumUnsubs += c.unsubscribesCount;
            sumSpam += c.spamComplaintsCount;
            sumBounces += c.bouncesCount;
        }

        const totalCampaigns = bucketCampaigns.length;
        const avgCampaignRevenue = totalCampaigns > 0 ? sumRevenue / totalCampaigns : 0;
        const avgCampaignEmails = totalCampaigns > 0 ? sumEmails / totalCampaigns : 0;
        const aov = sumOrders > 0 ? sumRevenue / sumOrders : 0;
        const revenuePerEmail = sumEmails > 0 ? sumRevenue / sumEmails : 0;
        const openRate = sumEmails > 0 ? (sumOpens / sumEmails) * 100 : 0;
        const clickRate = sumEmails > 0 ? (sumClicks / sumEmails) * 100 : 0;
        const clickToOpenRate = sumOpens > 0 ? (sumClicks / sumOpens) * 100 : 0;
        const conversionRate = sumClicks > 0 ? (sumOrders / sumClicks) * 100 : 0;
        const unsubscribeRate = sumEmails > 0 ? (sumUnsubs / sumEmails) * 100 : 0;
        const spamRate = sumEmails > 0 ? (sumSpam / sumEmails) * 100 : 0;
        const bounceRate = sumEmails > 0 ? (sumBounces / sumEmails) * 100 : 0;

        return {
            key: `${idx}`,
            rangeLabel: niceRangeLabel(lo, hi),
            rangeMin: lo,
            rangeMax: hi,
            campaigns: bucketCampaigns,
            sumRevenue, sumEmails, sumOrders, sumOpens, sumClicks, sumUnsubs, sumSpam, sumBounces,
            avgCampaignRevenue, avgCampaignEmails, aov, revenuePerEmail, openRate, clickRate, clickToOpenRate, conversionRate, unsubscribeRate, spamRate, bounceRate,
        };
    }).filter(b => b.campaigns.length > 0);

    let minDate = Number.POSITIVE_INFINITY;
    let maxDate = Number.NEGATIVE_INFINITY;
    for (const c of filtered) {
        if (!(c.sentDate instanceof Date)) continue;
        const t = c.sentDate.getTime();
        if (!Number.isFinite(t)) continue;
        if (t < minDate) minDate = t;
        if (t > maxDate) maxDate = t;
    }
    let lookbackWeeks = 0;
    if (Number.isFinite(minDate) && Number.isFinite(maxDate) && maxDate >= minDate) {
        const days = Math.max(1, Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24))) + 1;
        lookbackWeeks = Math.max(1, Math.round(days / 7));
    }

    return { buckets, limited, lookbackWeeks };
}

const AUDIENCE_MIN_TOTAL_CAMPAIGNS = 12;
const AUDIENCE_MIN_BUCKET_CAMPAIGNS = 3;
const AUDIENCE_MIN_TOTAL_EMAILS = 50_000;
const AUDIENCE_MIN_BUCKET_EMAILS = 10_000;
const AUDIENCE_LIFT_THRESHOLD = 0.1;
const AUDIENCE_NEG_LIFT_THRESHOLD = -0.1;
const AUDIENCE_ENGAGEMENT_DROP_LIMIT = -0.05;
const AUDIENCE_SPAM_DELTA_LIMIT = 0.05;
const AUDIENCE_BOUNCE_DELTA_LIMIT = 0.1;
const AUDIENCE_SPAM_ALERT = 0.3;
const AUDIENCE_BOUNCE_ALERT = 0.5;
const AUDIENCE_OPEN_HEALTHY = 10;
const AUDIENCE_CLICK_HEALTHY = 1;
const AUDIENCE_CONSERVATIVE_FACTOR = 0.5;

function computeAudienceSizeGuidance(buckets: Bucket[], lookbackWeeks: number): AudienceGuidanceResult | null {
    if (!buckets.length) return null;

    const totalCampaigns = buckets.reduce((sum, b) => sum + b.campaigns.length, 0);
    const totalEmails = buckets.reduce((sum, b) => sum + b.sumEmails, 0);
    const totalRevenue = buckets.reduce((sum, b) => sum + b.sumRevenue, 0);
    const overallAvgCampaignRevenue = totalCampaigns > 0 ? totalRevenue / totalCampaigns : 0;

    const formatSample = (override?: number, a?: Bucket | null, b?: Bucket | null) => {
        let count: number;
        if (typeof override === 'number') {
            count = override;
        } else if (a && b) {
            count = (a.campaigns.length ?? 0) + (b.campaigns.length ?? 0);
        } else {
            count = totalCampaigns;
        }
        if (count <= 0) return null;
        return `Based on ${count} ${pluralize('campaign', count)} in this date range.`;
    };

    if (totalCampaigns < AUDIENCE_MIN_TOTAL_CAMPAIGNS || totalEmails < AUDIENCE_MIN_TOTAL_EMAILS) {
        const message = `This date range includes only ${totalCampaigns} ${pluralize('campaign', totalCampaigns)} across distinct audience sizes. Expand the range or keep sending before adjusting targeting.`;
        return {
            title: 'Not enough data for a recommendation',
            message,
            sample: formatSample(totalCampaigns),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
        };
    }

    const orderMap = (b: Bucket) => parseInt(b.key, 10);
    const metricKey: keyof Bucket = 'sumRevenue';

    const qualified = buckets.filter(b => b.campaigns.length >= AUDIENCE_MIN_BUCKET_CAMPAIGNS && b.sumEmails >= AUDIENCE_MIN_BUCKET_EMAILS);
    if (!qualified.length) {
        const message = 'Campaigns at each audience size are too sparse to compare. Gather more sends per size before changing targeting.';
        return {
            title: 'Not enough data for a recommendation',
            message,
            sample: formatSample(totalCampaigns),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
        };
    }

    const pickTopPerformer = () => {
        const sorted = [...qualified].sort((a, b) => {
            const diff = (b[metricKey] as number) - (a[metricKey] as number);
            if (Math.abs(diff) > 1e-6) return diff > 0 ? 1 : -1;
            if (b.campaigns.length !== a.campaigns.length) return b.campaigns.length - a.campaigns.length;
            return orderMap(a) - orderMap(b);
        });
        return sorted[0];
    };

    const top = pickTopPerformer();
    if (!top) return null;
    const headerRange = (label: string) => `${label} total recipients per campaign`;
    const topValue = top[metricKey] as number;

    const evaluate = (candidate: Bucket) => {
        const value = candidate[metricKey] as number;
        const lift = topValue === 0 ? (value > 0 ? Infinity : 0) : (value - topValue) / topValue;
        const openDelta = ratioDelta(candidate.openRate, top.openRate);
        const clickDelta = ratioDelta(candidate.clickRate, top.clickRate);
        const spamDelta = candidate.spamRate - top.spamRate;
        const bounceDelta = candidate.bounceRate - top.bounceRate;
        return { lift, openDelta, clickDelta, spamDelta, bounceDelta };
    };

    const computeGain = (target: Bucket): number | null => {
        if (!lookbackWeeks || lookbackWeeks <= 0) return null;
        const weeklyCampaigns = target.campaigns.length / lookbackWeeks;
        if (!Number.isFinite(weeklyCampaigns) || weeklyCampaigns <= 0) return null;
        const deltaPerCampaign = (target.avgCampaignRevenue - overallAvgCampaignRevenue) * AUDIENCE_CONSERVATIVE_FACTOR;
        if (!Number.isFinite(deltaPerCampaign) || deltaPerCampaign <= 0) return null;
        const gain = deltaPerCampaign * weeklyCampaigns;
        return gain > 0 ? gain : null;
    };

    const safeTop = top.spamRate < AUDIENCE_SPAM_ALERT && top.bounceRate < AUDIENCE_BOUNCE_ALERT;
    const engagementSafeTop = top.openRate >= AUDIENCE_OPEN_HEALTHY && top.clickRate >= AUDIENCE_CLICK_HEALTHY;

    if (safeTop && engagementSafeTop) {
        const title = `Send campaigns to ${headerRange(top.rangeLabel)}`;
        const msg = `${top.rangeLabel} audiences generated the most revenue in this range while staying within deliverability guardrails. Scale targeting toward this size.`;
        const weeklyGain = computeGain(top);
        const monthlyGain = weeklyGain != null ? weeklyGain * 4 : null;
        const showGain = monthlyGain != null && monthlyGain >= 500;
        return {
            title,
            message: msg,
            sample: formatSample(undefined, top),
            baselineRange: top.rangeLabel,
            targetRange: top.rangeLabel,
            estimatedWeeklyGain: showGain ? weeklyGain : null,
            estimatedMonthlyGain: showGain ? monthlyGain : null,
        };
    }

    const saferCandidates = qualified.filter(b => b !== top).sort((a, b) => (b[metricKey] as number) - (a[metricKey] as number));
    for (const candidate of saferCandidates) {
        const { lift, openDelta, clickDelta, spamDelta, bounceDelta } = evaluate(candidate);
        const engagementSafe = openDelta >= AUDIENCE_ENGAGEMENT_DROP_LIMIT && clickDelta >= AUDIENCE_ENGAGEMENT_DROP_LIMIT;
        const riskSafe = candidate.spamRate < AUDIENCE_SPAM_ALERT && candidate.bounceRate < AUDIENCE_BOUNCE_ALERT && spamDelta <= AUDIENCE_SPAM_DELTA_LIMIT && bounceDelta <= AUDIENCE_BOUNCE_DELTA_LIMIT;
        if (riskSafe && engagementSafe) {
            const liftPct = formatDeltaPct((candidate[metricKey] as number - topValue) / topValue);
            const title = `Send campaigns to ${headerRange(candidate.rangeLabel)}`;
            const msg = `${candidate.rangeLabel} recipients deliver strong revenue with safer engagement (${liftPct} vs. the higher-risk ${top.rangeLabel} group). Focus here while improving deliverability.`;
            const weeklyGain = computeGain(candidate);
            const monthlyGain = weeklyGain != null ? weeklyGain * 4 : null;
            const showGain = monthlyGain != null && monthlyGain >= 500;
            return {
                title,
                message: msg,
                sample: formatSample(undefined, candidate, top),
                baselineRange: top.rangeLabel,
                targetRange: candidate.rangeLabel,
                estimatedWeeklyGain: showGain ? weeklyGain : null,
                estimatedMonthlyGain: showGain ? monthlyGain : null,
            };
        }
    }

    const title = `Test ${headerRange(top.rangeLabel)}`;
    const msg = `Revenue peaks at ${top.rangeLabel} recipients, but engagement or deliverability need work. Run targeted tests and monitor spam/bounce closely before fully scaling.`;
    return {
        title,
        message: msg,
        sample: formatSample(undefined, top),
        baselineRange: top.rangeLabel,
        targetRange: top.rangeLabel,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
    };
}

function ratioDelta(candidate: number, baseline: number) {
    if (!isFinite(candidate) || !isFinite(baseline)) return 0;
    if (baseline === 0) return candidate === 0 ? 0 : Infinity;
    return (candidate - baseline) / baseline;
}

function formatDeltaPct(value: number) {
    if (!isFinite(value)) return '∞%';
    const abs = Math.abs(value * 100);
    const decimals = abs >= 100 ? 0 : 1;
    return `${abs.toFixed(decimals)}%`;
}

function describeAudienceIssues(bucket: Bucket, metricValue: number) {
    const issues: string[] = [];
    if (metricValue <= 0) issues.push('revenue is flat');
    if (bucket.openRate < AUDIENCE_OPEN_HEALTHY) issues.push(`opens are below ${AUDIENCE_OPEN_HEALTHY}%`);
    if (bucket.clickRate < AUDIENCE_CLICK_HEALTHY) issues.push(`clicks are below ${AUDIENCE_CLICK_HEALTHY}%`);
    if (bucket.spamRate > AUDIENCE_SPAM_ALERT) issues.push('spam complaints are elevated');
    if (bucket.bounceRate > AUDIENCE_BOUNCE_ALERT) issues.push('bounce rate is high');
    if (!issues.length) return 'engagement needs improvement';
    if (issues.length === 1) return issues[0];
    return `${issues.slice(0, -1).join(', ')}, and ${issues[issues.length - 1]}`;
}

function pluralize(word: string, count: number) {
    return count === 1 ? word : `${word}s`;
}


export default function AudienceSizePerformance({ campaigns }: Props) {
    const [metric, setMetric] = useState<string>('avgCampaignRevenue');

    const { buckets, limited, lookbackWeeks } = useMemo(() => computeBuckets(campaigns || []), [campaigns]);
    const guidance = useMemo(() => computeAudienceSizeGuidance(buckets, lookbackWeeks), [buckets, lookbackWeeks]);

    if (!campaigns?.length) {
        return (
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-2"><Layers className="w-5 h-5 text-purple-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Audience Size</h3></div>
                <p className="text-sm text-gray-600 dark:text-gray-400">No campaigns in the selected date range.</p>
            </div>
        );
    }

    if (!buckets.length) return null;

    const selectedMeta = metricOptions.find(o => o.value === metric) || metricOptions[0];
    const getValue = (b: Bucket) => (b as any)[selectedMeta.value] as number;
    const maxVal = Math.max(...buckets.map(getValue), 0) || 1;
    const formatVal = (v: number) => selectedMeta.kind === 'currency' ? formatCurrency(v) : selectedMeta.kind === 'percent' ? formatPercent(v) : formatNumber(v);

    return (
        <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campaign Performance by Audience Size</h3>
                    <InfoTooltipIcon
                        placement="bottom-start"
                        content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>We group campaigns by audience size (emails sent) and compare performance.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>We split into 4 buckets by emails sent using quantiles. If you have fewer than 12 campaigns, we use equal ranges. Very tiny test sends may be excluded using an adaptive threshold. Rates are weighted by volume.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Understand how list size impacts engagement and revenue to choose better targeting.</p>
                            </div>
                        )}
                    />
                </div>
                <div className="flex items-center gap-3">
                    <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value)} className="pl-3 pr-8 py-2 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer">
                        {metricOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </SelectBase>
                </div>
            </div>
            <div className={`grid gap-6 ${buckets.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' : buckets.length === 2 ? 'grid-cols-2 max-w-md mx-auto' : buckets.length === 3 ? 'grid-cols-3 max-w-3xl mx-auto' : 'grid-cols-2 md:grid-cols-4'}`}>
                {buckets.map((b) => {
                    const val = getValue(b);
                    const heightPct = (val / maxVal) * 100;
                    return (
                        <div key={`${b.key}-${b.rangeLabel}`} className="flex flex-col">
                            <div className="group relative flex-1 flex flex-col justify-end min-h-[160px]">
                                <div className="w-full relative bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden flex items-end" style={{ minHeight: '160px' }}>
                                    <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-indigo-500/5 to-transparent pointer-events-none" />
                                    <div className="w-full rounded-t-lg bg-indigo-500 transition-all duration-500" style={{ height: `${heightPct}%` }} aria-label={`${b.rangeLabel}: ${formatVal(val)}`} />
                                </div>
                                <div className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">{formatVal(val)}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">{b.rangeLabel} recipients</div>
                                <div className="text-xs text-gray-500 dark:text-gray-500">{b.campaigns.length} {b.campaigns.length === 1 ? 'campaign' : 'campaigns'}</div>
                                {/* Tooltip */}
                                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition z-10 absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                                    <div className="font-semibold mb-1">{b.rangeLabel} recipients</div>
                                    <ul className="space-y-0.5">
                                        <li><span className="text-gray-500 dark:text-gray-400">Campaigns:</span> {b.campaigns.length}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Total Emails:</span> {formatNumber(b.sumEmails)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Avg Campaign Revenue:</span> {formatCurrency(b.avgCampaignRevenue)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Total Revenue:</span> {formatCurrency(b.sumRevenue)}</li>
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
                    <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{guidance.title}</p>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{guidance.message}</p>
                    {guidance.estimatedMonthlyGain != null && guidance.estimatedMonthlyGain >= 500 && (
                        <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            Monthly revenue could increase by an estimated {formatCurrency(guidance.estimatedMonthlyGain)} by leaning into this audience size.
                        </p>
                    )}
                    {guidance.sample && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{guidance.sample}</p>}
                </div>
            )}
        </div>
    );
}
