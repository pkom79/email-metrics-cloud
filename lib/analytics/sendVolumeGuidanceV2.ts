import { DataManager } from "../data/dataManager";
import type { ProcessedCampaign } from "../data/dataTypes";
import dayjs from "../dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

export type SendVolumeStatusV2 = "send-more" | "send-less" | "optimize" | "insufficient";

export interface SendVolumeGuidanceResultV2 {
    status: SendVolumeStatusV2;
    message: string;
    sampleSize: number;
    correlationCoefficient: number | null; // Represents R-squared in this V2 logic
    projectedMonthlyGain: number | null;
    highRisk: boolean;
    avgSpamRate: number;
    avgBounceRate: number;
    dataContext: {
        lookbackDays: number;
        minCampaignsRequired: number;
        hasVariance: boolean;
        variancePercent: number;
        optimalCapDays: number;
        isHighVolume: boolean;
        capped: boolean;
        isOptimalRange?: boolean;
    };
}

interface SafetyMetrics {
    avgSpamRate: number;
    avgBounceRate: number;
}

interface WeeklyDataPoint {
    week: string;
    volume: number; // x
    revenue: number; // y
    date: dayjs.Dayjs;
}

export function sendVolumeGuidanceV2(
    dateRange: string,
    customFrom?: string,
    customTo?: string
): SendVolumeGuidanceResultV2 {
    const dm = DataManager.getInstance();
    const allCampaigns = dm.getCampaigns();

    // Step 0: Determine Sender Type (High vs Low/Med)
    // Look at last 90 days of available data to determine volume
    const lastCampaignDate = allCampaigns.length > 0 
        ? Math.max(...allCampaigns.map(c => c.sentDate.getTime())) 
        : Date.now();
    const lastDataDate = dayjs(lastCampaignDate);
    const ninetyDaysAgo = lastDataDate.subtract(90, 'days');
    
    const recentCampaigns = allCampaigns.filter(c => dayjs(c.sentDate).isAfter(ninetyDaysAgo));
    // Calculate average weekly frequency in the last 90 days
    // If data < 90 days, use actual duration
    const firstRecent = recentCampaigns.length > 0 
        ? recentCampaigns.reduce((min, c) => c.sentDate.getTime() < min ? c.sentDate.getTime() : min, lastCampaignDate)
        : lastCampaignDate;
    const durationDays = Math.max(1, dayjs(lastCampaignDate).diff(dayjs(firstRecent), 'days'));
    const weeksInPeriod = Math.max(1, durationDays / 7);
    const avgFreq = recentCampaigns.length / weeksInPeriod;
    
    // Use shared logic for optimal window
    const { days: optimalCapDays, isHighVolume } = computeOptimalVolumeWindow(allCampaigns);

    // Step 1: Date Range Parsing
    let { fromDate, toDate } = parseDateRange(dateRange, customFrom, customTo);

    // Apply Optimal Cap Logic (Informational Only)
    // We calculate if the selected range exceeds the optimal cap, but we DO NOT truncate the data.
    const capDate = lastDataDate.subtract(optimalCapDays, 'days');
    let capped = false;
    
    if (fromDate.isBefore(capDate)) {
        capped = true;
    }

    // Step 2: Filter Campaigns
    const campaignsInRange = allCampaigns.filter(c => {
        const sentDate = dayjs(c.sentDate);
        return (sentDate.isAfter(fromDate) || sentDate.isSame(fromDate, 'day')) && 
               (sentDate.isBefore(toDate) || sentDate.isSame(toDate, 'day'));
    });

    const qualifiedCampaigns = campaignsInRange.filter(c => (c.emailsSent || 0) >= 500);

    // Step 3: Minimum Data Gates
    const MIN_CAMPAIGNS = 12;
    // CRITICAL: We enforce the optimal lookback for accuracy.
    // If the user's selected range deviates significantly (>10%) from the optimal,
    // we should flag it (and potentially hide projections in strict mode).
    const lookbackDays = toDate.diff(fromDate, 'days');
    const isOptimalRange = Math.abs(lookbackDays - optimalCapDays) < (optimalCapDays * 0.15); // 15% tolerance

    const MIN_LOOKBACK_DAYS = 90;

    if (qualifiedCampaigns.length < MIN_CAMPAIGNS || lookbackDays < MIN_LOOKBACK_DAYS) {
        return createInsufficientResponse(
            qualifiedCampaigns.length, 
            lookbackDays, 
            MIN_CAMPAIGNS, 
            MIN_LOOKBACK_DAYS,
            optimalCapDays,
            isHighVolume,
            capped
        );
    }

    // Step 4: Safety Checks (The "Kill Switch")
    const safetyMetrics = calculateSafetyMetrics(qualifiedCampaigns);
    if (safetyMetrics.avgSpamRate > 0.2 || safetyMetrics.avgBounceRate > 3.0) {
        return {
            status: "send-less",
            message: "Critical deliverability risk detected. Reduce volume immediately.",
            sampleSize: qualifiedCampaigns.length,
            correlationCoefficient: null,
            projectedMonthlyGain: null,
            highRisk: true,
            avgSpamRate: safetyMetrics.avgSpamRate,
            avgBounceRate: safetyMetrics.avgBounceRate,
            dataContext: { 
                lookbackDays, 
                minCampaignsRequired: MIN_CAMPAIGNS, 
                hasVariance: false, 
                variancePercent: 0,
                optimalCapDays,
                isHighVolume,
                capped
            },
        };
    }

    // Step 5: Aggregation & Variance
    const weeklyPoints = aggregateWeeklyData(qualifiedCampaigns);
    const volumes = weeklyPoints.map(p => p.volume);
    const variancePercent = calculateVariance(volumes);

    if (variancePercent < 5.0) {
        return {
            status: "send-more",
            message: "Volume is too consistent to model. Increase volume by 20-30% to generate data.",
            sampleSize: qualifiedCampaigns.length,
            correlationCoefficient: null,
            projectedMonthlyGain: null,
            highRisk: false,
            avgSpamRate: safetyMetrics.avgSpamRate,
            avgBounceRate: safetyMetrics.avgBounceRate,
            dataContext: { 
                lookbackDays, 
                minCampaignsRequired: MIN_CAMPAIGNS, 
                hasVariance: false, 
                variancePercent,
                optimalCapDays,
                isHighVolume,
                capped
            },
        };
    }

    // --- NEW LOGIC: Logarithmic Regression ---

    // 1. Calculate Current Baseline (Last 4 active weeks average)
    // Sort by date descending to get most recent
    const sortedWeeks = [...weeklyPoints].sort((a, b) => b.date.valueOf() - a.date.valueOf());
    const recentWeeks = sortedWeeks.slice(0, 4); 
    const currentVolume = recentWeeks.reduce((sum, p) => sum + p.volume, 0) / recentWeeks.length;
    
    // 2. Perform Log Regression: Revenue = a + b * ln(Volume)
    const regression = calculateLogRegression(weeklyPoints);
    
    // 3. Determine Status based on Slope (b) and Fit (R2)
    let status: SendVolumeStatusV2 = "optimize";
    let message = "";
    let projectedGain = 0;

    // We only trust the model if R^2 > 0.1 (Weak but usable correlation)
    if (regression.r2 < 0.1) {
        status = "optimize";
        message = "There is no consistent relationship between your send volume and revenue. This often means content quality or offer timing matters more than how many emails you send.";
    } else if (regression.b > 50) { 
        // Positive slope: Adding volume adds revenue
        // We use a threshold > 50 (dollars per log-unit) to ensure it's meaningful
        status = "send-more";
        
        // PROJECT THE GAIN
        const targetVolume = currentVolume * 1.2; // +20%
        const currentPredictedRevenue = regression.predict(currentVolume);
        const targetPredictedRevenue = regression.predict(targetVolume);
        
        // Weekly Gain -> Monthly Gain
        projectedGain = (targetPredictedRevenue - currentPredictedRevenue) * 4; 
        
        message = "Your historical data shows a clear positive trend: as you increase send volume, revenue consistently grows. You haven't hit the point of diminishing returns yet, so there is room to scale.";

    } else if (regression.b < -50) {
        // Negative slope: Adding volume hurts revenue
        status = "send-less";
        message = "Your data indicates diminishing returns. Recent high-volume weeks have yielded lower revenue efficiency. Scaling back could improve your ROI and protect deliverability.";
    } else {
        // Slope is near zero (Flat curve)
        status = "optimize";
        message = "Your revenue is relatively flat regardless of volume changes. This suggests your audience is saturated at current levels. Focus on improving content relevance instead of sending more.";
    }

    // Step 7: Yellow Zone Check
    const isYellowZone = (safetyMetrics.avgSpamRate >= 0.1 && safetyMetrics.avgSpamRate <= 0.2) ||
                         (safetyMetrics.avgBounceRate >= 2.0 && safetyMetrics.avgBounceRate <= 3.0);
    const highRisk = status === "send-more" && isYellowZone;

    if (highRisk) {
        message += " Proceed with caution: Deliverability metrics are near warning thresholds.";
    }

    return {
        status,
        message,
        sampleSize: qualifiedCampaigns.length,
        correlationCoefficient: regression.r2,
        projectedMonthlyGain: Math.round(projectedGain),
        highRisk,
        avgSpamRate: safetyMetrics.avgSpamRate,
        avgBounceRate: safetyMetrics.avgBounceRate,
        dataContext: {
            lookbackDays,
            minCampaignsRequired: MIN_CAMPAIGNS,
            hasVariance: true,
            variancePercent,
            optimalCapDays,
            isHighVolume,
            capped,
            // Pass the check result so UI can show/hide warning
            isOptimalRange 
        },
    };
}

