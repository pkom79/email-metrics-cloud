import { DataManager } from "../data/dataManager";
import type { ProcessedCampaign } from "../data/dataTypes";
import dayjs from "../dayjs";

export type SendVolumeStatusV2 = "send-more" | "send-less" | "optimize" | "insufficient";

export interface SendVolumeGuidanceResultV2 {
    status: SendVolumeStatusV2;
    message: string;
    sampleSize: number;
    correlationCoefficient: number | null;
    highRisk: boolean; // Yellow Zone flag
    avgSpamRate: number;
    avgBounceRate: number;
    dataContext: {
        lookbackDays: number;
        minCampaignsRequired: number;
        hasVariance: boolean;
        variancePercent: number;
    };
}

interface SafetyMetrics {
    avgSpamRate: number;
    avgBounceRate: number;
}

/**
 * Calculate Send Volume Guidance V2 - Campaign-only correlation analysis
 * Follows algorithm spec with:
 * - 12 campaign minimum viable sample
 * - 90-day minimum lookback with dynamic extension
 * - 72-hour attribution lag exclusion
 * - Safety gates (Red/Yellow zones)
 * - Pearson correlation on (Volume, Total Revenue)
 */
export function sendVolumeGuidanceV2(
    dateRange: string,
    customFrom?: string,
    customTo?: string
): SendVolumeGuidanceResultV2 {
    const dm = DataManager.getInstance();
    const allCampaigns = dm.getCampaigns();

    // Step 1: Determine the user's selected date range
    const { fromDate, toDate } = parseDateRange(dateRange, customFrom, customTo);

    // Step 2: Filter campaigns within user's date range
    // Use inclusive comparisons to include boundary dates
    // Note: 72-hour attribution lag removed to match user expectations
    const campaignsInRange = allCampaigns.filter(c => {
        const sentDate = dayjs(c.sentDate);
        return (sentDate.isAfter(fromDate) || sentDate.isSame(fromDate, 'day')) && 
               (sentDate.isBefore(toDate) || sentDate.isSame(toDate, 'day'));
    });

    // Step 3: Apply Volume Floor (>= 500 recipients)
    const qualifiedCampaigns = campaignsInRange.filter(c => 
        (c.emailsSent || 0) >= 500
    );

    // Step 4: Check Minimum Viable Sample (12 campaigns, 90 days)
    const MIN_CAMPAIGNS = 12;
    const MIN_LOOKBACK_DAYS = 90;
    
    let lookbackDays = toDate.diff(fromDate, 'days');
    
    // If user's range is < 90 days or has < 12 campaigns, we need to communicate that
    const needsMoreData = qualifiedCampaigns.length < MIN_CAMPAIGNS || lookbackDays < MIN_LOOKBACK_DAYS;
    
    if (needsMoreData) {
        const missingCampaigns = Math.max(0, MIN_CAMPAIGNS - qualifiedCampaigns.length);
        const missingDays = Math.max(0, MIN_LOOKBACK_DAYS - lookbackDays);
        
        let insufficientMessage = "Not enough data to measure send volume impact. ";
        if (missingCampaigns > 0 && missingDays > 0) {
            insufficientMessage += `Need at least ${MIN_CAMPAIGNS} campaigns and ${MIN_LOOKBACK_DAYS} days of data. Currently have ${qualifiedCampaigns.length} campaigns over ${lookbackDays} days. Expand your date range.`;
        } else if (missingCampaigns > 0) {
            insufficientMessage += `Need ${missingCampaigns} more campaigns. Currently have ${qualifiedCampaigns.length} campaigns. Expand your date range to include more campaign activity.`;
        } else {
            insufficientMessage += `Need at least ${MIN_LOOKBACK_DAYS} days. Currently analyzing ${lookbackDays} days. Expand your date range.`;
        }
        
        return {
            status: "insufficient",
            message: insufficientMessage,
            sampleSize: qualifiedCampaigns.length,
            correlationCoefficient: null,
            highRisk: false,
            avgSpamRate: 0,
            avgBounceRate: 0,
            dataContext: {
                lookbackDays,
                minCampaignsRequired: MIN_CAMPAIGNS,
                hasVariance: false,
                variancePercent: 0,
            },
        };
    }

    // Step 5: Calculate Safety Metrics
    const safetyMetrics = calculateSafetyMetrics(qualifiedCampaigns);
    
    // Step 6: RED ZONE CHECK (Kill Switch) - Override everything
    const isRedZone = safetyMetrics.avgSpamRate > 0.2 || safetyMetrics.avgBounceRate > 3.0;
    if (isRedZone) {
        return {
            status: "send-less",
            message: "Critical deliverability risk detected. Your spam rate or bounce rate has exceeded safe thresholds. Reduce send volume immediately and review list quality.",
            sampleSize: qualifiedCampaigns.length,
            correlationCoefficient: null,
            highRisk: true,
            avgSpamRate: safetyMetrics.avgSpamRate,
            avgBounceRate: safetyMetrics.avgBounceRate,
            dataContext: {
                lookbackDays,
                minCampaignsRequired: MIN_CAMPAIGNS,
                hasVariance: false,
                variancePercent: 0,
            },
        };
    }

    // Step 7: Extract Volume and Revenue arrays
    const volumes: number[] = [];
    const revenues: number[] = [];
    
    qualifiedCampaigns.forEach(c => {
        volumes.push(c.emailsSent || 0);
        revenues.push(c.revenue || 0); // Include $0 revenue campaigns
    });

    // Step 8: Variance Check - Has user varied their send volume?
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const stdDev = calculateStandardDeviation(volumes);
    const variancePercent = (stdDev / avgVolume) * 100;
    const hasVariance = variancePercent >= 5.0; // 5% threshold

    if (!hasVariance) {
        return {
            status: "send-more",
            message: "Your send volume is too consistent to measure impact. Increase your send volume by 20-30% for a few campaigns to generate meaningful data.",
            sampleSize: qualifiedCampaigns.length,
            correlationCoefficient: null,
            highRisk: false,
            avgSpamRate: safetyMetrics.avgSpamRate,
            avgBounceRate: safetyMetrics.avgBounceRate,
            dataContext: {
                lookbackDays,
                minCampaignsRequired: MIN_CAMPAIGNS,
                hasVariance: false,
                variancePercent,
            },
        };
    }

    // Step 9: Calculate Pearson Correlation Coefficient
    const r = pearsonCorrelation(volumes, revenues);

    // Step 10: Determine Base Recommendation from Correlation
    let status: SendVolumeStatusV2;
    let message: string;

    if (r > 0.2) {
        // Positive correlation - more volume = more revenue
        status = "send-more";
        message = "Statistical analysis shows a positive link between send volume and total revenue. Your account has not yet reached its volume ceiling.";
    } else if (r < -0.2) {
        // Negative correlation - more volume = less revenue
        status = "send-less";
        message = "Analysis shows that increasing volume is currently reducing total revenue returns, likely due to fatigue or spam filtering.";
    } else {
        // Neutral correlation (-0.2 to 0.2)
        status = "optimize";
        message = "Send volume has no statistically significant impact on total revenue. Focus on content quality (subject lines, segmentation, offers) rather than volume.";
    }

    // Step 11: Yellow Zone Check (Risk Overlay)
    const isYellowZone = (safetyMetrics.avgSpamRate >= 0.1 && safetyMetrics.avgSpamRate <= 0.2) ||
                         (safetyMetrics.avgBounceRate >= 2.0 && safetyMetrics.avgBounceRate <= 3.0);
    
    const highRisk = status === "send-more" && isYellowZone;

    if (highRisk) {
        message = "Revenue is growing with volume, but deliverability metrics are approaching risk thresholds. Proceed with caution and monitor spam/bounce rates closely.";
    }

    return {
        status,
        message,
        sampleSize: qualifiedCampaigns.length,
        correlationCoefficient: r,
        highRisk,
        avgSpamRate: safetyMetrics.avgSpamRate,
        avgBounceRate: safetyMetrics.avgBounceRate,
        dataContext: {
            lookbackDays,
            minCampaignsRequired: MIN_CAMPAIGNS,
            hasVariance: true,
            variancePercent,
        },
    };
}

