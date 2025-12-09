"use client";
import React, { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import SelectBase from "../ui/SelectBase";
import InfoTooltipIcon from '../InfoTooltipIcon';
import { ProcessedCampaign } from '../../lib/data/dataTypes';

interface Props {
    campaigns: ProcessedCampaign[];
    allCampaigns?: ProcessedCampaign[];
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
    // weighted stats (new)
    weightedAvgCampaignRevenue: number;
    weightedStdDevCampaignRevenue: number;
    // weighted revenue per email (for primary ranking)
    weightedRevenuePerEmail: number;
    weightedStdDevRevenuePerEmail: number;
    // risk zone (new)
    riskZone: 'green' | 'yellow' | 'red';
};

const metricOptions = [
    { value: 'weightedAvgCampaignRevenue', label: 'Avg Campaign Revenue', kind: 'currency' }, // default - now weighted
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
    totalMonthlyRevenue?: number;
    confidenceLevel?: 'high' | 'medium' | 'low';
    riskZone?: 'green' | 'yellow' | 'red';
    optimalCapDays?: number;
    selectedRangeDays?: number;
    isHighVolume?: boolean;
    // Significance detection
    spreadPct?: number;
    isSignificant?: boolean;
    absoluteOpportunity?: number;
    // Account-wide sufficiency
    accountHasSufficientData?: boolean;
    accountCoverageDays?: number;
    accountTotalCampaigns?: number;
    accountTotalEmails?: number;
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

// Thresholds matching Send Frequency feature
const SPAM_GREEN_LIMIT = 0.1;   // < 0.1% = Green
const SPAM_RED_LIMIT = 0.2;    // > 0.2% = Red
const BOUNCE_GREEN_LIMIT = 2.0; // < 2.0% = Green
const BOUNCE_RED_LIMIT = 3.0;   // > 3.0% = Red

function getRiskZone(spamRate: number, bounceRate: number): 'green' | 'yellow' | 'red' {
    if (spamRate > SPAM_RED_LIMIT || bounceRate > BOUNCE_RED_LIMIT) return 'red';
    if (spamRate >= SPAM_GREEN_LIMIT || bounceRate >= BOUNCE_GREEN_LIMIT) return 'yellow';
    return 'green';
}

// IQR filter for outlier detection (holiday spikes)
function calculateIQRFilterLimit(values: number[]): number {
    if (values.length < 4) return Infinity;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    return q3 + (1.5 * iqr);
}

// Weighted stats with recency bias (ported from campaignSendFrequency.ts)
function calculateWeightedStats(
    items: { value: number; date: Date }[],
    datasetStartDate: Date,
    datasetEndDate: Date
): { mean: number; stdDev: number } {
    if (items.length === 0) return { mean: 0, stdDev: 0 };

    const totalDuration = datasetEndDate.getTime() - datasetStartDate.getTime();
    const duration = totalDuration <= 0 ? 1 : totalDuration;

    let sumWeightedValues = 0;
    let sumWeights = 0;
    const weights: number[] = [];

    for (const item of items) {
        const daysSinceStart = item.date.getTime() - datasetStartDate.getTime();
        // Recency bias: more recent = higher weight
        const weight = Math.max(0.01, daysSinceStart / duration);
        weights.push(weight);
        sumWeightedValues += item.value * weight;
        sumWeights += weight;
    }

    if (sumWeights === 0) return { mean: 0, stdDev: 0 };

    const weightedMean = sumWeightedValues / sumWeights;

    // Weighted Standard Deviation
    let sumSquaredDiffs = 0;
    for (let i = 0; i < items.length; i++) {
        sumSquaredDiffs += weights[i] * Math.pow(items[i].value - weightedMean, 2);
    }

    const N = items.length;
    const denominator = N > 1 ? ((N - 1) / N) * sumWeights : sumWeights;
    const weightedStdDev = denominator > 0 ? Math.sqrt(sumSquaredDiffs / denominator) : 0;

    return { mean: weightedMean, stdDev: weightedStdDev };
}

// Compute bucket boundaries using quantiles to ensure statistically meaningful distribution
// Each bucket will have roughly equal number of campaigns
function computeQuantileBucketBoundaries(sortedEmails: number[], targetBuckets: number = 4): number[] {
    if (sortedEmails.length === 0) return [];

    const n = sortedEmails.length;
    const min = sortedEmails[0];
    const max = sortedEmails[sortedEmails.length - 1];

    if (min === max) return [min, max];

    // Determine optimal bucket count based on sample size
    // Need at least 3 campaigns per bucket for any statistical meaning
    const MIN_PER_BUCKET = 3;
    const maxBuckets = Math.floor(n / MIN_PER_BUCKET);
    const numBuckets = Math.max(2, Math.min(targetBuckets, maxBuckets));

    // Use quantiles to create bucket boundaries
    const boundaries: number[] = [min];
    for (let i = 1; i < numBuckets; i++) {
        const pct = i / numBuckets;
        const idx = Math.floor(pct * (n - 1));
        const boundary = sortedEmails[idx];
        // Only add if different from last boundary
        if (boundary !== boundaries[boundaries.length - 1]) {
            boundaries.push(boundary);
        }
    }
    if (boundaries[boundaries.length - 1] !== max) {
        boundaries.push(max);
    }

    return boundaries;
}

function computeBuckets(
    campaigns: ProcessedCampaign[],
    accountCampaigns?: ProcessedCampaign[]
): { buckets: Bucket[]; limited: boolean; lookbackWeeks: number; optimalCapDays: number; selectedRangeDays: number; isHighVolume: boolean } {
    if (!campaigns.length) return { buckets: [], limited: true, lookbackWeeks: 0, optimalCapDays: 180, selectedRangeDays: 0, isHighVolume: false };

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
    const limited = sample < 12;

    if (sample === 0) return { buckets: [], limited: true, lookbackWeeks: 0, optimalCapDays: 180, selectedRangeDays: 0, isHighVolume: false };

    // IQR filter to exclude revenue outliers (holiday spikes)
    const revenueValues = filtered.map(c => c.revenue);
    const revenueLimit = calculateIQRFilterLimit(revenueValues);
    const cleanedCampaigns = filtered.filter(c => c.revenue <= revenueLimit);

    // Use cleaned campaigns if we still have enough data, otherwise use all
    const finalCampaigns = cleanedCampaigns.length >= 6 ? cleanedCampaigns : filtered;

    // Get date range for weighted stats
    let minDate = new Date();
    let maxDate = new Date(0);
    for (const c of finalCampaigns) {
        if (c.sentDate instanceof Date && !isNaN(c.sentDate.getTime())) {
            if (c.sentDate < minDate) minDate = c.sentDate;
            if (c.sentDate > maxDate) maxDate = c.sentDate;
        }
    }

    // Dynamic bucket boundaries
    const sorted = [...finalCampaigns].sort((a, b) => a.emailsSent - b.emailsSent);
    const sortedEmails = sorted.map(c => c.emailsSent);
    const boundaries = computeQuantileBucketBoundaries(sortedEmails, 4);

    if (boundaries.length < 2) {
        return { buckets: [], limited: true, lookbackWeeks: 0, optimalCapDays: 180, selectedRangeDays: 0, isHighVolume: false };
    }

    // Build dynamic number of buckets
    const bRanges: Array<[number, number]> = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        bRanges.push([boundaries[i], boundaries[i + 1]]);
    }

    const buckets: Bucket[] = bRanges.map((r, idx) => {
        const [lo, hi] = r;
        const bucketCampaigns = sorted.filter((c) => {
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

        // Calculate weighted stats with recency bias
        const revenueItems = bucketCampaigns
            .filter(c => c.sentDate instanceof Date && !isNaN(c.sentDate.getTime()))
            .map(c => ({
                value: c.revenue,
                date: c.sentDate,
            }));
        const { mean: weightedAvgCampaignRevenue, stdDev: weightedStdDevCampaignRevenue } =
            calculateWeightedStats(revenueItems, minDate, maxDate);

        // Calculate weighted revenue per email (primary ranking metric)
        const revenuePerEmailItems = bucketCampaigns
            .filter(c => c.sentDate instanceof Date && !isNaN(c.sentDate.getTime()) && c.emailsSent > 0)
            .map(c => ({
                value: c.revenue / c.emailsSent,
                date: c.sentDate,
            }));
        const { mean: weightedRevenuePerEmail, stdDev: weightedStdDevRevenuePerEmail } =
            calculateWeightedStats(revenuePerEmailItems, minDate, maxDate);

        const riskZone = getRiskZone(spamRate, bounceRate);

        return {
            key: `${idx}`,
            rangeLabel: niceRangeLabel(lo, hi),
            rangeMin: lo,
            rangeMax: hi,
            campaigns: bucketCampaigns,
            sumRevenue, sumEmails, sumOrders, sumOpens, sumClicks, sumUnsubs, sumSpam, sumBounces,
            avgCampaignRevenue, avgCampaignEmails, aov, revenuePerEmail, openRate, clickRate, clickToOpenRate, conversionRate, unsubscribeRate, spamRate, bounceRate,
            weightedAvgCampaignRevenue,
            weightedStdDevCampaignRevenue,
            weightedRevenuePerEmail,
            weightedStdDevRevenuePerEmail,
            riskZone,
        };
    }).filter(b => b.campaigns.length > 0);

    let lookbackWeeks = 0;
    let selectedRangeDays = 0;
    if (minDate.getTime() < maxDate.getTime()) {
        const days = Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24))) + 1;
        lookbackWeeks = Math.max(1, Math.round(days / 7));
        selectedRangeDays = days;
    }

    // Calculate optimal cap days based on send frequency and list size
    // High volume senders (3+ campaigns/week) need less history (90 days)
    // Low volume senders need more history (180 days) for statistical significance
    const avgCampaignsPerWeek = lookbackWeeks > 0 ? sample / lookbackWeeks : 0;
    const avgListSize = sample > 0 ? finalCampaigns.reduce((sum, c) => sum + c.emailsSent, 0) / sample : 0;

    // Determine volume classification using full history if available to ensure stable recommendation
    const historySource = accountCampaigns?.length ? accountCampaigns : filtered;
    let historyAvgWeeklyVolume = avgCampaignsPerWeek;
    if (historySource.length) {
        const hMin = historySource.reduce((min, c) => c.sentDate < min ? c.sentDate : min, new Date());
        const hMax = historySource.reduce((max, c) => c.sentDate > max ? c.sentDate : max, new Date(0));
        if (hMin < hMax) {
            const hDays = (hMax.getTime() - hMin.getTime()) / (1000 * 60 * 60 * 24);
            const hWeeks = Math.max(1, hDays / 7);
            // Use last 90 days for recent volume check if possible, otherwise full history
            const ninetyDaysAgo = new Date(hMax);
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const recent = historySource.filter(c => c.sentDate >= ninetyDaysAgo);
            if (recent.length > 0) {
                 historyAvgWeeklyVolume = recent.length / 12.85;
            } else {
                 historyAvgWeeklyVolume = historySource.length / hWeeks;
            }
        }
    }

    // High volume: 3+ campaigns/week OR large list (50k+) with 2+ campaigns/week
    const isHighVolume = historyAvgWeeklyVolume >= 3 || (avgListSize >= 50000 && historyAvgWeeklyVolume >= 2);
    const optimalCapDays = isHighVolume ? 90 : 180;

    return { buckets, limited, lookbackWeeks, optimalCapDays, selectedRangeDays, isHighVolume };
}

