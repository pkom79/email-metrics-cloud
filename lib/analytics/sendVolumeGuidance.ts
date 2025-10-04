import { DataManager } from "../data/dataManager";
import type { ProcessedCampaign, ProcessedFlowEmail } from "../data/dataTypes";

export type SendVolumeChannel = "campaigns" | "flows";
export type SendVolumeStatus = "send-more" | "send-less" | "keep-as-is" | "insufficient";
export type SendVolumePeriod = "weekly" | "monthly";

export interface SendVolumeGuidanceResult {
    channel: SendVolumeChannel;
    status: SendVolumeStatus;
    message: string;
    sampleSize: number;
    periodType: SendVolumePeriod | null;
    revenueScore: number;
    riskScore: number;
    correlations: {
        volumeVsRevenue: CorrelationDetail;
        volumeVsUnsubs: CorrelationDetail;
        volumeVsComplaints: CorrelationDetail;
        volumeVsBounces: CorrelationDetail;
    };
}

export interface CorrelationDetail {
    r: number | null;
    n: number;
}

interface ComputeOptions {
    dateRange: string;
    customFrom?: string;
    customTo?: string;
    minWeeklySamples?: number;
    minMonthlySamples?: number;
    campaigns?: ProcessedCampaign[];
    flows?: ProcessedFlowEmail[];
}

interface SeriesPoint {
    emails: number;
    revenue: number;
    unsubRate: number;
    spamRate: number;
    bounceRate: number;
}

const DEFAULT_MIN_WEEKS = 6;
const DEFAULT_MIN_MONTHS = 3;

const STATUS_MESSAGES: Record<SendVolumeChannel, Record<Exclude<SendVolumeStatus, "insufficient">, string>> = {
    campaigns: {
        "send-more": "When you sent more campaigns during the review period, revenue increased without hurting deliverability. Try sending more frequently and monitor reputation and engagement.",
        "send-less": "At the current campaign volume, deliverability and engagement have been declining, and sending more did not drive meaningful revenue. Reduce frequency to protect sender reputation.",
        "keep-as-is": "Your current campaign frequency supports healthy reputation. When you pushed higher, revenue gains were too small and reputation worsened. Stay on your current schedule.",
    },
    flows: {
        "send-more": "When overall flow sends increased, revenue went up without damaging reputation. Review the Flow Step Analysis to see which flows and steps drive these gains, and consider extending high-performing flows.",
        "send-less": "Increasing flow volume hasn’t brought meaningful revenue and has strained deliverability. Use the Flow Step Analysis to identify flows or steps that should be scaled back or removed.",
        "keep-as-is": "Your current flow volume supports good deliverability. Sending more added little revenue and hurt reputation. Use the Flow Step Analysis to refine. Some flows may still be expandable, while weaker steps might need trimming.",
    },
};

const INSUFFICIENT_MESSAGES: Record<SendVolumeChannel, string> = {
    campaigns: "There isn’t enough consistent campaign data to measure how changes in send volume affect revenue or reputation. Try adjusting the date range or using a broader time granularity to build a clearer picture before changing your sending frequency.",
    flows: "There isn’t enough consistent flow data to measure how send volume impacts performance. Adjust the date range or granularity to uncover stronger patterns.",
};

