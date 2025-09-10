# Email Metrics Cloud — Branding and UI Guidelines

This guide defines the design tokens, components, and patterns used across the app. Treat it as the single source of truth and keep it updated as we standardize. When adding or modifying UI, reference this document and prefer the shared components listed here.

Last updated: 2025-09-09 (dashboard polish)

## theme and modes
- Tailwind: v3.x, darkMode: class
- Color mode: Light and Dark (toggled via `class="dark"` on the root)

## typography
- Font family: Tailwind default system stack (no custom web font configured)
- Base size: text-base (16px)
- Scale (current usage):
  - Tooltip text: 11px (`text-[11px]`) with `leading-snug`
  - Small body/controls: `text-sm` (14px)
  - Regular body: `text-base` (16px)
  - Section headings: `text-lg` with `font-semibold`
  - Large numeric stats: `text-lg` or `text-3xl` with `tabular-nums` for alignment
- Numeric alignment: Use `tabular-nums` on metrics, ticks, and stats for better column alignment.

## color palette
Use Tailwind’s palette with these role mappings:

- Neutrals
  - Text default: `text-gray-900` (light), `dark:text-gray-100` (dark)
  - Secondary/labels: `text-gray-600`~`500` (light), `dark:text-gray-300`~`400` (dark)
  - Borders: `border-gray-200` (light), `dark:border-gray-700`~`800` (dark)
  - Surfaces: `bg-white` (light), `dark:bg-gray-900` (dark)

- Brand accents
  - Primary accent (purple): `purple-600` (UI icons) and `#8b5cf6` (violet-ish) in charts when “All” scope
  - Campaigns: `#6366F1` (indigo)
  - Flows: `#10B981` (emerald)

- Semantic
  - Positive: `text-emerald-600`
  - Negative: `text-rose-600`
  - Info icon base: `text-gray-400`, hover: `text-gray-600` (light), `dark:hover:text-gray-300` (dark)

Tip: Prefer semantic roles over hardcoding colors. If we need stronger tokenization later, we can extend Tailwind with custom tokens (e.g., `brand.primary`, `role.positive`, `role.negative`).

## elevation and radii
- Cards: `rounded-2xl`, `border`, subtle shadows only when interactive.
- Tooltips: `rounded-lg`, `shadow-xl`, 1px border.

## components and patterns

### Section Containers
- `.section-card`: Rounded card with border and padding.
- `.section-header`: Title at left, controls at right.
- `.section-controls`: Right-aligned inline controls.

Defined in `app/globals.css` under `@layer components`.

### Toggle group (segmented buttons)
- Use compact bordered buttons with selected state in brand purple.
- Pattern mirrors the Compare and Sort controls in dashboard headers.
- Anatomy:
  - Optional label on the left (e.g., "Compare:", "Sort:") using `text-sm font-medium` and neutral color.
  - Two or more buttons in a row with 4px gap.
- States:
  - Selected: `bg-purple-600 text-white border-purple-600`
  - Unselected: `bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200`
  - Dark mode unselected: `dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700`
- Sizing: `px-2.5 py-1` text `text-xs font-medium` with `rounded` and `border`.
- Example:
  - Time/Volume, Asc/Desc, Revenue/Emails Sent

### Selects
- Use `SelectBase` for dropdowns; has consistent padding, border, focus ring:
  - Class: `.select-base`
  - Height: typically `h-9` (~36px)
  - Focus: `focus:ring-2 focus:ring-purple-500`

### Info tooltips (standardized)
- Use `components/InfoTooltipIcon.tsx`:
  - Icon: Lucide `Info`, 16×16 (`w-4 h-4`), `strokeWidth={2}`, inherits `currentColor`
  - Color behavior: base `text-gray-400`, hover `text-gray-600`, dark hover `text-gray-300`
  - Cursor: pointer
  - API: `<InfoTooltipIcon content={...} placement="top" />`
- Tooltip mechanics via `components/TooltipPortal.tsx`:
  - Show delay: 100ms (`showDelayMs` default)
  - Styles: `rounded-lg border bg-white dark:bg-gray-900 shadow-xl p-3 text-[11px] leading-snug`
  - Positioning: Popper with offset 8px; flips and prevents overflow.
- Accessibility: Trigger is focusable (`role="button"`, `tabIndex=0`); tooltip appears on hover and focus.

Do:
- Replace any ad-hoc “ⓘ” spans and group-hover tooltips with `InfoTooltipIcon`.
- Keep tooltip copy concise; use `leading-snug` and 11px size.

Don’t:
- Use `title=` for contentful guidance; reserve `title` for micro-hints only.

Note:
- For tiny stat cards where an info icon is too heavy, prefer `title` attributes for one-line hints.
- Embed long-form help in tooltips; link to docs instead.

### Charts
Flow Step Analysis layout:
- Use a simple grid with gaps (no inner card borders or shadows per step).
- Keep bars minimal and rely on section container for framing.

Notices:
- Data Coverage Notice must include: “Data is capped at 2 years.”
- Lines/areas follow scope color:
  - Campaigns: `#6366F1`
  - Flows: `#10B981`
  - All: `#8b5cf6`
- Grid labels: 11px; `fill-gray-600 dark:fill-gray-400`
- Volume shading uses gradient with low opacity.
- Hover overlays: app-specific, not part of the standardized Info tooltip scope.

### Status coloring (correlations, trends)
- Favorable vs unfavorable coloring depends on metric semantics:
  - Positive metrics (e.g., revenue): upward/positive correlation is `text-emerald-600`, negative is `text-rose-600`.
  - Negative metrics (e.g., unsub/spam/bounce): invert colors.

## spacing and sizing
- Controls: `h-9` (~36px), small buttons `h-7` (~28px)
- Gaps: Use `gap-2` (8px), `gap-3` (12px), `gap-4` (16px) for compact layouts
- Tooltip offset: 8px from trigger

## dark mode
- All surfaces and text should explicitly set dark variants
  - Surfaces: `dark:bg-gray-900`
  - Text: `dark:text-gray-100` (primary), `dark:text-gray-400` (secondary)
  - Borders: `dark:border-gray-700` or `800`

## iconography
- Library: `lucide-react`
- Defaults: `strokeWidth={2}`, line caps/joins round (library default)
- Sizes: 16px for inline informative icons; larger as needed for headers (e.g., 20px–24px)

## code references
- Tooltips: `components/TooltipPortal.tsx` and `components/InfoTooltipIcon.tsx`
- Common section styles: `app/globals.css`
- Tailwind config: `tailwind.config.ts` (dark mode: class)

## contribution workflow
- When adding UI:
  1) Check this doc for existing tokens/components.
  2) Prefer shared components (e.g., `InfoTooltipIcon`, `SelectBase`).
  3) Apply dark mode variants.
  4) If a new pattern is needed, propose it here first, then add a shared component.
- When updating styles globally:
  - Edit shared components or utilities, then update this doc in the same PR.

## roadmap (future tokens)
- Promote brand/semantic colors to Tailwind `theme.extend.colors` (e.g., `brand.primary`, `role.positive`, `role.negative`).
- Introduce a typography scale utility for headings and numeric displays.
- Add a small Storybook or MDX preview page to visualize tokens.

---
If you find a UI that deviates from this guide, log it and standardize by replacing ad-hoc markup with the shared components/utilities above.
