/**
 * Deliverability Zone Scoring
 * 
 * Simplified deliverability scoring using only spam and bounce rates.
 * Uses green/yellow/red zones matching the pattern in SendVolumeImpactV2 and AudienceSizePerformance.
 */

// Threshold constants matching existing patterns in the codebase
export const SPAM_GREEN_LIMIT = 0.1;   // < 0.1% = Green
export const SPAM_RED_LIMIT = 0.2;     // > 0.2% = Red
export const BOUNCE_GREEN_LIMIT = 2.0; // < 2.0% = Green
export const BOUNCE_RED_LIMIT = 3.0;   // > 3.0% = Red

export type RiskZone = 'green' | 'yellow' | 'red';

/**
 * Determine the risk zone based on spam and bounce rates.
 * Red if either metric exceeds red limit, yellow if either is in warning range, green otherwise.
 */
export function getRiskZone(spamRate: number, bounceRate: number): RiskZone {
    if (spamRate > SPAM_RED_LIMIT || bounceRate > BOUNCE_RED_LIMIT) return 'red';
    if (spamRate >= SPAM_GREEN_LIMIT || bounceRate >= BOUNCE_GREEN_LIMIT) return 'yellow';
    return 'green';
}

/**
 * Get color classes for spam rate display
 */
export function getSpamRateColor(rate: number): { text: string; dot: string } {
    if (rate < SPAM_GREEN_LIMIT) {
        return { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500 dark:bg-emerald-400' };
    }
    if (rate <= SPAM_RED_LIMIT) {
        return { text: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500 dark:bg-yellow-400' };
    }
    return { text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500 dark:bg-rose-400' };
}

/**
 * Get color classes for bounce rate display
 */
export function getBounceRateColor(rate: number): { text: string; dot: string } {
    if (rate < BOUNCE_GREEN_LIMIT) {
        return { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500 dark:bg-emerald-400' };
    }
    if (rate <= BOUNCE_RED_LIMIT) {
        return { text: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500 dark:bg-yellow-400' };
    }
    return { text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500 dark:bg-rose-400' };
}

/**
 * Calculate deliverability points (0-20) based on risk zone.
 * Includes low-volume adjustment for steps with minimal send share.
 * 
 * @param spamRate - Spam rate as percentage (e.g., 0.05 for 0.05%)
 * @param bounceRate - Bounce rate as percentage (e.g., 1.5 for 1.5%)
 * @param sendShareOfAccount - Proportion of account sends (0-1), for low-volume adjustment
 * @returns Points from 0-20
 */
export function getDeliverabilityPoints(
    spamRate: number,
    bounceRate: number,
    sendShareOfAccount: number = 0
): { points: number; zone: RiskZone; lowVolumeAdjusted: boolean } {
    const zone = getRiskZone(spamRate, bounceRate);
    
    // Base points by zone
    let basePoints: number;
    switch (zone) {
        case 'green':
            basePoints = 20;
            break;
        case 'yellow':
            basePoints = 12;
            break;
        case 'red':
            basePoints = 0;
            break;
    }
    
    // Low-volume adjustment: benefit of doubt for very small send shares
    // Only apply if base score is low (< 15) and send share is tiny (< 0.5%)
    const applyVolumeAdj = (basePoints < 15) && (sendShareOfAccount > 0) && (sendShareOfAccount < 0.005);
    let adjustedPoints = basePoints;
    
    if (applyVolumeAdj) {
        // Proportional adjustment: the smaller the share, the more benefit of doubt
        const volumeFactor = 1 - (sendShareOfAccount / 0.005); // 0..1
        adjustedPoints = basePoints + (20 - basePoints) * volumeFactor * 0.5; // Cap at 50% boost
    }
    
    return {
        points: Math.min(20, Math.max(0, adjustedPoints)),
        zone,
        lowVolumeAdjusted: applyVolumeAdj
    };
}

/**
 * Minimum sample size for statistical significance in flow step analysis
 */
export const MIN_SAMPLE_SIZE = 250;

/**
 * Minimum lookback days (even for high-volume flows)
 */
export const MIN_LOOKBACK_DAYS = 14;

/**
 * Maximum lookback days (cap for very low volume flows)
 */
export const MAX_LOOKBACK_DAYS = 365;

/**
 * Compute optimal lookback period for a step based on its send rate.
 * High-volume flows need shorter periods, low-volume flows need longer.
 * 
 * @param totalSendsInRange - Total emails sent by this step in the current date range
 * @param daysInRange - Number of days in the current date range
 * @param minSampleSize - Minimum sends needed for statistical significance (default 250)
 * @returns Optimal number of days for reliable analysis
 */
export function computeOptimalLookbackDays(
    totalSendsInRange: number,
    daysInRange: number,
    minSampleSize: number = MIN_SAMPLE_SIZE
): number {
    if (daysInRange <= 0) return MAX_LOOKBACK_DAYS;
    
    const avgDailySends = totalSendsInRange / daysInRange;
    
    if (avgDailySends <= 0) return MAX_LOOKBACK_DAYS;
    
    const optimalDays = Math.ceil(minSampleSize / avgDailySends);
    
    return Math.max(MIN_LOOKBACK_DAYS, Math.min(MAX_LOOKBACK_DAYS, optimalDays));
}

/**
 * Check if a step has sufficient data for statistical significance.
 * 
 * @param totalSends - Total emails sent by this step
 * @param daysInRange - Number of days in the current date range
 * @param optimalLookbackDays - Computed optimal lookback for this step
 * @returns Whether the step has enough data for reliable recommendations
 */
export function hasStatisticalSignificance(
    totalSends: number,
    daysInRange: number,
    optimalLookbackDays: number
): boolean {
    // Must have minimum sample size
    if (totalSends < MIN_SAMPLE_SIZE) return false;
    
    // Must have at least the optimal lookback period
    // Allow some tolerance (80%) for near-sufficient data
    if (daysInRange < optimalLookbackDays * 0.8) return false;
    
    return true;
}

/**
 * Get natural language description of deliverability risk for action notes.
 * Does NOT use technical terms like "red zone" - uses business-friendly language.
 */
export function getDeliverabilityRiskMessage(zone: RiskZone, spamRate: number, bounceRate: number): string | null {
    switch (zone) {
        case 'green':
            return null; // No warning needed
        case 'yellow':
            const yellowIssues: string[] = [];
            if (spamRate >= SPAM_GREEN_LIMIT) yellowIssues.push('spam');
            if (bounceRate >= BOUNCE_GREEN_LIMIT) yellowIssues.push('bounce');
            return `Deliverability metrics are approaching warning thresholds (${yellowIssues.join(' and ')} rates)—monitor closely before scaling further.`;
        case 'red':
            const redIssues: string[] = [];
            if (spamRate > SPAM_RED_LIMIT) redIssues.push(`spam at ${spamRate.toFixed(2)}%`);
            if (bounceRate > BOUNCE_RED_LIMIT) redIssues.push(`bounce at ${bounceRate.toFixed(1)}%`);
            return `Elevated deliverability risk—${redIssues.join(' and ')} exceed safe limits. Pause and review before continuing.`;
    }
}

/**
 * Get insufficient data message for action notes.
 */
export function getInsufficientDataMessage(
    totalSends: number,
    daysInRange: number,
    optimalLookbackDays: number
): string {
    if (totalSends < MIN_SAMPLE_SIZE) {
        const sendsNeeded = MIN_SAMPLE_SIZE - totalSends;
        return `Insufficient data for reliable analysis. This step has ${totalSends} sends; need at least ${MIN_SAMPLE_SIZE} for meaningful recommendations.`;
    }
    
    const daysNeeded = Math.ceil(optimalLookbackDays - daysInRange);
    return `Insufficient data—current date range is ${daysInRange} days, but this step's volume suggests at least ${optimalLookbackDays} days for reliable insights.`;
}
