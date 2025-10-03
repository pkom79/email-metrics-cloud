import { useMemo } from 'react';
import type { DateAvailability } from '../../components/ui/DateRangePicker';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../data/dataTypes';

/**
 * Hook to compute date availability from campaign/flow data
 * Returns minDate, maxDate, and optionally a set of disabled dates
 */
export function useDateAvailability(
  campaigns: ProcessedCampaign[],
  flows: ProcessedFlowEmail[],
  options?: {
    maxYearsBack?: number;
    disabledDates?: Date[];
  }
): DateAvailability {
  return useMemo(() => {
    const allEmails = [...campaigns, ...flows].filter(
      (e) => e.sentDate instanceof Date && !isNaN(e.sentDate.getTime())
    );

    if (!allEmails.length) {
      // Fallback to reasonable defaults
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const twoYearsAgo = new Date(today);
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      twoYearsAgo.setHours(0, 0, 0, 0);
      
      return {
        minDate: twoYearsAgo,
        maxDate: today,
      };
    }

    // Find actual min/max from data
    const timestamps = allEmails.map((e) => e.sentDate.getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    let minDate = new Date(minTime);
    let maxDate = new Date(maxTime);

    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(23, 59, 59, 999);

    // Apply max years back constraint
    if (options?.maxYearsBack) {
      const cap = new Date(maxDate);
      cap.setFullYear(cap.getFullYear() - options.maxYearsBack);
      if (cap > minDate) {
        minDate = cap;
      }
    }

    // Build disabled dates set if provided
    let disabledDates: Set<string> | undefined;
    if (options?.disabledDates && options.disabledDates.length > 0) {
      disabledDates = new Set(
        options.disabledDates.map((d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        })
      );
    }

    return {
      minDate,
      maxDate,
      disabledDates,
    };
  }, [campaigns, flows, options?.maxYearsBack, options?.disabledDates]);
}
