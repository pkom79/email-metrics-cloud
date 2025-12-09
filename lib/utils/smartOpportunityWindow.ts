import type { ProcessedCampaign, ProcessedFlowEmail } from "../data/dataTypes";
import dayjs from "../dayjs";

/**
 * Configuration for the "Smart Walkback" algorithm.
 */
const SMART_WINDOW_CONFIG = {
  MIN_SENDS: 5000,          // Target sample size for statistical significance
  MIN_DAYS: 90,             // Minimum window to capture quarterly seasonality
  MAX_DAYS: 365,            // Maximum window (annualized view)
  FALLBACK_DAYS: 365,       // Default if something goes wrong
};

export interface DateRange {
  start: Date;
  end: Date;
  days: number;
  sendsCaptured: number;
  isCapped: boolean; // True if we hit MAX_DAYS before MIN_SENDS
}

/**
 * Calculates the "Smart Opportunity Window" for an account.
 * 
 * Algorithm:
 * 1. Sorts all historical email events (Campaigns + Flows) by date descending.
 * 2. Walks back from "Now" (or latest data point) to accumulate volume.
 * 3. Stops when MIN_SENDS threshold is reached OR MAX_DAYS is exceeded.
 * 4. Enforces MIN_DAYS floor.
 * 
 * @param campaigns All processed campaigns
 * @param flows All processed flow emails
 * @returns The optimal DateRange for analysis
 */
export function computeSmartOpportunityWindow(
  campaigns: ProcessedCampaign[],
  flows: ProcessedFlowEmail[]
): DateRange {
  // 1. Determine "Now" / Anchor Date
  // We anchor to the latest data point to support stale data dumps, or Today if data is fresh.
  const allEvents = [
    ...campaigns.map(c => ({ date: c.sentDate, sends: c.emailsSent || 0 })),
    ...flows.map(f => ({ date: f.sentDate, sends: f.emailsSent || 0 }))
  ];

  if (allEvents.length === 0) {
    // No data at all, return default 365d window ending today
    const end = new Date();
    const start = dayjs(end).subtract(SMART_WINDOW_CONFIG.FALLBACK_DAYS, 'day').toDate();
    return { start, end, days: SMART_WINDOW_CONFIG.FALLBACK_DAYS, sendsCaptured: 0, isCapped: false };
  }

  const latestDateMs = Math.max(...allEvents.map(e => e.date.getTime()));
  const anchorDate = new Date(latestDateMs); // The "End" of our analysis window

  // Sort events descending (newest first)
  allEvents.sort((a, b) => b.date.getTime() - a.date.getTime());

  // 2. Walk Back
  let accumulatedSends = 0;
  let startDate = anchorDate;
  let isCapped = false;
  
  // Convert constraints to timestamps
  const minDateMs = dayjs(anchorDate).subtract(SMART_WINDOW_CONFIG.MIN_DAYS, 'day').valueOf();
  const maxDateMs = dayjs(anchorDate).subtract(SMART_WINDOW_CONFIG.MAX_DAYS, 'day').valueOf();

  for (const event of allEvents) {
    accumulatedSends += event.sends;
    startDate = event.date;

    // Check stop conditions
    // If we passed the MAX_DAYS boundary, stop immediately and clamp to MAX_DAYS
    if (event.date.getTime() < maxDateMs) {
      startDate = new Date(maxDateMs);
      isCapped = true;
      break;
    }

    // If we have enough volume AND we have covered the minimum time window, we can stop
    if (accumulatedSends >= SMART_WINDOW_CONFIG.MIN_SENDS && event.date.getTime() <= minDateMs) {
      break;
    }
  }

  // 3. Final Adjustments
  // Ensure we didn't stop *before* the MIN_DAYS mark (e.g. if we got 5k sends in 1 day)
  if (startDate.getTime() > minDateMs) {
    startDate = new Date(minDateMs);
  }

  const days = dayjs(anchorDate).diff(dayjs(startDate), 'day');

  return {
    start: startDate,
    end: anchorDate,
    days,
    sendsCaptured: accumulatedSends,
    isCapped
  };
}
