# DateRangePicker Component

A fully-featured, accessible date range picker for React with month/year dropdowns, keyboard navigation, and smart disabled date logic.

## Features

✅ **No Preselection**: Calendar opens clean, no dates selected until user clicks  
✅ **Smart Navigation**: Month/year dropdowns + keyboard (PgUp/PgDn) without committing values  
✅ **Intelligent Disabled Logic**: Min/max dates, custom disabled dates, and range constraints  
✅ **Start ≤ End Validation**: Prevents invalid ranges with helpful error messages  
✅ **Max Range Guard**: Optional constraint to limit range span (e.g., 365 days)  
✅ **Two-Month View**: See current and next month simultaneously  
✅ **Presets**: "Last 30 Days", "Last 60 Days", etc.  
✅ **Accessibility**: ARIA labels, keyboard navigation, screen reader support  
✅ **Dark Mode**: Full Tailwind dark mode support  

---

## Installation

The component is already in your project at:
- `components/ui/DateRangePicker.tsx`
- `lib/hooks/useDateAvailability.ts`

No additional dependencies required (uses existing lucide-react icons).

---

## Basic Usage

```tsx
import DateRangePicker, { DateRange, DateAvailability } from '@/components/ui/DateRangePicker';
import { useState } from 'react';

function MyComponent() {
  const [range, setRange] = useState<DateRange>({ start: null, end: null });

  const availability: DateAvailability = {
    minDate: new Date(2024, 0, 1), // Jan 1, 2024
    maxDate: new Date(), // Today
  };

  return (
    <DateRangePicker
      value={range}
      onChange={setRange}
      availability={availability}
      placeholder="Select date range"
    />
  );
}
```

---

## Props

### `value: DateRange`
Current selected range. Structure:
```tsx
{
  start: Date | null;
  end: Date | null;
}
```

### `onChange: (range: DateRange) => void`
Callback when range is committed (both start and end selected).

### `availability: DateAvailability`
Defines available date range and disabled dates:
```tsx
{
  minDate: Date;           // Earliest selectable date
  maxDate: Date;           // Latest selectable date
  disabledDates?: Set<string>; // Optional: Set of 'YYYY-MM-DD' strings
}
```

### `presets?: Array<{ label: string; getValue: () => DateRange }>`
Quick-select presets (e.g., "Last 30 Days"):
```tsx
const presets = [
  {
    label: 'Last 30 Days',
    getValue: () => ({
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
    }),
  },
];
```

### `maxRangeDays?: number`
Optional maximum range span in days. Example: `365` prevents ranges > 1 year.

### `placeholder?: string`
Text shown when no range selected. Default: `"Select date range"`.

### `className?: string`
Additional CSS classes for the container.

### `disabled?: boolean`
Disable the entire picker.

---

## Advanced Usage with useDateAvailability Hook

```tsx
import { useDateAvailability } from '@/lib/hooks/useDateAvailability';
import type { ProcessedCampaign, ProcessedFlowEmail } from '@/lib/data/dataTypes';

function DashboardDatePicker({ campaigns, flows }: Props) {
  const [range, setRange] = useState<DateRange>({ start: null, end: null });

  // Auto-compute availability from data (2-year window)
  const availability = useDateAvailability(campaigns, flows, {
    maxYearsBack: 2,
    disabledDates: [new Date(2024, 11, 25)], // Christmas
  });

  const presets = [
    { label: 'Last 30 Days', getValue: () => computeLast30Days() },
    { label: 'Last 90 Days', getValue: () => computeLast90Days() },
  ];

  return (
    <DateRangePicker
      value={range}
      onChange={setRange}
      availability={availability}
      presets={presets}
      maxRangeDays={365}
    />
  );
}
```

---

## Keyboard Navigation

| Key                | Action                          |
|--------------------|---------------------------------|
| `PageUp`           | Previous month                  |
| `PageDown`         | Next month                      |
| `Shift+PageUp`     | Previous year                   |
| `Shift+PageDown`   | Next year                       |
| `Escape`           | Close picker                    |
| `Tab`              | Navigate between elements       |
| `Enter/Space`      | Select day (when focused)       |

---

## Selection Flow