export function computeSendVolumeGuidance(
    channel: SendVolumeChannel,
    options: ComputeOptions,
    dm: DataManager = DataManager.getInstance()
): SendVolumeGuidanceResult {
    const { dateRange, customFrom, customTo, minWeeklySamples = DEFAULT_MIN_WEEKS, minMonthlySamples = DEFAULT_MIN_MONTHS } = options;

    const subsetCampaigns = channel === "campaigns"
        ? (options.campaigns ?? dm.getCampaigns())
        : (options.campaigns ?? []);
    const subsetFlows = channel === "flows"
        ? (options.flows ?? dm.getFlowEmails())
        : (options.flows ?? []);

    const weeklySeries = buildSeriesPoints(dm, subsetCampaigns, subsetFlows, dateRange, customFrom, customTo, "weekly");
    let periodType: SendVolumePeriod | null = null;
    let seriesForScoring: SeriesPoint[] = [];

    if (weeklySeries.length >= minWeeklySamples) {
        seriesForScoring = weeklySeries;
        periodType = "weekly";
    } else {
        const monthlySeries = buildSeriesPoints(dm, subsetCampaigns, subsetFlows, dateRange, customFrom, customTo, "monthly");
        if (monthlySeries.length >= minMonthlySamples) {
            seriesForScoring = monthlySeries;
            periodType = "monthly";
        }
    }

    if (!seriesForScoring.length || !periodType) {
        return {
            channel,
            status: "insufficient",
            message: INSUFFICIENT_MESSAGES[channel],
            sampleSize: seriesForScoring.length,
            periodType: null,
            revenueScore: 0,
            riskScore: 0,
            correlations: {
                volumeVsRevenue: { r: null, n: 0 },
                volumeVsUnsubs: { r: null, n: 0 },
                volumeVsComplaints: { r: null, n: 0 },
                volumeVsBounces: { r: null, n: 0 },
            },
        };
    }

    const emails = seriesForScoring.map(p => p.emails);
    const revenue = seriesForScoring.map(p => p.revenue);
    const unsubRates = seriesForScoring.map(p => p.unsubRate);
    const spamRates = seriesForScoring.map(p => p.spamRate);
    const bounceRates = seriesForScoring.map(p => p.bounceRate);

    const volumeVsRevenue = pearson(emails, revenue);
    const volumeVsUnsubs = pearson(emails, unsubRates);
    const volumeVsComplaints = pearson(emails, spamRates);
    const volumeVsBounces = pearson(emails, bounceRates);

    const revenueScore = correlationToScore(volumeVsRevenue.r);
    const riskComponents = [volumeVsUnsubs.r, volumeVsComplaints.r, volumeVsBounces.r]
        .map(r => correlationToScore(r))
        .map(score => (score > 0 ? score : 0));
    const riskScore = riskComponents.length ? Math.max(...riskComponents) : 0;

    let status: SendVolumeStatus;
    if (revenueScore >= 1 && riskScore <= 0) status = "send-more";
    else if (riskScore >= 2 || (riskScore >= 1 && revenueScore <= 0)) status = "send-less";
    else status = "keep-as-is";

    const message = STATUS_MESSAGES[channel][status];

    return {
        channel,
        status,
        message,
        sampleSize: seriesForScoring.length,
        periodType,
        revenueScore,
        riskScore,
        correlations: {
            volumeVsRevenue,
            volumeVsUnsubs,
            volumeVsComplaints,
            volumeVsBounces,
        },
    };
}

function buildSeriesPoints(
    dm: DataManager,
    campaigns: ProcessedCampaign[],
    flows: ProcessedFlowEmail[],
    dateRange: string,
    customFrom: string | undefined,
    customTo: string | undefined,
    granularity: "weekly" | "monthly"
): SeriesPoint[] {
    const emailsSeries = dm.getMetricTimeSeries(campaigns, flows, "emailsSent", dateRange, granularity, customFrom, customTo);
    const revenueSeries = dm.getMetricTimeSeries(campaigns, flows, "revenue", dateRange, granularity, customFrom, customTo);
    const unsubSeries = dm.getMetricTimeSeries(campaigns, flows, "unsubscribeRate", dateRange, granularity, customFrom, customTo);
    const spamSeries = dm.getMetricTimeSeries(campaigns, flows, "spamRate", dateRange, granularity, customFrom, customTo);
    const bounceSeries = dm.getMetricTimeSeries(campaigns, flows, "bounceRate", dateRange, granularity, customFrom, customTo);

    const points: SeriesPoint[] = [];
    const length = Math.min(emailsSeries.length, revenueSeries.length, unsubSeries.length, spamSeries.length, bounceSeries.length);
    for (let i = 0; i < length; i++) {
        const emails = Number(emailsSeries[i]?.value ?? 0);
        const revenue = Number(revenueSeries[i]?.value ?? 0);
        const unsubRate = Number(unsubSeries[i]?.value ?? 0);
        const spamRate = Number(spamSeries[i]?.value ?? 0);
        const bounceRate = Number(bounceSeries[i]?.value ?? 0);
        if (!Number.isFinite(emails) || emails <= 0) continue; // require actual sends
        if (!Number.isFinite(revenue) && !Number.isFinite(unsubRate) && !Number.isFinite(spamRate) && !Number.isFinite(bounceRate)) continue;
        points.push({ emails, revenue, unsubRate, spamRate, bounceRate });
    }
    return points;
}

function pearson(xs: number[], ys: number[]): CorrelationDetail {
    const pairs: { x: number; y: number }[] = [];
    for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const y = ys[i];
        if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
    }
    if (pairs.length < 3) return { r: null, n: pairs.length };
    const xVals = pairs.map(p => p.x);
    const yVals = pairs.map(p => p.y);
    const mean = (arr: number[]) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const mx = mean(xVals);
    const my = mean(yVals);
    let numerator = 0;
    let dxs = 0;
    let dys = 0;
    for (let i = 0; i < pairs.length; i++) {
        const dx = xVals[i] - mx;
        const dy = yVals[i] - my;
        numerator += dx * dy;
        dxs += dx * dx;
        dys += dy * dy;
    }
    if (dxs === 0 || dys === 0) return { r: null, n: pairs.length };
    return { r: numerator / Math.sqrt(dxs * dys), n: pairs.length };
}

function correlationToScore(r: number | null): number {
    if (r == null || !Number.isFinite(r)) return 0;
    if (r >= 0.45) return 2;
    if (r >= 0.2) return 1;
    if (r <= -0.45) return -2;
    if (r <= -0.2) return -1;
    return 0;
}