const AUDIENCE_MIN_TOTAL_CAMPAIGNS = 12;
const AUDIENCE_MIN_BUCKET_CAMPAIGNS = 3;
const AUDIENCE_MIN_TOTAL_EMAILS = 50_000;
const AUDIENCE_MIN_BUCKET_EMAILS = 10_000;

function computeAudienceSizeGuidance(
    buckets: Bucket[],
    lookbackWeeks: number,
    optimalCapDays: number,
    selectedRangeDays: number,
    isHighVolume: boolean,
    accountCampaigns?: ProcessedCampaign[]
): AudienceGuidanceResult | null {
    if (!buckets.length) return null;

    const totalCampaigns = buckets.reduce((sum, b) => sum + b.campaigns.length, 0);
    const totalEmails = buckets.reduce((sum, b) => sum + b.sumEmails, 0);
    const totalRevenue = buckets.reduce((sum, b) => sum + b.sumRevenue, 0);
    const overallRevenuePerEmail = totalEmails > 0 ? totalRevenue / totalEmails : 0;

    // Calculate monthly revenue for threshold comparison
    const weeksInRange = Math.max(1, lookbackWeeks);
    const monthlyRevenue = (totalRevenue / weeksInRange) * 4.33;

    const formatSample = () => {
        if (totalCampaigns <= 0) return null;
        const parts = [`${totalCampaigns} ${pluralize('campaign', totalCampaigns)}`];
        parts.push(`${formatNumber(totalEmails)} emails sent`);
        return `Based on ${parts.join(' and ')} in this date range.`;
    };

    // Account-wide availability (capped to dataset, e.g., 2 years)
    let accountTotalCampaigns = totalCampaigns;
    let accountTotalEmails = totalEmails;
    let accountCoverageDays = selectedRangeDays;
    if (accountCampaigns?.length) {
        const valid = accountCampaigns.filter(c => typeof c.emailsSent === 'number' && c.emailsSent >= 0);
        accountTotalCampaigns = valid.length;
        accountTotalEmails = valid.reduce((sum, c) => sum + c.emailsSent, 0);
        const accDates = valid
            .filter(c => c.sentDate instanceof Date && !isNaN(c.sentDate.getTime()))
            .map(c => c.sentDate.getTime());
        if (accDates.length) {
            const min = Math.min(...accDates);
            const max = Math.max(...accDates);
            accountCoverageDays = Math.max(1, Math.round((max - min) / (1000 * 60 * 60 * 24)) + 1);
        }
    }

    const accountHasMinCampaigns = accountTotalCampaigns >= AUDIENCE_MIN_TOTAL_CAMPAIGNS;
    const accountHasMinEmails = accountTotalEmails >= AUDIENCE_MIN_TOTAL_EMAILS;
    const accountHasSufficientData = accountHasMinCampaigns && accountHasMinEmails;

    // Insufficient data check
    const hasMinCampaigns = totalCampaigns >= AUDIENCE_MIN_TOTAL_CAMPAIGNS;
    const hasMinEmails = totalEmails >= AUDIENCE_MIN_TOTAL_EMAILS;
    if (!hasMinCampaigns || !hasMinEmails) {
        const needs: string[] = [];
        if (!hasMinCampaigns) needs.push(`${totalCampaigns} ${pluralize('campaign', totalCampaigns)} (need ${AUDIENCE_MIN_TOTAL_CAMPAIGNS}+)`);
        if (!hasMinEmails) needs.push(`${formatNumber(totalEmails)} emails sent (need ${formatNumber(AUDIENCE_MIN_TOTAL_EMAILS)}+)`);
        const detail = needs.length ? `This date range includes ${needs.join(' and ')}.` : 'This date range is too small.';

        const accountDetail = accountHasSufficientData
            ? `Expand the range (up to ${formatNumber(accountCoverageDays)} days available) to include more of your data.`
            : `Not enough data in the account. We only have ${accountTotalCampaigns} ${pluralize('campaign', accountTotalCampaigns)} and ${formatNumber(accountTotalEmails)} emails across the last ${formatNumber(accountCoverageDays)} days (full available range).`;

        return {
            title: accountHasSufficientData ? 'Not enough data for a recommendation' : 'Not enough data in the account',
            message: `${detail} ${accountDetail}`,
            sample: formatSample(),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
            totalMonthlyRevenue: monthlyRevenue,
            confidenceLevel: 'low',
            optimalCapDays,
            selectedRangeDays,
            isHighVolume,
            accountHasSufficientData,
            accountCoverageDays,
            accountTotalCampaigns,
            accountTotalEmails,
        };
    }

    // Filter qualified buckets (enough data for comparison)
    const qualified = buckets.filter(b =>
        b.campaigns.length >= AUDIENCE_MIN_BUCKET_CAMPAIGNS &&
        b.sumEmails >= AUDIENCE_MIN_BUCKET_EMAILS
    );

    if (!qualified.length) {
        return {
            title: 'Not enough data for a recommendation',
            message: 'Campaigns at each audience size are too sparse to compare. Gather more sends per size.',
            sample: formatSample(),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
            totalMonthlyRevenue: monthlyRevenue,
            confidenceLevel: 'low',
            optimalCapDays,
            selectedRangeDays,
            isHighVolume,
        };
    }

    // Filter out Red zone buckets from recommendations
    const safeCandidates = qualified.filter(b => b.riskZone !== 'red');

    if (!safeCandidates.length) {
        return {
            title: 'Focus on list hygiene before scaling',
            message: `All audience sizes show elevated spam (>${SPAM_RED_LIMIT}%) or bounce rates (>${BOUNCE_RED_LIMIT}%). Clean your list and improve email quality first.`,
            sample: formatSample(),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
            totalMonthlyRevenue: monthlyRevenue,
            confidenceLevel: 'low',
            riskZone: 'red',
            optimalCapDays,
            selectedRangeDays,
            isHighVolume,
        };
    }

    // Find best performer by weighted Revenue per Email (primary metric)
    // This encourages more targeted, smaller audience campaigns that deliver better per-email value
    const sortedByRevenuePerEmail = [...safeCandidates].sort((a, b) =>
        b.weightedRevenuePerEmail - a.weightedRevenuePerEmail
    );
    const bestBucket = sortedByRevenuePerEmail[0];
    const worstBucket = sortedByRevenuePerEmail[sortedByRevenuePerEmail.length - 1];

    // Calculate spread percentage (best vs worst) for messaging
    const spreadPct = bestBucket.weightedRevenuePerEmail > 0
        ? ((bestBucket.weightedRevenuePerEmail - worstBucket.weightedRevenuePerEmail) / bestBucket.weightedRevenuePerEmail) * 100
        : 0;

    // Calculate confidence level for the best bucket
    const N = bestBucket.campaigns.length;
    const cv = bestBucket.weightedRevenuePerEmail > 0
        ? bestBucket.weightedStdDevRevenuePerEmail / bestBucket.weightedRevenuePerEmail
        : Infinity;
    const confidenceLevel: 'high' | 'medium' | 'low' =
        cv < 0.3 && N >= 6 ? 'high' :
            cv < 0.5 && N >= 4 ? 'medium' : 'low';

    // === NEW SIGNIFICANCE LOGIC ===
    // Compare best bucket to OVERALL AVERAGE (not worst bucket or CI overlap)
    // Calculate the actual monthly $ opportunity from switching to best bucket

    // Best bucket's average revenue per campaign
    const bestAvgRevPerCampaign = bestBucket.campaigns.length > 0
        ? bestBucket.sumRevenue / bestBucket.campaigns.length
        : 0;

    // Overall average revenue per campaign
    const overallAvgRevPerCampaign = totalCampaigns > 0
        ? totalRevenue / totalCampaigns
        : 0;

    // Revenue gain per campaign if user switches to best bucket
    const revenueGainPerCampaign = bestAvgRevPerCampaign - overallAvgRevPerCampaign;

    // Calculate campaigns per month based on lookback period
    const weeksInPeriod = Math.max(1, lookbackWeeks);
    const campaignsPerMonth = (totalCampaigns / weeksInPeriod) * 4.33;

    // Monthly opportunity = gain per campaign × campaigns per month
    const monthlyOpportunity = revenueGainPerCampaign * campaignsPerMonth;

    // Practical significance thresholds:
    // - Monthly opportunity >= $1,000, OR
    // - Monthly opportunity >= 10% of monthly revenue
    const SIGNIFICANCE_ABSOLUTE_THRESHOLD = 1000; // $1,000/month
    const SIGNIFICANCE_PERCENT_THRESHOLD = 10; // 10% of monthly revenue

    const percentOfMonthlyRevenue = monthlyRevenue > 0
        ? (monthlyOpportunity / monthlyRevenue) * 100
        : 0;

    const isSignificant = monthlyOpportunity >= SIGNIFICANCE_ABSOLUTE_THRESHOLD ||
        percentOfMonthlyRevenue >= SIGNIFICANCE_PERCENT_THRESHOLD;

    // For the Revenue Opportunity Projection, use the monthly opportunity we calculated
    const estimatedMonthlyGain = monthlyOpportunity > 0 ? monthlyOpportunity : null;

    const isYellow = bestBucket.riskZone === 'yellow';
    const riskNote = isYellow
        ? ' Monitor spam and bounce rates closely at this size.'
        : '';

    // Check if smaller audiences perform better (indicates value of targeted campaigns)
    const smallestBucket = safeCandidates.reduce((min, b) => b.rangeMin < min.rangeMin ? b : min, safeCandidates[0]);
    const isSmallerBetter = bestBucket.key === smallestBucket.key;
    const targetingNote = isSmallerBetter
        ? ' Sending more targeted campaigns to smaller, well-segmented audiences tends to deliver better results.'
        : '';

    // Generate title and message based on significance
    let title: string;
    let message: string;

    if (isSignificant) {
        // Action-oriented messaging - clear opportunity exists
        title = `Target ${bestBucket.rangeLabel} recipients per campaign`;
        message = `Campaigns sent to ${bestBucket.rangeLabel} recipients generate the highest revenue per email.${riskNote}${targetingNote}`;
    } else {
        // Flexibility messaging - all sizes perform similarly
        title = 'All audience sizes perform well';
        message = `Performance is consistent across audience sizes (within ${Math.round(spreadPct)}% variance). Choose based on your segmentation strategy, engagement goals, or list health priorities.${riskNote}`;
    }

    return {
        title,
        message,
        sample: formatSample(),
        targetRange: isSignificant ? bestBucket.rangeLabel : undefined,
        estimatedWeeklyGain: estimatedMonthlyGain ? estimatedMonthlyGain / 4 : null,
        estimatedMonthlyGain,
        totalMonthlyRevenue: monthlyRevenue,
        confidenceLevel,
        riskZone: bestBucket.riskZone,
        optimalCapDays,
        selectedRangeDays,
        isHighVolume,
        spreadPct,
        isSignificant,
        absoluteOpportunity: monthlyOpportunity,
        accountHasSufficientData,
        accountCoverageDays,
        accountTotalCampaigns,
        accountTotalEmails,
    };
}