/**
 * NEW: Compute optimal volume window based on send frequency.
 * High frequency (3+/week) -> 90 days
 * Low/Med frequency -> 180 days
 */
export function computeOptimalVolumeWindow(campaigns: ProcessedCampaign[]): { days: number, isHighVolume: boolean } {
    const lastCampaignDate = campaigns.length > 0 
        ? Math.max(...campaigns.map(c => c.sentDate.getTime())) 
        : Date.now();
    const lastDataDate = dayjs(lastCampaignDate);
    
    // Look at last 90 days density
    const ninetyDaysAgo = lastDataDate.subtract(90, 'days');
    const recentCampaigns = campaigns.filter(c => dayjs(c.sentDate).isAfter(ninetyDaysAgo));
    
    const firstRecent = recentCampaigns.length > 0 
        ? recentCampaigns.reduce((min, c) => c.sentDate.getTime() < min ? c.sentDate.getTime() : min, lastCampaignDate)
        : lastCampaignDate;
        
    const durationDays = Math.max(1, dayjs(lastCampaignDate).diff(dayjs(firstRecent), 'days'));
    const weeksInPeriod = Math.max(1, durationDays / 7);
    const avgFreq = recentCampaigns.length / weeksInPeriod;
    
    const isHighVolume = avgFreq >= 3;
    
    return {
        days: isHighVolume ? 90 : 180,
        isHighVolume
    };
}

