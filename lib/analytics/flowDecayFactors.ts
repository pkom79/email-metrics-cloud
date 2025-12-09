/**
 * Flow Decay Factors and Revenue Projections
 * 
 * Provides flow-type-specific decay factors for projecting new step revenue.
 * Uses variance from existing step performance to calculate confidence intervals.
 */

/**
 * Interface for the output of projectNewStepRevenue.
 */
export interface FlowDecayProjection {
  projectedReachPerWeek: number;
  projectedRevenuePerWeek: {
    low: number;
    mid: number;
    high: number;
  };
  conservativeRPE: number;
  decayFactor: number;
  flowType: FlowType;
  confidenceLevel: 'low' | 'medium' | 'high';
  intervalMultipliers: {
    low: number;
    high: number;
  };
}

/**
 * Flow type categories with associated decay factors.
 * Decay factor represents expected reach ratio of new step vs previous step.
 */
export type FlowType = 
    | 'welcome'
    | 'abandoned-cart'
    | 'browse-abandon'
    | 'post-purchase'
    | 'winback'
    | 'birthday'
    | 'sunset'
    | 'nurture'
    | 'default';

/**
 * Decay factors by flow type.
 * These represent typical step-to-step retention patterns.
 * Lower = steeper decay (fewer recipients reach next step)
 */
const FLOW_DECAY_FACTORS: Record<FlowType, number> = {
    'welcome': 0.40,          // Steep decay - early drop-off common
    'abandoned-cart': 0.55,   // Moderate - urgency keeps engagement
    'browse-abandon': 0.50,   // Moderate-steep
    'post-purchase': 0.60,    // Gentler - engaged buyers
    'winback': 0.45,          // Steep - re-engagement is hard
    'birthday': 0.65,         // Gentle - special occasion engagement
    'sunset': 0.35,           // Very steep - disengaged audience
    'nurture': 0.55,          // Moderate - educational content
    'default': 0.50,          // General fallback
};

/**
 * Keywords to identify flow types from flow names.
 * Order matters - first match wins.
 */
const FLOW_TYPE_PATTERNS: Array<{ keywords: string[]; type: FlowType }> = [
    { keywords: ['welcome', 'onboarding', 'signup', 'sign-up', 'sign up', 'new subscriber', 'new customer'], type: 'welcome' },
    { keywords: ['abandoned cart', 'cart abandon', 'checkout abandon', 'cart recovery'], type: 'abandoned-cart' },
    { keywords: ['browse abandon', 'browsing', 'viewed product', 'product view'], type: 'browse-abandon' },
    { keywords: ['post-purchase', 'post purchase', 'thank you', 'order confirm', 'purchase follow', 'buyer'], type: 'post-purchase' },
    { keywords: ['winback', 'win-back', 'win back', 're-engage', 'reengage', 'lapsed', 'inactive'], type: 'winback' },
    { keywords: ['birthday', 'anniversary', 'bday'], type: 'birthday' },
    { keywords: ['sunset', 'suppression', 'cleanup', 'unengaged'], type: 'sunset' },
    { keywords: ['nurture', 'education', 'drip', 'sequence', 'series'], type: 'nurture' },
];

/**
 * Infer flow type from flow name.
 * 
 * @param flowName - Name of the flow
 * @returns Detected flow type or 'default' if no match
 */
export function inferFlowType(flowName: string): FlowType {
    const lowerName = flowName.toLowerCase();
    
    for (const pattern of FLOW_TYPE_PATTERNS) {
        for (const keyword of pattern.keywords) {
            if (lowerName.includes(keyword)) {
                return pattern.type;
            }
        }
    }
    
    return 'default';
}

/**
 * Get the decay factor for a flow based on its name.
 * 
 * @param flowName - Name of the flow
 * @returns Decay factor (0-1) for projecting next step reach
 */
export function getFlowDecayFactor(flowName: string): number {
    const flowType = inferFlowType(flowName);
    return FLOW_DECAY_FACTORS[flowType];
}

/**
 * Get human-readable flow type label.
 */
export function getFlowTypeLabel(flowType: FlowType): string {
    const labels: Record<FlowType, string> = {
        'welcome': 'Welcome/Onboarding',
        'abandoned-cart': 'Abandoned Cart',
        'browse-abandon': 'Browse Abandonment',
        'post-purchase': 'Post-Purchase',
        'winback': 'Win-Back',
        'birthday': 'Birthday/Anniversary',
        'sunset': 'Sunset/Suppression',
        'nurture': 'Nurture/Drip',
        'default': 'General',
    };
    return labels[flowType];
}

/**
 * Calculate variance-based confidence interval multipliers.
 * Uses coefficient of variation (CV) of existing step RPEs to determine spread.
 * 
 * @param stepRPEs - Array of revenue per email values for existing steps
 * @returns Low and high multipliers for projection range
 */
