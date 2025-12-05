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
    // weighted stats (new)
    weightedAvgCampaignRevenue: number;
    weightedStdDevCampaignRevenue: number;
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
    confidenceLevel?: 'high' | 'medium' | 'low';
    riskZone?: 'green' | 'yellow' | 'red';
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

// Dynamic bucket boundaries using natural breakpoints
function computeDynamicBucketBoundaries(sortedEmails: number[]): number[] {
    if (sortedEmails.length === 0) return [];

    const min = sortedEmails[0];
    const max = sortedEmails[sortedEmails.length - 1];

    if (min === max) return [min, max];

    // Use Jenks natural breaks algorithm approximation for dynamic bucketing
    // For simplicity, we use a combination of percentile gaps and value clustering
    const n = sortedEmails.length;

    // Calculate gaps between consecutive values
    const gaps: { index: number; gap: number; normalizedGap: number }[] = [];
    for (let i = 1; i < n; i++) {
        const gap = sortedEmails[i] - sortedEmails[i - 1];
        gaps.push({
            index: i,
            gap,
            normalizedGap: gap / (max - min),
        });
    }

    // Find significant gaps (> 10% of total range or > 2x median gap)
    const sortedGaps = [...gaps].sort((a, b) => b.normalizedGap - a.normalizedGap);
    const medianGap = gaps.length > 0
        ? [...gaps].sort((a, b) => a.gap - b.gap)[Math.floor(gaps.length / 2)].gap
        : 0;

    const significantGaps = sortedGaps.filter(g =>
        g.normalizedGap > 0.1 || g.gap > medianGap * 2
    ).slice(0, 5); // Max 5 breakpoints = 6 buckets

    // If no significant gaps, use percentile-based breaks
    if (significantGaps.length === 0 || n < 6) {
        const boundaries: number[] = [min];
        const numBuckets = Math.min(Math.max(2, Math.ceil(n / 3)), 5);
        for (let i = 1; i < numBuckets; i++) {
            const pctIdx = Math.floor((i / numBuckets) * (n - 1));
            boundaries.push(sortedEmails[pctIdx]);
        }
        boundaries.push(max);
        // Dedupe
        return [...new Set(boundaries)].sort((a, b) => a - b);
    }

    // Use natural breaks
    const breakIndices = significantGaps.map(g => g.index).sort((a, b) => a - b);
    const boundaries: number[] = [min];
    for (const idx of breakIndices) {
        if (idx > 0 && idx < n) {
            boundaries.push(sortedEmails[idx]);
        }
    }
    boundaries.push(max);

    // Dedupe and ensure we have at least 2 boundaries
    const unique = [...new Set(boundaries)].sort((a, b) => a - b);
    return unique.length >= 2 ? unique : [min, max];
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
    const limited = sample < 12;

    if (sample === 0) return { buckets: [], limited: true, lookbackWeeks: 0 };

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
    const boundaries = computeDynamicBucketBoundaries(sortedEmails);

    if (boundaries.length < 2) {
        return { buckets: [], limited: true, lookbackWeeks: 0 };
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
            riskZone,
        };
    }).filter(b => b.campaigns.length > 0);

    let lookbackWeeks = 0;
    if (minDate.getTime() < maxDate.getTime()) {
        const days = Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24))) + 1;
        lookbackWeeks = Math.max(1, Math.round(days / 7));
    }

    return { buckets, limited, lookbackWeeks };
}

const AUDIENCE_MIN_TOTAL_CAMPAIGNS = 12;
const AUDIENCE_MIN_BUCKET_CAMPAIGNS = 3;
const AUDIENCE_MIN_TOTAL_EMAILS = 50_000;
const AUDIENCE_MIN_BUCKET_EMAILS = 10_000;