function pluralize(word: string, count: number) {
    return count === 1 ? word : `${word}s`;
}

function getRiskZoneColor(zone: 'green' | 'yellow' | 'red') {
    switch (zone) {
        case 'green': return 'bg-emerald-500';
        case 'yellow': return 'bg-amber-500';
        case 'red': return 'bg-red-500';
    }
}

function getRiskZoneLabel(zone: 'green' | 'yellow' | 'red') {
    switch (zone) {
        case 'green': return 'Safe';
        case 'yellow': return 'Monitor';
        case 'red': return 'Risk';
    }
}


export default function AudienceSizePerformance({ campaigns, allCampaigns }: Props) {
    const [metric, setMetric] = useState<string>('weightedAvgCampaignRevenue');

    const { buckets, limited, lookbackWeeks, optimalCapDays, selectedRangeDays, isHighVolume } = useMemo(() => computeBuckets(campaigns || [], allCampaigns), [campaigns, allCampaigns]);
    const guidance = useMemo(() => computeAudienceSizeGuidance(buckets, lookbackWeeks, optimalCapDays, selectedRangeDays, isHighVolume, allCampaigns), [buckets, lookbackWeeks, optimalCapDays, selectedRangeDays, isHighVolume, allCampaigns]);

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
    const optimalDays = guidance?.optimalCapDays ?? 0;
    const currentDays = guidance?.selectedRangeDays ?? 0;
    const isOptimalRange = guidance ? (currentDays >= optimalDays * 0.9 && currentDays <= optimalDays * 1.1) : false;
    const accountHasSufficientData = guidance?.accountHasSufficientData ?? true;

    // Dynamic grid based on bucket count
    const getGridClass = (count: number) => {
        if (count === 1) return 'grid-cols-1 max-w-xs mx-auto';
        if (count === 2) return 'grid-cols-2 max-w-md mx-auto';
        if (count === 3) return 'grid-cols-3 max-w-3xl mx-auto';
        if (count === 4) return 'grid-cols-2 md:grid-cols-4';
        if (count === 5) return 'grid-cols-2 md:grid-cols-5';
        return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6';
    };

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
                                <p>We group campaigns by audience size (emails sent) and compare performance using weighted averages.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>Buckets are created dynamically based on natural breakpoints in your data. Recent campaigns are weighted more heavily. Holiday outliers are filtered using IQR.</p>
                                <p className="font-semibold mt-2 mb-1">Risk Zones</p>
                                <ul className="text-xs mt-1 space-y-0.5">
                                    <li><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>Green: Spam &lt;0.1%, Bounce &lt;2%</li>
                                    <li><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1"></span>Yellow: Spam 0.1-0.2%, Bounce 2-3%</li>
                                    <li><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span>Red: Spam &gt;0.2%, Bounce &gt;3%</li>
                                </ul>
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
            <div className={`grid gap-6 ${getGridClass(buckets.length)}`}>
                {buckets.map((b) => {
                    const val = getValue(b);
                    const heightPct = (val / maxVal) * 100;
                    return (
                        <div key={`${b.key}-${b.rangeLabel}`} className="flex flex-col">
                            <div className="group relative flex-1 flex flex-col justify-end min-h-[160px]">
                                <div className="w-full relative bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden flex items-end" style={{ minHeight: '160px' }}>
                                    <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-indigo-500/5 to-transparent pointer-events-none" />
                                    <div className="w-full rounded-t-lg bg-indigo-500 transition-all duration-500" style={{ height: `${heightPct}%` }} aria-label={`${b.rangeLabel}: ${formatVal(val)}`} />
                                    {/* Risk zone indicator */}
                                    <div className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${getRiskZoneColor(b.riskZone)}`} title={getRiskZoneLabel(b.riskZone)} />
                                </div>
                                <div className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">{formatVal(val)}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">{b.rangeLabel} recipients</div>
                                <div className="text-xs text-gray-500 dark:text-gray-500">{b.campaigns.length} {b.campaigns.length === 1 ? 'campaign' : 'campaigns'}</div>
                                {/* Tooltip */}
                                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition z-10 absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                                    <div className="flex items-center gap-2 font-semibold mb-1">
                                        <span>{b.rangeLabel} recipients</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${getRiskZoneColor(b.riskZone)}`}>
                                            {getRiskZoneLabel(b.riskZone)}
                                        </span>
                                    </div>
                                    <ul className="space-y-0.5">
                                        <li><span className="text-gray-500 dark:text-gray-400">Campaigns:</span> {b.campaigns.length}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Total Emails:</span> {formatNumber(b.sumEmails)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Weighted Rev/Email:</span> {formatCurrency(b.weightedRevenuePerEmail)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Weighted Avg Revenue:</span> {formatCurrency(b.weightedAvgCampaignRevenue)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Total Revenue:</span> {formatCurrency(b.sumRevenue)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">AOV:</span> {formatCurrency(b.aov)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Rev / Email:</span> {formatCurrency(b.revenuePerEmail)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Open Rate:</span> {formatPercent(b.openRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Click Rate:</span> {formatPercent(b.clickRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">CTO Rate:</span> {formatPercent(b.clickToOpenRate)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Conversion:</span> {formatPercent(b.conversionRate)}</li>
                                        <li className={b.unsubscribeRate > 0.5 ? 'text-amber-600 dark:text-amber-400' : ''}><span className="text-gray-500 dark:text-gray-400">Unsub Rate:</span> {formatPercent(b.unsubscribeRate)}</li>
                                        <li className={b.spamRate >= SPAM_GREEN_LIMIT ? (b.spamRate > SPAM_RED_LIMIT ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400') : ''}><span className="text-gray-500 dark:text-gray-400">Spam Rate:</span> {formatPercent(b.spamRate)}</li>
                                        <li className={b.bounceRate >= BOUNCE_GREEN_LIMIT ? (b.bounceRate > BOUNCE_RED_LIMIT ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400') : ''}><span className="text-gray-500 dark:text-gray-400">Bounce Rate:</span> {formatPercent(b.bounceRate)}</li>
                                    </ul>
                                    <div className="absolute left-1/2 bottom-0 translate-y-full -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-900 border-b border-r border-gray-200 dark:border-gray-700" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {guidance && (
                <div className="mt-6 space-y-3">
                    {/* Optimal Lookback Recommendation - Banner if not optimal */}
                    {accountHasSufficientData && !isOptimalRange && (
                        <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                            For optimal accuracy, we recommend analyzing the last {optimalDays} days based on your account&apos;s volume.
                        </div>
                    )}

                    {/* Insufficient Data Banner */}
                    {!accountHasSufficientData && (
                        <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                            Not enough data in the account yet. We only have {guidance.accountCoverageDays ? formatNumber(guidance.accountCoverageDays) : 'limited'} days of campaigns available so far.
                        </div>
                    )}

                    {/* Action Notes - Only if optimal */}
                    {accountHasSufficientData && isOptimalRange && (
                        <>
                            {/* Main recommendation */}
                            <div className={`flex items-start gap-2 ${guidance.riskZone === 'red' ? 'text-red-700 dark:text-red-300' :
                                guidance.riskZone === 'yellow' ? 'text-amber-700 dark:text-amber-300' :
                                    'text-gray-900 dark:text-gray-100'
                                }`}>
                                {guidance.riskZone && (
                                    <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${getRiskZoneColor(guidance.riskZone)}`} />
                                )}
                                <div>
                                    <p className="text-sm font-semibold">{guidance.title}</p>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{guidance.message}</p>
                                </div>
                            </div>

                            {/* Success Message */}
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 italic">
                                ✓ You're analyzing the optimal date range ({optimalDays} days) for your account.
                            </p>

                            {/* Revenue Opportunity Projection */}
                            {(() => {
                                // Don't show projection if all sizes perform similarly
                                if (!guidance.isSignificant) return null;

                                const gain = guidance.estimatedMonthlyGain ?? 0;
                                const totalRevenue = guidance.totalMonthlyRevenue ?? 0;
                                const percentOfRevenue = totalRevenue > 0 ? (gain / totalRevenue) * 100 : 0;
                                const isMeaningful = gain >= 1000 || percentOfRevenue >= 20;

                                if (gain > 0 && isMeaningful) {
                                    return (
                                        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                                            <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
                                                Revenue Opportunity Projection
                                            </div>
                                            <div className="text-sm text-emerald-800 dark:text-emerald-200">
                                                Targeting this audience size could generate an estimated {formatCurrency(gain)} increase in monthly revenue.
                                            </div>
                                            <div className="mt-1 text-xs text-emerald-800 dark:text-emerald-200/80">
                                                Current monthly revenue over the last {optimalDays} days: {formatCurrency(totalRevenue)}
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}

                            {guidance.sample && <p className="text-xs text-gray-500 dark:text-gray-400">{guidance.sample}</p>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