export function calculateVarianceBasedInterval(
    stepRPEs: number[]
): { lowMultiplier: number; highMultiplier: number } {
    if (stepRPEs.length < 2) {
        // Not enough data for variance - use conservative defaults
        return { lowMultiplier: 0.5, highMultiplier: 1.2 };
    }
    
    // Filter out zero values for meaningful variance
    const validRPEs = stepRPEs.filter(r => r > 0);
    if (validRPEs.length < 2) {
        return { lowMultiplier: 0.5, highMultiplier: 1.2 };
    }
    
    // Calculate mean and standard deviation
    const mean = validRPEs.reduce((sum, v) => sum + v, 0) / validRPEs.length;
    const variance = validRPEs.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / validRPEs.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation (relative spread)
    const cv = mean > 0 ? stdDev / mean : 0;
    
    // Map CV to interval width:
    // CV 0.0 (no variation) → tight interval (0.85, 1.15)
    // CV 0.5 (moderate variation) → medium interval (0.6, 1.4)
    // CV 1.0+ (high variation) → wide interval (0.4, 1.6)
    const spread = Math.min(0.6, cv * 0.6); // Cap at 0.6 spread
    
    return {
        lowMultiplier: Math.max(0.3, 1 - spread - 0.15),  // At least 0.3
        highMultiplier: Math.min(1.8, 1 + spread + 0.15), // At most 1.8
    };
}

/**
 * Project revenue for a potential new step in a flow.
 * Uses flow-specific decay and variance-based confidence intervals.
 * 
 * @param flowName - Name of the flow (for decay factor)
 * @param lastStepSends - Number of sends in the last step
 * @param lastStepRPE - Revenue per email of the last step
 * @param allStepRPEs - Array of all step RPEs for variance calculation
 * @param flowMedianRPE - Median RPE across the flow
 * @param weeksInRange - Number of weeks in the date range (for annualization)
 * @returns Projection with low/high estimates and confidence info
 */
export function projectNewStepRevenue(
    flowName: string,
    lastStepSends: number,
    lastStepRPE: number,
    allStepRPEs: number[],
    flowMedianRPE: number,
    weeksInRange: number = 1
): FlowDecayProjection {
    const flowType = inferFlowType(flowName);
    const decayFactor = FLOW_DECAY_FACTORS[flowType];
    
    // Project reach using decay factor
    const projectedReach = lastStepSends * decayFactor;
    const projectedReachPerWeek = weeksInRange > 0 ? projectedReach / weeksInRange : projectedReach;
    
    // Use conservative RPE estimate: minimum of various benchmarks
    const percentile25 = calculatePercentile(allStepRPEs, 25);
    const conservativeRPE = Math.min(
        percentile25 > 0 ? percentile25 : lastStepRPE,
        lastStepRPE,
        flowMedianRPE * 0.7
    );
    
    // Calculate variance-based interval
    const intervalMultipliers = calculateVarianceBasedInterval(allStepRPEs);
    
    // Base projection
    const baseProjection = projectedReachPerWeek * conservativeRPE;
    
    // Confidence factor based on sample size
    const confidenceFactor = Math.min(1, Math.sqrt(lastStepSends / 1000));
    
    // Apply confidence factor and interval
    const midEstimate = baseProjection * confidenceFactor;
    const lowEstimate = midEstimate * intervalMultipliers.lowMultiplier;
    const highEstimate = midEstimate * intervalMultipliers.highMultiplier;
    
    // Determine confidence level
    let confidenceLevel: 'low' | 'medium' | 'high';
    if (lastStepSends < 500 || allStepRPEs.length < 3) {
        confidenceLevel = 'low';
    } else if (lastStepSends < 2000 || allStepRPEs.length < 5) {
        confidenceLevel = 'medium';
    } else {
        confidenceLevel = 'high';
    }
    
    return {
        projectedReachPerWeek: Math.round(projectedReachPerWeek),
        projectedRevenuePerWeek: {
            low: Math.round(lowEstimate),
            mid: Math.round(midEstimate),
            high: Math.round(highEstimate),
        },
        conservativeRPE,
        decayFactor,
        flowType,
        confidenceLevel,
        intervalMultipliers: {
            low: intervalMultipliers.lowMultiplier,
            high: intervalMultipliers.highMultiplier
        },
    };
}

/**
 * Calculate a percentile value from an array.
 */
function calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) return sorted[lower];
    
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Format revenue projection for display.
 */
export function formatProjectionRange(low: number, high: number): string {
    const formatValue = (v: number): string => {
        if (v >= 1000) {
            return `$${(v / 1000).toFixed(1)}k`;
        }
        return `$${v.toFixed(0)}`;
    };
    
    return `${formatValue(low)}–${formatValue(high)}`;
}

/**
 * Get projection confidence description.
 */
export function getConfidenceDescription(level: 'low' | 'medium' | 'high'): string {
    switch (level) {
        case 'low':
            return 'Limited data—treat as directional estimate only';
        case 'medium':
            return 'Moderate confidence based on available data';
        case 'high':
            return 'High confidence based on substantial historical data';
    }
}