function computeAudienceSizeGuidance(buckets: Bucket[], lookbackWeeks: number): AudienceGuidanceResult | null {
    if (!buckets.length) return null;

    const totalCampaigns = buckets.reduce((sum, b) => sum + b.campaigns.length, 0);
    const totalEmails = buckets.reduce((sum, b) => sum + b.sumEmails, 0);

    const formatSample = (override?: number) => {
        const count = typeof override === 'number' ? override : totalCampaigns;
        if (count <= 0) return null;
        return `Based on ${count} ${pluralize('campaign', count)} in this date range.`;
    };

    // Insufficient data check
    if (totalCampaigns < AUDIENCE_MIN_TOTAL_CAMPAIGNS || totalEmails < AUDIENCE_MIN_TOTAL_EMAILS) {
        const message = `This date range includes only ${totalCampaigns} ${pluralize('campaign', totalCampaigns)} across distinct audience sizes. Expand the range or keep sending before adjusting targeting.`;
        return {
            title: 'Not enough data for a recommendation',
            message,
            sample: formatSample(totalCampaigns),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
            confidenceLevel: 'low',
        };
    }

    // Filter qualified buckets
    const qualified = buckets.filter(b =>
        b.campaigns.length >= AUDIENCE_MIN_BUCKET_CAMPAIGNS &&
        b.sumEmails >= AUDIENCE_MIN_BUCKET_EMAILS
    );

    if (!qualified.length) {
        const message = 'Campaigns at each audience size are too sparse to compare. Gather more sends per size before changing targeting.';
        return {
            title: 'Not enough data for a recommendation',
            message,
            sample: formatSample(totalCampaigns),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
            confidenceLevel: 'low',
        };
    }

    // Filter out Red zone buckets from recommendations (but use them for baseline)
    const safeCandidates = qualified.filter(b => b.riskZone !== 'red');

    if (!safeCandidates.length) {
        // All buckets are in Red zone
        return {
            title: 'Focus on list hygiene before scaling',
            message: `All audience sizes show elevated spam (>${SPAM_RED_LIMIT}%) or bounce rates (>${BOUNCE_RED_LIMIT}%). Clean your list and improve email quality before expanding sends.`,
            sample: formatSample(totalCampaigns),
            estimatedWeeklyGain: null,
            estimatedMonthlyGain: null,
            confidenceLevel: 'low',
            riskZone: 'red',
        };
    }

    // Find dominant bucket (most campaigns - this is the baseline)
    const dominant = qualified.reduce<Bucket>((best, curr) =>
        (curr.campaigns.length > best.campaigns.length ? curr : best), qualified[0]);

    // Find best performer by weighted average campaign revenue (among safe candidates)
    const sortedByRevenue = [...safeCandidates].sort((a, b) =>
        b.weightedAvgCampaignRevenue - a.weightedAvgCampaignRevenue
    );
    const bestBucket = sortedByRevenue[0];

    // LCB-based projection calculation
    // Formula: LCB = Target_Avg - (1.96 * (Target_StdDev / sqrt(N)))
    const calculateLCBProjection = (target: Bucket, baseline: Bucket): { gain: number | null; confidenceLevel: 'high' | 'medium' | 'low' } => {
        const N = target.campaigns.length;

        // Need at least 3 campaigns for meaningful confidence
        if (N < 3) return { gain: null, confidenceLevel: 'low' };

        const targetAvg = target.weightedAvgCampaignRevenue;
        const targetStdDev = target.weightedStdDevCampaignRevenue;
        const baselineAvg = baseline.weightedAvgCampaignRevenue;

        const marginOfError = 1.96 * (targetStdDev / Math.sqrt(N));
        const lcb = targetAvg - marginOfError;

        // Calculate coefficient of variation for confidence level
        const cv = targetAvg > 0 ? targetStdDev / targetAvg : Infinity;
        const confidenceLevel: 'high' | 'medium' | 'low' =
            cv < 0.3 && N >= 6 ? 'high' :
                cv < 0.5 && N >= 4 ? 'medium' : 'low';

        if (lcb > baselineAvg) {
            // Monthly projection: (LCB - baseline) * avg campaigns per week * 4 weeks
            const avgCampaignsPerWeek = lookbackWeeks > 0 ? target.campaigns.length / lookbackWeeks : 1;
            const weeklyGain = (lcb - baselineAvg) * avgCampaignsPerWeek;
            return { gain: weeklyGain * 4, confidenceLevel };
        }

        return { gain: null, confidenceLevel };
    };

    const { gain: projectedMonthlyGain, confidenceLevel } = calculateLCBProjection(bestBucket, dominant);

    const headerRange = (label: string) => `${label} total recipients per campaign`;
    const baselineRevenue = dominant.weightedAvgCampaignRevenue;
    const targetRevenue = bestBucket.weightedAvgCampaignRevenue;
    const lift = baselineRevenue === 0 ? (targetRevenue > 0 ? Infinity : 0) : (targetRevenue - baselineRevenue) / baselineRevenue;
    const liftPct = formatDeltaPct(lift);
    const isYellow = bestBucket.riskZone === 'yellow';
    const riskWarning = isYellow
        ? ' Note: This audience size shows slightly elevated risk metrics (Yellow Zone), so monitor spam and bounce rates closely.'
        : '';

    // Calculate confidence level for the best bucket directly
    const bestBucketN = bestBucket.campaigns.length;
    const bestBucketCV = bestBucket.weightedAvgCampaignRevenue > 0 
        ? bestBucket.weightedStdDevCampaignRevenue / bestBucket.weightedAvgCampaignRevenue 
        : Infinity;
    const bestBucketConfidence: 'high' | 'medium' | 'low' =
        bestBucketCV < 0.3 && bestBucketN >= 6 ? 'high' :
        bestBucketCV < 0.5 && bestBucketN >= 4 ? 'medium' : 'low';

    // Case A: Best is already dominant (stay)
    if (bestBucket.key === dominant.key) {
        // Check if there are larger buckets with insufficient data
        const largerBuckets = buckets.filter(b => b.rangeMin > bestBucket.rangeMax);
        const noLargerData = largerBuckets.every(b => b.campaigns.length < AUDIENCE_MIN_BUCKET_CAMPAIGNS);
        const hasLargerBuckets = largerBuckets.length > 0;

        // If we have high confidence in the current best bucket
        if (bestBucketConfidence === 'high') {
            const growthHint = hasLargerBuckets && noLargerData && !isYellow
                ? ` You could also test audiences above ${formatEmailsShort(bestBucket.rangeMax)} to explore further scaling.`
                : '';
            return {
                title: `Send campaigns to ${headerRange(bestBucket.rangeLabel)}`,
                message: `${bestBucket.rangeLabel} audiences generate the highest weighted revenue per campaign with strong statistical confidence.${growthHint}${riskWarning}`,
                sample: formatSample(),
                baselineRange: bestBucket.rangeLabel,
                targetRange: bestBucket.rangeLabel,
                estimatedWeeklyGain: 0,
                estimatedMonthlyGain: 0,
                confidenceLevel: 'high',
                riskZone: bestBucket.riskZone,
            };
        }

        // Medium confidence - still recommend but note room for improvement
        if (bestBucketConfidence === 'medium') {
            return {
                title: `Send campaigns to ${headerRange(bestBucket.rangeLabel)}`,
                message: `${bestBucket.rangeLabel} audiences generate the highest weighted revenue per campaign.${riskWarning}`,
                sample: formatSample(),
                baselineRange: bestBucket.rangeLabel,
                targetRange: bestBucket.rangeLabel,
                estimatedWeeklyGain: 0,
                estimatedMonthlyGain: 0,
                confidenceLevel: 'medium',
                riskZone: bestBucket.riskZone,
            };
        }

        // Low confidence - suggest testing larger if applicable
        if (!isYellow && noLargerData && bestBucket.rangeMax < 100000) {
            return {
                title: `Test larger audiences above ${formatEmailsShort(bestBucket.rangeMax)}`,
                message: `${bestBucket.rangeLabel} recipients is your best performing audience size with healthy deliverability. Consider testing larger audiences to see if you can scale revenue further.`,
                sample: formatSample(),
                baselineRange: bestBucket.rangeLabel,
                targetRange: `>${formatEmailsShort(bestBucket.rangeMax)}`,
                estimatedWeeklyGain: null,
                estimatedMonthlyGain: null,
                confidenceLevel: 'low',
                riskZone: bestBucket.riskZone,
            };
        }

        return {
            title: `Send campaigns to ${headerRange(bestBucket.rangeLabel)}`,
            message: `${bestBucket.rangeLabel} audiences generate the highest weighted revenue per campaign.${riskWarning}`,
            sample: formatSample(),
            baselineRange: bestBucket.rangeLabel,
            targetRange: bestBucket.rangeLabel,
            estimatedWeeklyGain: 0,
            estimatedMonthlyGain: 0,
            confidenceLevel: bestBucketConfidence,
            riskZone: bestBucket.riskZone,
        };
    }

    // Case B: Best is different from dominant
    const isConfident = bestBucket.campaigns.length >= 6 && confidenceLevel !== 'low';

    if (isConfident && projectedMonthlyGain && projectedMonthlyGain >= 500) {
        // High confidence recommendation with projection
        return {
            title: `Scale to ${headerRange(bestBucket.rangeLabel)}`,
            message: `${bestBucket.rangeLabel} audiences generate ${liftPct} higher weighted revenue per campaign than your current focus.${riskWarning}`,
            sample: formatSample(),
            baselineRange: dominant.rangeLabel,
            targetRange: bestBucket.rangeLabel,
            estimatedWeeklyGain: projectedMonthlyGain / 4,
            estimatedMonthlyGain: projectedMonthlyGain,
            confidenceLevel,
            riskZone: bestBucket.riskZone,
        };
    }

    // Lower confidence - suggest testing
    return {
        title: `Test ${headerRange(bestBucket.rangeLabel)}`,
        message: `${bestBucket.rangeLabel} recipients show higher revenue potential (${liftPct}) but need more data for a confident recommendation.${riskWarning} Run targeted tests at this audience size.`,
        sample: formatSample(),
        baselineRange: dominant.rangeLabel,
        targetRange: bestBucket.rangeLabel,
        estimatedWeeklyGain: null,
        estimatedMonthlyGain: null,
        confidenceLevel: 'low',
        riskZone: bestBucket.riskZone,
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
    const sign = value >= 0 ? '+' : '-';
    return `${sign}${abs.toFixed(decimals)}%`;
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


export default function AudienceSizePerformance({ campaigns }: Props) {
    const [metric, setMetric] = useState<string>('weightedAvgCampaignRevenue');

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
                                        <li><span className="text-gray-500 dark:text-gray-400">Weighted Avg Revenue:</span> {formatCurrency(b.weightedAvgCampaignRevenue)}</li>
                                        <li><span className="text-gray-500 dark:text-gray-400">Simple Avg Revenue:</span> {formatCurrency(b.avgCampaignRevenue)}</li>
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
                <div className={`border rounded-xl p-4 mt-6 ${guidance.riskZone === 'red'
                        ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20'
                        : guidance.riskZone === 'yellow'
                            ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20'
                            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                    }`}>
                    <div className="flex items-start gap-2">
                        {guidance.riskZone && (
                            <span className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${getRiskZoneColor(guidance.riskZone)}`} />
                        )}
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{guidance.title}</p>
                            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{guidance.message}</p>
                            {guidance.estimatedMonthlyGain != null && guidance.estimatedMonthlyGain >= 500 && (
                                <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                    {guidance.confidenceLevel === 'high'
                                        ? `Monthly revenue could increase by an estimated ${formatCurrency(guidance.estimatedMonthlyGain)} by scaling to this audience size.`
                                        : `Monthly revenue could increase by approximately ${formatCurrency(guidance.estimatedMonthlyGain)} (moderate confidence).`
                                    }
                                </p>
                            )}
                            {guidance.confidenceLevel && guidance.confidenceLevel !== 'high' && !guidance.estimatedMonthlyGain && (
                                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">
                                    {guidance.confidenceLevel === 'low'
                                        ? 'More data needed for revenue projections.'
                                        : 'Gathering more campaign data will improve projection accuracy.'
                                    }
                                </p>
                            )}
                            {guidance.sample && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{guidance.sample}</p>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
