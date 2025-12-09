import {
  AccountDeliverabilityContext,
  getDeliverabilityZoneWithContext,
  getRiskZone,
  RiskZone,
  SPAM_GREEN_LIMIT,
  SPAM_RED_LIMIT,
  BOUNCE_GREEN_LIMIT,
  BOUNCE_RED_LIMIT,
  getDeliverabilityRiskMessage,
  computeOptimalLookbackDays,
  computeOptimalLookbackDaysSnapped,
  MIN_SAMPLE_SIZE
} from "./deliverabilityZones";
import {
  calculateMoneyPillarScoreStandalone,
} from "./revenueTiers";
import {
  inferFlowType,
  projectNewStepRevenue,
  FlowDecayProjection
} from "./flowDecayFactors";
import { ProcessedFlowEmail } from "../data/dataTypes";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface FlowStepMetricsReduced {
  sequencePosition: number;
  emailName: string;
  emailsSent: number;
  revenue: number;
  openRate: number;
  clickRate: number;
  revenuePerEmail: number;
  spamRate: number; // percentage 0-100
  bounceRate: number; // percentage 0-100
  avgOrderValue: number;
  // Raw counts
  spamComplaintsCount: number;
  bouncesCount: number;
}

export interface FlowScoreResult {
  score: number;
  action: 'scale' | 'keep' | 'improve' | 'pause' | 'insufficient';
  volumeInsufficient: boolean;
  isLowVolumeStep: boolean;
  dateRangeAdequate: boolean;
  needsMoreTime: boolean;
  notes: string[];
  pillars: {
    money: {
      points: number;
      ri: number;
      annualizedRevenue: number;
      monthlyRevenue: number;
      absoluteRevenue: number;
    };
    deliverability: {
      points: number;
      effectiveZone: RiskZone;
      wasDowngraded: boolean;
      hasRedZone: boolean;
      hasYellowZone: boolean;
    };
    confidence: {
      points: number;
      optimalLookbackDays: number;
      hasStatisticalSignificance: boolean;
    };
  };
}

export interface AddStepOpportunity {
  flowName: string;
  stepSequence: number; // The step we are analyzing (Sequence N) -> Suggesting N+1
  projectedRevenue: FlowDecayProjection; // The projection object
  scoreResult: FlowScoreResult; // The score of step N which justifies the add
  isOpportunity: boolean; // True if it passes the filters
}

// ------------------------------------------------------------------
// Core Logic
// ------------------------------------------------------------------

/**
 * Computes the complete scorecard for a single flow step.
 * Mirrors the logic originally in FlowStepAnalysis.tsx (lines 525-778).
 */
export function computeFlowStepScore(
  step: FlowStepMetricsReduced,
  accountContext: AccountDeliverabilityContext,
  baselines: {
    medianRPE: number;
    storeRevenueTotal: number;
    dateRangeDays: number;
    s1Sends: number | null; // Pass null to skip relative volume checks if needed
    flowRevenueTotal: number;
  },
  flowName: string
): FlowScoreResult {
  const {
    medianRPE,
    storeRevenueTotal,
    dateRangeDays,
    flowRevenueTotal
  } = baselines;

  const emailsSent = step.emailsSent || 0;
  const notes: string[] = [];

  // 1. Confidence & Volume Check
  const optimalLookbackDays = computeOptimalLookbackDays(emailsSent, dateRangeDays);
  const optimalLookbackDaysSnapped = computeOptimalLookbackDaysSnapped(emailsSent, dateRangeDays);
  
  // "Adequate" means we are looking at roughly enough days for this volume
  const dateRangeAdequate = dateRangeDays >= optimalLookbackDays * 0.8;
  const hasMinSampleSize = emailsSent >= MIN_SAMPLE_SIZE; // 250
  const volumeSufficient = hasMinSampleSize && dateRangeAdequate;
  const isLowVolumeStep = !hasMinSampleSize;
  const needsMoreTime = !dateRangeAdequate;

  // 2. Money Pillar (Standalone)
  const moneyScore = calculateMoneyPillarScoreStandalone(
    step.revenuePerEmail,
    medianRPE,
    step.revenue,
    dateRangeDays
  );
  if (moneyScore.riValue >= 1.4) notes.push('High Revenue Index');
  if (storeRevenueTotal <= 0) notes.push('No store revenue in window');

  const isHighValueStep = moneyScore.annualizedRevenue >= 50000;

  // 3. Deliverability Pillar (Context-Aware)
  const contextZoneResult = getDeliverabilityZoneWithContext(
    step.spamRate,
    step.bounceRate,
    emailsSent,
    step.spamComplaintsCount,
    step.bouncesCount,
    accountContext
  );

  const effectiveZone = contextZoneResult.effectiveZone;
  const deliverabilityPoints = contextZoneResult.points;
  const wasDowngraded = contextZoneResult.wasDowngraded;

  const hasRedZone = effectiveZone === 'red';
  const hasYellowZone = effectiveZone === 'yellow';

  // 4. Scoring Components
  // Confidence Points
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  const scPoints = volumeSufficient
    ? clamp(Math.floor(emailsSent / 100), 0, 10)
    : (dateRangeAdequate ? clamp(Math.floor(emailsSent / 50), 0, 5) : 0);

  const moneyPoints = moneyScore.totalPoints;
  const highMoney = (moneyPoints >= 55) || (moneyScore.riValue >= 1.4);

  let score = clamp(moneyPoints + deliverabilityPoints + scPoints, 0, 100);
  let action: FlowScoreResult['action'] = 'improve';

  // 5. Action Logic (The Decision Tree)
  if (!volumeSufficient && needsMoreTime) {
      action = hasRedZone ? 'pause' : 'insufficient';
      if (hasRedZone) {
          const riskMsg = getDeliverabilityRiskMessage(effectiveZone, step.spamRate, step.bounceRate);
          if (riskMsg) notes.push(riskMsg);
      } else {
          notes.push(`Extend date range to at least ${optimalLookbackDaysSnapped} days for reliable insights.`);
      }
  } else if (!volumeSufficient && isLowVolumeStep && dateRangeAdequate) {
      if (hasRedZone) {
          action = 'pause';
          const riskMsg = getDeliverabilityRiskMessage(effectiveZone, step.spamRate, step.bounceRate);
          if (riskMsg) notes.push(riskMsg);
      } else if (hasYellowZone && !highMoney) {
          action = 'improve';
          notes.push(`Limited data (${emailsSent} sends)—results may be noisy but date range is adequate.`);
      } else {
          action = highMoney ? 'keep' : 'improve';
          notes.push(`Limited data (${emailsSent} sends)—results may be noisy.`);
      }
  } else if (hasRedZone) {
      action = 'pause';
      const riskMsg = getDeliverabilityRiskMessage(effectiveZone, step.spamRate, step.bounceRate);
      if (riskMsg) notes.push(riskMsg);
  } else if (hasYellowZone && highMoney) {
      action = 'keep';
      if (wasDowngraded) {
          notes.push(contextZoneResult.reason);
      } else {
          notes.push('Deliverability approaching warning thresholds—monitor closely');
      }
  } else if (hasYellowZone && !highMoney) {
      action = 'improve';
      if (wasDowngraded) {
          notes.push(contextZoneResult.reason);
      } else {
          notes.push('Address deliverability concerns');
      }
  } else if (score >= 75) {
      action = 'scale';
  } else if (score >= 60) {
      action = 'keep';
  } else if (score >= 40) {
      action = 'improve';
  } else {
      action = 'pause';
  }

  // Guardrail
  const flowShareForGuard = flowRevenueTotal > 0 ? (step.revenue / flowRevenueTotal) : 0;
  const highRevenueShare = flowShareForGuard >= 0.10;
  if (action === 'pause' && !hasRedZone && (isHighValueStep || highRevenueShare)) {
      action = 'keep';
      notes.push('High revenue guardrail');
  }

  return {
    score,
    action,
    volumeInsufficient: !volumeSufficient && needsMoreTime,
    isLowVolumeStep,
    dateRangeAdequate,
    needsMoreTime,
    notes,
    pillars: {
      money: {
        points: moneyPoints,
        ri: moneyScore.riValue,
        annualizedRevenue: moneyScore.annualizedRevenue,
        monthlyRevenue: moneyScore.monthlyRevenue,
        absoluteRevenue: step.revenue
      },
      deliverability: {
        points: deliverabilityPoints,
        effectiveZone,
        wasDowngraded,
        hasRedZone,
        hasYellowZone
      },
      confidence: {
        points: scPoints,
        optimalLookbackDays,
        hasStatisticalSignificance: volumeSufficient
      }
    }
  };
}