// --- HELPER FUNCTIONS ---

function aggregateWeeklyData(campaigns: ProcessedCampaign[]): WeeklyDataPoint[] {
    const weeklyData: Record<string, WeeklyDataPoint> = {};
    
    campaigns.forEach(c => {
        const sentDate = dayjs(c.sentDate);
        const weekKey = `${sentDate.year()}-W${sentDate.isoWeek()}`;
        
        if (!weeklyData[weekKey]) {
            weeklyData[weekKey] = { 
                week: weekKey, 
                volume: 0, 
                revenue: 0,
                date: sentDate 
            };
        }
        
        weeklyData[weekKey].volume += (c.emailsSent || 0);
        weeklyData[weekKey].revenue += (c.revenue || 0);
        
        if (sentDate.isAfter(weeklyData[weekKey].date)) {
            weeklyData[weekKey].date = sentDate;
        }
    });

    return Object.values(weeklyData).filter(w => w.volume > 0);
}

/**
 * Calculates Logarithmic Regression: y = a + b * ln(x)
 * Returns slope (b), intercept (a), and R-squared (r2)
 */
function calculateLogRegression(points: WeeklyDataPoint[]) {
    const n = points.length;
    let sumLnX = 0;
    let sumY = 0;
    let sumLnX2 = 0; 
    let sumY2 = 0;   
    let sumLnXY = 0; 

    points.forEach(p => {
        const x = p.volume;
        const y = p.revenue;
        // Handle edge case if volume is 0 or negative (though filtered out)
        if (x <= 0) return;
        
        const lnX = Math.log(x);

        sumLnX += lnX;
        sumY += y;
        sumLnX2 += (lnX * lnX);
        sumY2 += (y * y);
        sumLnXY += (lnX * y);
    });

    const denominator = (n * sumLnX2) - (sumLnX * sumLnX);
    
    if (denominator === 0) return { a: 0, b: 0, r2: 0, predict: () => 0 };

    const b = ((n * sumLnXY) - (sumLnX * sumY)) / denominator;
    const a = (sumY - (b * sumLnX)) / n;

    // Calculate R-Squared
    const yMean = sumY / n;
    let ssRes = 0;
    let ssTot = 0;

    points.forEach(p => {
        if (p.volume <= 0) return;
        const predictedY = a + (b * Math.log(p.volume));
        ssRes += Math.pow(p.revenue - predictedY, 2);
        ssTot += Math.pow(p.revenue - yMean, 2);
    });

    const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

    return {
        a,
        b,
        r2,
        predict: (volume: number) => a + (b * Math.log(volume))
    };
}

function calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    if (avg === 0) return 0;
    
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    const variance = squareDiffs.reduce((s, v) => s + v, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return (stdDev / avg) * 100;
}

function createInsufficientResponse(
    count: number, 
    days: number, 
    minCount: number, 
    minDays: number,
    optimalCapDays: number = 90,
    isHighVolume: boolean = false,
    capped: boolean = false
): SendVolumeGuidanceResultV2 {
    return {
        status: "insufficient",
        message: `Not enough data. Need ${minCount} campaigns and ${minDays} days history.`,
        sampleSize: count,
        correlationCoefficient: null,
        projectedMonthlyGain: null,
        highRisk: false,
        avgSpamRate: 0,
        avgBounceRate: 0,
        dataContext: { 
            lookbackDays: days, 
            minCampaignsRequired: minCount, 
            hasVariance: false, 
            variancePercent: 0,
            optimalCapDays,
            isHighVolume,
            capped
        }
    };
}

function parseDateRange(
    dateRange: string,
    customFrom?: string,
    customTo?: string
): { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs } {
    const dm = DataManager.getInstance();
    const campaigns = dm.getCampaigns();
    const flows = dm.getFlowEmails();
    
    const lastCampaignDate = campaigns.length > 0 
        ? Math.max(...campaigns.map(c => c.sentDate.getTime())) 
        : 0;
    const lastFlowDate = flows.length > 0 
        ? Math.max(...flows.map(f => f.sentDate.getTime())) 
        : 0;
        
    const maxTime = Math.max(lastCampaignDate, lastFlowDate);
    const lastDataDate = maxTime > 0 ? dayjs(maxTime) : dayjs();
    
    if (dateRange === "custom" && customFrom && customTo) {
        return {
            fromDate: dayjs(customFrom),
            toDate: dayjs(customTo),
        };
    }

    const ranges: Record<string, { fromDate: dayjs.Dayjs; toDate: dayjs.Dayjs }> = {
        "7d": { fromDate: lastDataDate.subtract(7, "days"), toDate: lastDataDate },
        "14d": { fromDate: lastDataDate.subtract(14, "days"), toDate: lastDataDate },
        "30d": { fromDate: lastDataDate.subtract(30, "days"), toDate: lastDataDate },
        "60d": { fromDate: lastDataDate.subtract(60, "days"), toDate: lastDataDate },
        "90d": { fromDate: lastDataDate.subtract(90, "days"), toDate: lastDataDate },
        "120d": { fromDate: lastDataDate.subtract(120, "days"), toDate: lastDataDate },
        "180d": { fromDate: lastDataDate.subtract(180, "days"), toDate: lastDataDate },
        "365d": { fromDate: lastDataDate.subtract(365, "days"), toDate: lastDataDate },
        "730d": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
        "all": { fromDate: lastDataDate.subtract(730, "days"), toDate: lastDataDate },
    };

    return ranges[dateRange] || ranges["90d"];
}

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

function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}