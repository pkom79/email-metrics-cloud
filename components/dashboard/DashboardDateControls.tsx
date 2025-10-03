/**
 * Example Integration: DateRangePicker with Dashboard
 * 
 * This demonstrates how to integrate the new DateRangePicker component
 * into the existing DashboardHeavy component.
 */

import React, { useState, useMemo } from 'react';
import DateRangePicker, { DateRange } from '../ui/DateRangePicker';
import { useDateAvailability } from '../../lib/hooks/useDateAvailability';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

interface DashboardDateControlsProps {
    campaigns: ProcessedCampaign[];
    flows: ProcessedFlowEmail[];
    onDateRangeChange: (start: string | undefined, end: string | undefined) => void;
    initialStart?: string;
    initialEnd?: string;
}

/**
 * Standalone date controls component that can replace the existing
 * custom date picker in DashboardHeavy
 */
export function DashboardDateControls({
    campaigns,
    flows,
    onDateRangeChange,
    initialStart,
    initialEnd,
}: DashboardDateControlsProps) {
    // Convert YYYY-MM-DD strings to Date objects
    const parseDate = (str: string | undefined): Date | null => {
        if (!str) return null;
        const [y, m, d] = str.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    // Convert Date to YYYY-MM-DD string
    const formatDate = (date: Date | null): string | undefined => {
        if (!date) return undefined;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const [dateRange, setDateRange] = useState<DateRange>({
        start: parseDate(initialStart),
        end: parseDate(initialEnd),
    });

    // Compute availability from campaign/flow data (2 year window)
    const availability = useDateAvailability(campaigns, flows, {
        maxYearsBack: 2,
    });

    // Presets matching existing dashboard options
    const presets = useMemo(() => {
        const today = new Date(availability.maxDate);
        today.setHours(0, 0, 0, 0);

        const createPreset = (days: number) => {
            const end = new Date(today);
            end.setHours(23, 59, 59, 999);
            const start = new Date(end);
            start.setDate(start.getDate() - days + 1);
            start.setHours(0, 0, 0, 0);
            return { start, end };
        };

        return [
            { label: 'Last 30 Days', getValue: () => createPreset(30) },
            { label: 'Last 60 Days', getValue: () => createPreset(60) },
            { label: 'Last 90 Days', getValue: () => createPreset(90) },
            { label: 'Last 180 Days', getValue: () => createPreset(180) },
            { label: 'Last 365 Days', getValue: () => createPreset(365) },
        ];
    }, [availability.maxDate]);

    const handleChange = (range: DateRange) => {
        setDateRange(range);
        onDateRangeChange(formatDate(range.start), formatDate(range.end));
    };

    return (
        <DateRangePicker
            value={dateRange}
            onChange={handleChange}
            availability={availability}
            presets={presets}
            maxRangeDays={365} // Optional: prevent ranges > 1 year
            className="w-full"
        />
    );
}

/**
 * Example: Integrating into DashboardHeavy
 * 
 * Replace the existing date picker code with:
 */
export function DashboardIntegrationExample() {
    const [customFrom, setCustomFrom] = useState<string | undefined>();
    const [customTo, setCustomTo] = useState<string | undefined>();

    // Existing state from DashboardHeavy
    const ALL_CAMPAIGNS: ProcessedCampaign[] = []; // From dataManager
    const ALL_FLOWS: ProcessedFlowEmail[] = []; // From dataManager

    return (
        <div className="flex items-center gap-4">
            {/* Replace existing date picker with: */}
            <DashboardDateControls
                campaigns={ALL_CAMPAIGNS}
                flows={ALL_FLOWS}
                onDateRangeChange={(start, end) => {
                    setCustomFrom(start);
                    setCustomTo(end);
                    // Trigger data refresh
                }}
                initialStart={customFrom}
                initialEnd={customTo}
            />

            {/* Existing granularity controls, etc. */}
        </div>
    );
}

/**
 * Migration Notes for DashboardHeavy.tsx:
 * 
 * 1. Remove existing calendar state:
 *    - showDatePopover
 *    - popoverYear, popoverMonth
 *    - tempFrom, tempTo
 *    - dateError
 * 
 * 2. Remove calendar handlers:
 *    - onDayClick
 *    - applyTempRange
 *    - Month/year clamping logic
 * 
 * 3. Replace the date picker section (lines ~1850-1920) with:
 *    <DashboardDateControls
 *      campaigns={ALL_CAMPAIGNS}
 *      flows={ALL_FLOWS}
 *      onDateRangeChange={(start, end) => {
 *        startTransition(() => {
 *          setCustomFrom(start);
 *          setCustomTo(end);
 *          if (start && end) {
 *            setDateRange('custom');
 *          }
 *        });
 *      }}
 *      initialStart={customFrom}
 *      initialEnd={customTo}
 *    />
 * 
 * 4. Keep existing:
 *    - Preset dropdown (30d, 60d, etc.) - works alongside picker
 *    - Granularity controls
 *    - Compare mode controls
 * 
 * 5. Benefits:
 *    - No more manual date validation
 *    - Automatic disabled date handling
 *    - Keyboard navigation built-in
 *    - Accessibility features included
 *    - Proper start <= end enforcement
 *    - Optional max range constraints
 */