/**
 * Parse date range string into dayjs objects
 * Uses the last email date from uploaded data as the reference point, not today's date
 */
function parseDateRange(
    dateRange: string,
    customFrom?: string,
    customTo?: string
): { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs } {
    // Use the last email date from the uploaded data as reference, not today
    const dm = DataManager.getInstance();
    // Use max campaign date instead of generic last email date (which includes flows)
    // This ensures campaign analysis is anchored to actual campaign activity
    const campaigns = dm.getCampaigns();
    const lastDataDate = campaigns.length > 0
        ? dayjs(Math.max(...campaigns.map(c => new Date(c.sentDate).getTime())))
        : dayjs(dm.getLastEmailDate());
    
    if (dateRange === "custom" && customFrom && customTo) {
        return {
            fromDate: dayjs(customFrom),
            toDate: dayjs(customTo),
        };
    }

    // Parse standard ranges relative to the last data point
    const ranges: Record<string, { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs }> = {
        "7d": { fromDate: lastDataDate.subtract(7, "days"), toDate: lastDataDate },
        "14d": { fromDate: lastDataDate.subtract(14, "days"), toDate: lastDataDate },
        "30d": { fromDate: lastDataDate.subtract(30, "days"), toDate: lastDataDate },
        "60d": { fromDate: lastDataDate.subtract(60, "days"), toDate: lastDataDate },
        "90d": { fromDate: lastDataDate.subtract(90, "days"), toDate: lastDataDate },
        "180d": { fromDate: lastDataDate.subtract(180, "days"), toDate: lastDataDate },
        "365d": { fromDate: lastDataDate.subtract(365, "days"), toDate: lastDataDate },
        "730d": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
        "all": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate }, // Cap at 2 years
    };

    return ranges[dateRange] || ranges["90d"];
}

