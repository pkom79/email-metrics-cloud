# 🎨 DateRangePicker Visual Guide

## Component Anatomy

```
┌─────────────────────────────────────────────────────────────┐
│  📅 Jan 15, 2024 – Feb 28, 2024                            │  ← Trigger Button
└─────────────────────────────────────────────────────────────┘
                         ↓ (click)
┌─────────────────────────────────────────────────────────────┐
│  Month [December ▼]  Year [2024 ▼]      PgUp/PgDn to nav   │  ← Header
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │   December 2024   │  │   January 2025   │               │  ← Month Labels
│  ├──────────────────┤  ├──────────────────┤               │
│  │ S M T W T F S    │  │ S M T W T F S    │               │  ← Day Headers
│  │                  │  │ 1 2 3 4 5        │               │
│  │ 1 2 3 4 5 6 7    │  │ 6 7 8 9 10 11 12 │               │
│  │ 8 9 [10] 11 12   │  │ 13 14 15 16 17   │               │  ← Days
│  │   13 14 15       │  │ 18 19 20 21 22   │               │  [10] = Selected
│  │                  │  │ 23 24 25 26 27   │               │
│  └──────────────────┘  └──────────────────┘               │
├─────────────────────────────────────────────────────────────┤
│  Last 30 Days | Last 60 Days | Last 90 Days                │  ← Presets
├─────────────────────────────────────────────────────────────┤
│  [Clear]  [Today]                            [Apply]        │  ← Actions
├─────────────────────────────────────────────────────────────┤
│  Available: Jan 1, 2024 – Dec 31, 2024 • Max: 365 days    │  ← Info
└─────────────────────────────────────────────────────────────┘
```

---

## State Visualization

### Initial State (Open)
```
Calendar opens → NO dates selected
- pendingStart: null
- pendingEnd: null
- committed: { start: null, end: null }
```

### After First Click (Dec 10)
```
Click day 10 → START selected (purple)
- pendingStart: Dec 10 ✅
- pendingEnd: null
- committed: { start: null, end: null } (not yet!)
```

### After Second Click (Dec 15)
```
Click day 15 → END selected, COMMIT, CLOSE
- pendingStart: Dec 10
- pendingEnd: Dec 15
- committed: { start: Dec 10, end: Dec 15 } ✅
- onChange fires ✅
- Calendar closes ✅
```

---

## Visual States

### Day Button States

```css
┌────────────────────────────────────────────────┐
│  Normal Day        │  10  │  gray text         │
│  Hover Day         │  10  │  gray bg           │
│  Selected Day      │  10  │  purple bg         │
│  In-Range Day      │  10  │  light purple bg   │
│  Disabled Day      │  10  │  gray text, fade   │
│  Today (not sel)   │  10  │  border highlight  │
└────────────────────────────────────────────────┘
```

### Color System

| State | Light Mode | Dark Mode |
|-------|-----------|-----------|
| Normal text | `text-gray-900` | `text-gray-100` |
| Normal bg | `bg-white` | `bg-gray-900` |
| Selected bg | `bg-purple-600` | `bg-purple-600` |
| Selected text | `text-white` | `text-white` |
| In-range bg | `bg-purple-100` | `bg-purple-900/30` |
| In-range text | `text-purple-900` | `text-purple-100` |
| Disabled text | `text-gray-300` | `text-gray-600` |
| Border | `border-gray-200` | `border-gray-700` |

---

## Interaction Flows

### Flow 1: Basic Selection
```
1. User clicks trigger
   → Calendar opens (no preselection)

2. User clicks Dec 10
   → Dec 10 highlighted purple
   → Calendar stays open

3. User clicks Dec 15
   → Dec 15 highlighted purple
   → Days 11-14 highlighted light purple (in-range)
   → onChange({ start: Dec 10, end: Dec 15 })
   → Calendar closes
```

### Flow 2: Reset Selection
```
1. User clicks trigger (range already selected)
   → Calendar opens
   → Previous range visible (faded)
   → No pending selection

2. User clicks Dec 5
   → Dec 5 highlighted purple
   → Previous range cleared
   → Calendar stays open

3. User clicks Dec 20
   → Range Dec 5-20 committed
   → Calendar closes
```

### Flow 3: Invalid End Date
```
1. User clicks Dec 10 (start)
   → Dec 10 highlighted

2. User clicks Dec 8 (before start)
   → Validation message appears
   → "End date can't be before start"
   → Dec 8 NOT selected
   → Start remains Dec 10
   → User must select Dec 10 or later
```

### Flow 4: Month Navigation
```
1. User opens calendar (showing December)
   → No dates selected

2. User clicks "Month" dropdown
   → Selects "October"
   → Calendar shows October
   → NO dates committed

3. User clicks day 15 in October
   → Oct 15 selected as start
   → Calendar still open

4. User clicks "Month" dropdown
   → Selects "November"
   → Calendar shows November
   → Oct 15 still visible as pending start

5. User clicks day 5 in November
   → Range Oct 15 - Nov 5 committed
   → Calendar closes
```

---

## Keyboard Navigation Map

```
┌─────────────────────────────────────────────┐
│  Closed State:                              │
│    Tab → Focus trigger button               │
│    Enter/Space → Open calendar              │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  Open State:                                │
│    Tab → Navigate: Month → Year → Days     │
│    PgUp → Previous month                    │
│    PgDn → Next month                        │
│    Shift+PgUp → Previous year               │
│    Shift+PgDn → Next year                   │
│    Escape → Close without saving            │
│    Enter/Space → Select focused day         │
└─────────────────────────────────────────────┘
```

---

## Disabled Date Visualization