1. **Open Picker**: Click trigger button → calendar opens with **no dates preselected**
2. **Navigate**: Use month/year dropdowns or keyboard to change visible month (doesn't commit)
3. **First Click**: Select start date → highlighted in purple
4. **Second Click**: Select end date → range committed, picker closes
5. **Alternative**: Click "Today" to set pending start, then select end

### Edge Cases
- **Click before start**: Resets start to new date (doesn't commit)
- **Click same date twice**: Creates single-day range
- **Click disabled date**: Shows validation message

---

## Disabled Date Logic

Dates are disabled if:
1. Before `availability.minDate`
2. After `availability.maxDate`
3. In `availability.disabledDates` Set
4. **(When picking end)** Before currently selected start
5. **(With maxRangeDays)** Beyond max range from start

Visual: Disabled dates are greyed, have `aria-disabled="true"`, and `tabIndex="-1"`.

---

## Integration Example: DashboardHeavy

See `components/dashboard/DashboardDateControls.tsx` for a complete integration example.

### Quick Migration Steps

1. **Import Components**:
```tsx
import { DashboardDateControls } from './DashboardDateControls';
```

2. **Replace Existing Date Picker** (lines ~1850-1920 in DashboardHeavy):
```tsx
<DashboardDateControls
  campaigns={ALL_CAMPAIGNS}
  flows={ALL_FLOWS}
  onDateRangeChange={(start, end) => {
    startTransition(() => {
      setCustomFrom(start);
      setCustomTo(end);
      if (start && end) setDateRange('custom');
    });
  }}
  initialStart={customFrom}
  initialEnd={customTo}
/>
```

3. **Remove Old State**:
```tsx
// DELETE:
const [showDatePopover, setShowDatePopover] = useState(false);
const [popoverYear, setPopoverYear] = useState(...);
const [popoverMonth, setPopoverMonth] = useState(...);
const [tempFrom, setTempFrom] = useState<Date | null>(null);
const [tempTo, setTempTo] = useState<Date | null>(null);
const [dateError, setDateError] = useState<string | null>(null);
```

4. **Remove Old Handlers**:
```tsx
// DELETE:
const onDayClick = (...) => { ... };
const applyTempRange = () => { ... };
// Month/year clamping logic
```

---

## Styling

The component uses Tailwind CSS classes. Key classes:

- **Container**: `relative` for popover positioning
- **Trigger**: Standard button with border/bg/hover states
- **Popover**: `absolute left-0 top-full mt-2 z-50` with shadow
- **Selected Day**: `bg-purple-600 text-white border-purple-600`
- **In-Range Day**: `bg-purple-100 text-purple-900`
- **Disabled Day**: `text-gray-300 cursor-not-allowed`

### Dark Mode
All colors have dark mode variants using `dark:` prefix.

---

## Accessibility

### ARIA Attributes
- Each day button has `aria-label="Month DD"` (e.g., "December 10")
- Disabled days have `aria-disabled="true"` and `tabIndex="-1"`
- Validation messages use `role="alert"` and `aria-live="polite"`

### Keyboard Support
- Full keyboard navigation with PageUp/PageDown
- Tab order: Month dropdown → Year dropdown → Day buttons → Action buttons
- Enter/Space on day buttons commits selection

### Screen Readers
- Announces current month/year when changed
- Announces validation errors immediately
- Announces selected dates

---

## Testing

See `components/ui/__tests__/DateRangePicker.test.tsx` for comprehensive test suite.

### Test Coverage
1. ✅ No preselection when opening
2. ✅ Month/Year change doesn't commit
3. ✅ Disabled date rules (min/max/disabledDates)
4. ✅ Start ≤ End validation
5. ✅ Max range guard
6. ✅ Keyboard navigation (PgUp/PgDn)
7. ✅ Selection behavior (first click = start, second = end)
8. ✅ Presets and action buttons
9. ✅ Accessibility (ARIA, tabIndex)

### Running Tests
```bash
# Install test dependencies (if not already)
npm install --save-dev vitest @testing-library/react @testing-library/user-event

# Run tests
npm run test
```

---

## API Reference

### DateRangePicker Component

```tsx
interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  availability: DateAvailability;
  presets?: Array<{ label: string; getValue: () => DateRange }>;
  maxRangeDays?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}
```

### Types

```tsx
interface DateRange {
  start: Date | null;
  end: Date | null;
}

interface DateAvailability {
  minDate: Date;
  maxDate: Date;
  disabledDates?: Set<string>; // ISO strings YYYY-MM-DD
}
```

### useDateAvailability Hook

```tsx
function useDateAvailability(
  campaigns: ProcessedCampaign[],
  flows: ProcessedFlowEmail[],
  options?: {
    maxYearsBack?: number;
    disabledDates?: Date[];
  }
): DateAvailability;
```

---

## Performance

- **Memoized Computations**: Year list, presets, display value all memoized
- **Efficient Disabled Checks**: O(1) Set lookups for disabled dates
- **Minimal Re-renders**: State updates only on actual changes
- **Event Delegation**: Single event listener for keyboard nav

---

## Troubleshooting

### "Dates not clickable"
- Check `availability.minDate` and `maxDate` are valid
- Verify date is not in `disabledDates` Set

### "Picker closes immediately"
- Ensure click outside handler refs are correct
- Check no parent onClick propagation

### "Keyboard nav not working"
- Picker must be open (`isOpen === true`)
- Check no conflicting keyboard event handlers

### "Dark mode styles broken"
- Ensure Tailwind dark mode is enabled in `tailwind.config.ts`
- Verify `dark:` classes are not purged

---

## Future Enhancements

Potential improvements (not currently implemented):

- [ ] Time selection (hours/minutes)
- [ ] Multi-month scroll view (3+ months)
- [ ] Touch gestures for mobile (swipe)
- [ ] Custom date format display
- [ ] Range presets with dynamic labels
- [ ] Highlight weekends/holidays
- [ ] Compare mode (two ranges)

---

## License

Part of the email-metrics-cloud project. See project LICENSE.

---

## Support

For questions or issues:
1. Check this documentation
2. Review test examples
3. See integration example in `DashboardDateControls.tsx`