/**
 * Calculate safety metrics (spam rate, bounce rate) for campaigns
 */
function calculateSafetyMetrics(campaigns: ProcessedCampaign[]): SafetyMetrics {
    if (campaigns.length === 0) {
        return { avgSpamRate: 0, avgBounceRate: 0 };
    }

    let totalSpam = 0;
    let totalBounce = 0;
    let totalRecipients = 0;

    campaigns.forEach(c => {
        const recipients = c.emailsSent || 0;
        totalRecipients += recipients;
        totalSpam += (c.spamComplaintsCount || 0);
        totalBounce += (c.bouncesCount || 0);
    });

    const avgSpamRate = totalRecipients > 0 ? (totalSpam / totalRecipients) * 100 : 0;
    const avgBounceRate = totalRecipients > 0 ? (totalBounce / totalRecipients) * 100 : 0;

    return { avgSpamRate, avgBounceRate };
}

/**
 * Calculate standard deviation of an array
 */
function calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    
    return Math.sqrt(variance);
}

/**
 * Calculate Pearson Correlation Coefficient between two arrays
 * Returns value between -1 and +1
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
    if (xs.length !== ys.length || xs.length === 0) return 0;
    
    const n = xs.length;
    const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
    
    let numerator = 0;
    let sumSquaredDiffX = 0;
    let sumSquaredDiffY = 0;
    
    for (let i = 0; i < n; i++) {
        const diffX = xs[i] - meanX;
        const diffY = ys[i] - meanY;
        
        numerator += diffX * diffY;
        sumSquaredDiffX += diffX * diffX;
        sumSquaredDiffY += diffY * diffY;
    }
    
    const denominator = Math.sqrt(sumSquaredDiffX * sumSquaredDiffY);
    
    if (denominator === 0) return 0;
    
    return numerator / denominator;
}