### Scenario: Available Dec 10-20, selecting Dec 12-25

```
December 2024
S  M  T  W  T  F  S
               1  2   ← Disabled (before minDate)
3  4  5  6  7  8  9   ← Disabled (before minDate)
10 11 [12] 13 14 15 16  ← 12 = selected start, rest selectable
17 18 19 20 21 22 23    ← 21-23 disabled (after maxDate)
24 25 26 27 28 29 30    ← All disabled (after maxDate)
31                      ← Disabled

Visual indicators:
[12] = Purple background (selected start)
10-20 = Normal text (selectable)
1-9 = Faded gray (disabled, before min)
21-31 = Faded gray (disabled, after max)
```

---

## Responsive Behavior

### Desktop (≥768px)
```
┌────────────────────────────────────┐
│  [▼ Month] [▼ Year]  Keyboard hint │
│  ┌──────────┐ ┌──────────┐        │
│  │ Month A  │ │ Month B  │        │
│  │   Grid   │ │   Grid   │        │
│  └──────────┘ └──────────┘        │
│  [Presets...]                      │
│  [Clear] [Today]        [Apply]    │
└────────────────────────────────────┘
Width: 700px
```

### Mobile (<768px)
```
┌──────────────────┐
│ [▼ Month] [Year] │
│ ┌──────────────┐ │
│ │   Month A    │ │
│ │     Grid     │ │
│ └──────────────┘ │
│ [Presets stacked]│
│ [Clear] [Today]  │
│       [Apply]    │
└──────────────────┘
Width: 100%
Single month view
```

---

## Animation Timing

```
Popover Open:    0ms (instant)
Popover Close:   0ms (instant)
Month Change:    0ms (instant)
Year Change:     0ms (instant)
Hover State:     150ms transition
Focus Visible:   Instant
```

No animations = best performance + accessibility

---

## Error States

### 1. End Before Start
```
┌─────────────────────────────────────┐
│  ⚠️ End date can't be before start  │
│     Selected: Dec 15                │
│     Tried: Dec 10                   │
└─────────────────────────────────────┘
Color: text-rose-600 (red)
Position: Below calendar grid
```

### 2. Disabled Date Click
```
┌─────────────────────────────────────┐
│  ⚠️ This date is not available      │
│     Date: Dec 25 (disabled)         │
└─────────────────────────────────────┘
Color: text-rose-600 (red)
Position: Below calendar grid
```

### 3. Max Range Exceeded
```
┌─────────────────────────────────────┐
│  ⚠️ Range exceeds maximum 30 days   │
│     Selected: Dec 1                 │
│     Tried: Jan 15 (45 days)         │
└─────────────────────────────────────┘
Color: text-rose-600 (red)
Position: Below calendar grid
```

---

## Accessibility Annotations

```
<button                                    ← Trigger
  aria-label="Select date range"
  aria-haspopup="dialog">
  
<div role="dialog"                        ← Popover
     aria-modal="false">
  
  <select aria-label="Month">             ← Month dropdown
  <select aria-label="Year">              ← Year dropdown
  
  <button                                  ← Day button
    aria-label="December 10, 2024"
    aria-disabled="false"
    tabindex="0">
    
  <div role="alert"                       ← Validation
       aria-live="polite">
       
  <button aria-label="Clear selection">  ← Clear button
  <button aria-label="Select today">     ← Today button
</div>
```

---

## Testing Visual Matrix

| Test | Visual Cue | Expected |
|------|-----------|----------|
| Open | Calendar appears | ✅ No dates selected |
| First click | Purple highlight | ✅ One day purple |
| Second click | Purple + in-range | ✅ Range highlighted |
| Invalid end | Red message | ✅ Error shown |
| Month change | Grid updates | ✅ Selection persists |
| Keyboard PgDn | Month +1 | ✅ No selection lost |
| Disabled day | Grey, no cursor | ✅ Not clickable |
| Hover enabled | Grey bg | ✅ Interactive |
| Hover disabled | No change | ✅ Not interactive |
| Focus | Blue outline | ✅ Visible focus |
| Dark mode | Inverted colors | ✅ All readable |

---

## Component Size

```
Closed:    ~200px × 40px  (trigger button)
Open:      ~700px × 450px (full popover)
Mobile:    100% × 500px   (full width)
```

---

## Z-Index Layers

```
Layer 50:  Popover (z-50)
Layer 40:  Validation message (within popover)
Layer 30:  Month dropdowns (within popover)
Layer 20:  Day grid (within popover)
Layer 10:  Backdrop (if used)
Layer 0:   Page content
```

---

## Quick Visual Reference

### ✅ Do's
- Show month/year dropdowns prominently
- Highlight selected dates in purple
- Show in-range dates in light purple
- Grey out disabled dates
- Show validation messages in red
- Maintain two-month view
- Keep presets visible
- Show keyboard hint

### ❌ Don'ts
- Don't preselect dates on open
- Don't auto-commit on month change
- Don't hide keyboard shortcuts
- Don't use red for normal states
- Don't animate transitions
- Don't overlay backdrop
- Don't show only one month
- Don't hide Clear/Today buttons

---

## Browser Rendering

### Chrome/Edge
```
✅ Full support
✅ Smooth dropdowns
✅ Fast day grid
```

### Firefox
```
✅ Full support
✅ Proper focus rings
✅ Accessibility complete
```

### Safari
```
✅ Full support
⚠️ Custom dropdown styling limited
✅ Grid rendering perfect
```

---

## Print Styles

Not applicable - component is interactive only.

---

This visual guide complements the written documentation with diagrams and examples showing exactly how the component looks and behaves at each step.