/**
 * Evaluates if a step is a valid candidate for "Add a Follow-Up Step"
 * and returns the projection if so.
 */
export function computeAddStepOpportunity(
  flowName: string,
  currentStep: FlowStepMetricsReduced,
  nextStep: FlowStepMetricsReduced | null, // Pass null if this is the last step
  scoreResult: FlowScoreResult,
  medRPE: number,
  allStepRPEs: number[],
  weeksInRange: number
): AddStepOpportunity | null {

  // 1. Basic Gates (Must be "Good" or better)
  // If the current step is "pause" or "insufficient", don't build on top of it.
  if (scoreResult.action === 'pause' || scoreResult.action === 'insufficient') {
    return null;
  }

  // 2. Deliverability Gate (Strict)
  if (scoreResult.pillars.deliverability.hasRedZone || scoreResult.pillars.deliverability.hasYellowZone) {
    return null;
  }

  // 3. Efficiency Gate
  // Should ideally be >= Median RPE
  // Exception: High absolute revenue steps get a pass
  const isHighValue = scoreResult.pillars.money.annualizedRevenue >= 50000;
  const rpeHealthy = currentStep.revenuePerEmail >= (medRPE * 0.8); // slight tolerance

  if (!isHighValue && !rpeHealthy) {
    return null;
  }
  
  // 4. Volume Gate
  // Only suggest adding steps to meaningful volume flows
  if (currentStep.emailsSent < MIN_SAMPLE_SIZE) {
    return null;
  }

  // 5. Suggestion Logic
  // If we have a next step, check if there's a huge dropoff? 
  // For now, mirroring `FlowStepAnalysis`, we mostly suggest on the LAST step.
  // BUT the logic allows suggesting on intermediate steps if there's a gap?
  // Current logic focuses on "extending the flow" (i.e. if this is the last step).
  
  if (nextStep) {
    // If there is already a next step, we typically don't suggest adding another one *immediately* after this one
    // unless we are doing "Gap Analysis" which is different.
    // So if nextStep exists, return null for "Add Step" opportunity.
    return null;
  }

  // 6. Project Revenue for the NEW step (N+1)
  const projection = projectNewStepRevenue(
    flowName,
    currentStep.emailsSent,
    currentStep.revenuePerEmail,
    allStepRPEs,
    medRPE,
    weeksInRange
  );

  // 7. Final Sanity Check on Projected Value
  // Don't suggest if it's pennies
  if (projection.projectedRevenuePerWeek.mid < 10) {
    return null;
  }

  return {
    flowName,
    stepSequence: currentStep.sequencePosition,
    projectedRevenue: projection,
    scoreResult,
    isOpportunity: true
  };
}
