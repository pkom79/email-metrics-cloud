# Timezone Fix Implementation

## Problem
Campaign send times from CSV exports were displaying incorrectly in the app. For example:
- CSV: `2025-09-16 06:00:00`
- App display: `2:00 AM` (showing 4 hours earlier)

This happened because dates were being converted to the user's local timezone instead of displaying the exact time from the CSV.

## Root Cause
The issue was in the **display layer**, not the parsing layer. The date parsing was correctly storing timestamps using `Date.UTC()`, but the display code was using `toLocaleTimeString()` and `toLocaleDateString()` without the `timeZone: 'UTC'` option, causing JavaScript to automatically convert the times to the user's local timezone.

## Solution
The fix preserves timezone-agnostic behavior by:
1. **Parsing**: Using `Date.UTC()` to store CSV timestamps as UTC coordinates (preserving the wall-clock time)
2. **Display**: Adding `timeZone: 'UTC'` to all date formatting calls to ensure everyone sees the same time

This approach treats timestamps as "naive" wall-clock times that display identically regardless of the user's location.

## Files Modified

### Date Parsing (Storage)
- `lib/data/transformers/campaignTransformer.ts` - All date parsing patterns use `Date.UTC()`
- `lib/data/transformers/flowTransformer.ts` - All date parsing patterns use `Date.UTC()`
- `lib/snapshotBuilder.ts` - Date parsing and range filtering use `Date.UTC()`

### Date Display (UI)
- `components/dashboard/DashboardHeavy.tsx` - Campaign sent dates and range labels
- `components/dashboard/CustomSegmentBlock.tsx` - Subscriber created dates
- `components/dashboard/AudienceGrowth.tsx` - Chart date labels
- `components/dashboard/DetailedMetricChart.tsx` - Chart date labels

## Result
Now when CSV contains `2025-09-16 06:00:00`:
- ✅ User in New York sees: `6:00 AM`
- ✅ User in Los Angeles sees: `6:00 AM`
- ✅ User in Tokyo sees: `6:00 AM`
- ✅ User in London sees: `6:00 AM`

All users see the exact same time from the CSV, with no timezone conversion.

## Technical Details

### Why UTC?
JavaScript `Date` objects always store an absolute moment in time (milliseconds since epoch). There's no way to store a "timezone-naive" date. Using `Date.UTC()` provides a consistent reference point that everyone can interpret the same way:
- `Date.UTC(2025, 8, 18, 6, 0, 0)` - Store the numbers 6:00 as UTC coordinates
- `toLocaleTimeString(..., { timeZone: 'UTC' })` - Read those same numbers back
- Result: Everyone sees 6:00 regardless of their location

### Alternative Considered
Using the local date constructor `new Date(2025, 8, 18, 6, 0, 0)` would create different absolute timestamps depending on where the code runs, causing inconsistent behavior across users and deployment environments.

## Testing
To verify the fix works:
1. Upload a CSV with known send times (e.g., `2025-09-16 06:00:00`)
2. View the dashboard from different timezone locations
3. Confirm all users see `6:00 AM` in the campaign details

## Date: October 3, 2025
