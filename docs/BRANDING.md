# Email Metrics Cloud – Branding and UI Guidelines

This guide defines the design tokens, components, and patterns used across the app. Treat it as the single source of truth and keep it updated as we standardize. When adding or modifying UI, reference this document and prefer the shared components listed here.

Last updated: 2025-10-03 (Send Volume Impact guidance cards removed in favour of scoped footer note; Flow Step Analysis toggle shows summary line; Consent module divider removed)

> 2025-09-26: Campaign Subject Line insight headlines switched to narrative sentences (no prefixed labels like "Revenue Win:" / "Revenue Warning:"). Headlines now state the observed outcome using "Rev per Email" phrasing (never the RPE acronym) and avoid colons/semicolons/em dashes per readability guidance.
> 2025-09-26 (later): Headline simplified to period revenue delta sentence ("Campaigns generated $12k more revenue this period than the previous one."). Summary now standardizes deliverability status phrases (Critical / Elevated) with thresholds: Open <30% critical, <40% low; Spam ≥0.3% critical (≥0.1% elevated); Unsubs ≥2% critical (≥1% elevated); Bounces ≥5% critical (≥2% elevated).
> 2025-10-02: Send Volume Impact shows All/Campaign/Flow guidance cards, scoped action note now sits beneath the metric grid, and Flow Step Analysis action note headline stays visible with a collapsible body. Send Frequency and Audience Size modules mirror the new placement.
> 2025-10-03: Send Volume Impact now relies on a single scoped action note (no header cards). Flow Step Analysis exposes the first summary line with a “View Insights” toggle, and the Consent action note no longer has a divider line.

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

### Copy tone and punctuation
- Keep sentences short and direct; split long thoughts into multiple sentences instead of chaining clauses.
- **Never** use semicolons (`;`) or em dashes (`–`) in customer-facing copy. Prefer periods or commas, or rewrite the sentence. When a placeholder is needed (e.g., no value), use an en dash (`–`) or the word “N/A”.

## color palette
Use Tailwind’s palette with these role mappings:

- Neutrals
  - Text default: `text-gray-900` (light), `dark:text-gray-100` (dark)
  - Secondary/labels: `text-gray-600`~`500` (light), `dark:text-gray-300`~`400` (dark)
  - Borders: `border-gray-200` (light), `dark:border-gray-700`~`800` (dark)
  - Surfaces: `bg-white` (light), `dark:bg-gray-900` (dark)

- Brand accents
  - Primary accent (purple): `purple-600` (UI icons). Use purple for all section header icons for consistency. In charts, use `#8b5cf6` when the scope is “All”.
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
- Dashboard opportunity summary card (admin only): sits directly under the header row when gains are available. Use `rounded-xl` border with a subtle purple gradient (`from-purple-50 via-white to-white` light, `from-purple-950/40 via-gray-900 to-gray-900` dark). Padding `p-4 sm:p-5`. Totals row uses `text-xs font-semibold uppercase` label and `text-sm` values separated by 24px gaps. Breakdown list aligns right on desktop with `text-sm`, showing `{formatCurrency(value)} / {lift|savings}` in `font-medium`.
### Empty states (standardized)
- Use a dashed border card when a module is gated by view/range or has no sufficient data for the section:
  - Container: `rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900`
  - Icon: lucide icon in muted gray (e.g., `text-gray-300`) sized 40px–48px above the copy
  - Title: `text-base font-semibold text-gray-900 dark:text-gray-100`
  - Body: `text-sm text-gray-600 dark:text-gray-400` centered, concise guidance
- Examples:
  - Weekly-only module for 90+ day ranges: Title “Weekly view and 90+ days required”, body “This module is available only in the Weekly view for ranges 90 days or longer.” Icon: `CalendarRange`.
  - Zero full weeks in range: Title “Not enough data in this period”, body “We didn’t find any complete weeks inside this range. Try a longer date range.” Icon: `MailX`.
  - Dashboard: No Account Access (Manager) – Title “No account access yet”, body “You don’t have access to any account. Ask an Admin to invite you.” Icon: `Calendar` in gray-300. No CTAs.
  - Dashboard: Admin (no account selected) – Title “Select an account”, body “Choose an account from the selector above to view its dashboard.” Icon: `Calendar` in gray-300. No CTAs.

### Settings and management pages (current)
- Use the same section-card pattern with compact controls.
- Forms:
  - Inputs `h-9`/`h-10`, rounded, bordered; dark variants.
  - Primary actions: purple filled buttons, compact (`h-9`/`h-10`).
  - Secondary actions: bordered neutral buttons.
- Notifications Settings UI:
  - Header with `Bell` icon, account selector, topic dropdown, recipient input, add button.
  - List recipients in a simple divided list with enable/disable control and delete icon button.
- Multi-user invitations and agency management were retired in Sept 2025. Leave historical guidance here for context, but do not reintroduce those surfaces without a new review.

### Loading states
- Full-screen loading (e.g., dashboard hydration) keeps the background on brand neutrals (`bg-gray-50` / `dark:bg-gray-900`) with a centered spinner ring using `border-purple-600` accent.
- Pair the spinner with concise copy: primary line `text-sm font-medium` in neutral 700/200, optional supporting line in `text-xs text-gray-500` to reinforce what’s happening.
- Maintain minimum spacing (`gap-4`) and wrap content in a flex column to stay consistent with onboarding states.


## Actionable notice cards (segments)

- Use dashed bordered cards for informational notices that may include a single secondary action.
- Icon: CalendarRange for date-range notices; size 40px; gray-300 tint on light, same on dark.
- Title: sentence-case, concise, bold.
- Body: one short sentence with the exact bounds or values referenced.
- Button: purple filled, small/compact; label “Use this date range”; centered; only render when the action is valid.
- Do not stack multiple actions; prefer one clear CTA or none.
- Dark mode: bg-gray-900 with gray-800 border; maintain contrast for text and button.

### Send Volume Impact action note (All vs campaigns vs flows)
- A single action note appears below the metric cards (`mt-8`) and reflects the active scope selected in the dropdown (`All Emails`, `Campaigns`, `Flows`).
- Card: `rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4`.
- Layout: stacked copy on the left with the scope-specific headline (`text-sm font-semibold`), followed by the narrative paragraph (`text-sm text-gray-700 dark:text-gray-300`). The status chip (emerald “Send More”, rose “Send Less”, amber “Keep as Is”, gray “Not Enough Data”) sits on the right and stays aligned to the top.
- Sample line: optional `text-xs text-gray-500 dark:text-gray-400` (“Based on N weeks/months of {scope} volume.”).
- No header cards precede the chart; the action note is the primary guidance surface for this module.

### Action Notes (shared pattern)
- Shell: `rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4`.
- Lead sentence: `text-sm font-semibold text-gray-900 dark:text-gray-100`. Follow with descriptive copy in `text-sm text-gray-700 dark:text-gray-300 leading-relaxed`.
- Sample line: optional `text-xs text-gray-500 dark:text-gray-400` reminder formatted as “Based on X weeks of … data.” Count all weeks used in the comparison (e.g., baseline + challenger) so the note reflects the total observation window.
- Toggles (when present) use purple text buttons (`text-purple-600 hover:text-purple-700`) with a `ChevronDown` icon that rotates on open. Labels read “View Insights” / “Hide Insights”.
- Placement: unless otherwise noted, action notes sit below the primary visualization with `mt-6` spacing. Send Volume Impact uses `mt-8` to clear the stat grid.
- Flow Step Analysis headers follow the same rules and must always show a plain-English summary line (no punctuation shortcuts) paired with the toggle on the right.

#### Narrative Headlines (Subject Line Insights)
- Use a single descriptive sentence instead of a prefixed tag (e.g., avoid "Revenue Win:").
- Must describe what happened in the observed period (e.g., volume share below baseline, lift achieved) and end with a period.
- Use the phrase “Rev per Email” (capital R) instead of the acronym RPE.
- Do not use colon `:`, semicolon `;`, or em dash `–` characters; keep punctuation simple (period only).
- Example patterns (actual selection logic handled in analytics layer):
  - "42% of sends were 18% below baseline Rev per Email ($0.34)."
  - "Scarcity & Low Stock subject lines lifted Rev per Email 26% on 145,000 sends (38% of revenue)."
  - "Campaigns averaged $0.41 Rev per Email this period."
- When referencing a percentage lift/dip, show it as an absolute percent (e.g., "26%" not "+26%" unless clarity improves in edge comparisons).

- No status badges for frequency guidance; the recommendation itself must include the cadence (“Send 3 campaigns per week”) so the user gets a clear action without extra chrome.
- Guardrails: when computing recommendations, require ≥4 full weeks and ≥1k emails per cadence before comparing buckets. Treat revenue lift ≥10% as meaningful, only approve higher cadence when open/click drops stay within -5% and spam/bounce stay within +0.05/+0.10 percentage points. The inverse guardrails apply when lowering cadence.
- Sparse data handling: if only one cadence meets the sample bar, surface an exploratory message (“Test 2 campaigns per week”) when engagement is healthy; otherwise show “Not enough data for a recommendation.”
- Deliverability alerts: always mention when spam ≥0.3% or bounce ≥0.5% triggers a “Send Less” recommendation so users know the risk driver.
- Audience size guidance mirrors this card shell. Minimum inputs: ≥12 campaigns total, ≥3 per bucket, and ≥50k emails combined before recommending direction. When a larger bucket shows promising lift with limited coverage, frame it as a “Test” recommendation and call out the small sample in body copy. Reference the active date range in all “not enough data” messages (e.g., “This date range includes only …”).

- Placement: appended inside the Purchase Frequency card beneath the bar list. Keeps the same action-note shell with `mt-6` spacing from the bars.
- Insight headline: top of the card shows the dominant cohort summary (e.g., “Never Purchased leads the distribution (87.6%)”) in `text-sm font-semibold text-gray-900 dark:text-gray-100`, followed by a supporting sentence in `text-sm text-gray-700 dark:text-gray-300`.
- Interaction: collapse the cohort breakdown behind a purple text button labeled “View Insights” / “Hide Insights” with a chevron (`rotate-180` when expanded). Insight headline/body always remain visible. Button uses `text-xs font-semibold text-purple-600` with focus ring and `aria-expanded`.
- Segment blocks: three sections (Never Purchased, One Order, Repeat Buyers) each show `count • percent` at the top right, a recommendation line in `text-sm text-gray-700 dark:text-gray-300`, optional caution line in `text-sm text-gray-600 dark:text-gray-400`, and a `Campaign ideas` label in `text-xs uppercase` followed by a `list-disc` of three ideas. Skip segments whose count or contribution is zero to avoid empty content.
- Data guardrail: hide the entire note when `totalSubscribers` is zero so empty accounts do not show placeholder messaging.

#### Audience Lifetime Action Note
- Placement: sits directly under the Audience Lifetime chart inside the existing card, using the same action-note shell and hierarchy as Purchase Frequency (`mt-6`, bordered, rounded-xl, padded).
- Header line: `text-sm font-semibold` sentence that interprets the distribution (e.g., “0-6 months leads the list (47.2%)”). Body sentence underneath explains the marketing implication in plain language (`text-sm text-gray-700 dark:text-gray-300`).
- Interaction: include a “View Insights” / “Hide Insights” toggle with chevron; when expanded, show insight blocks mirroring Purchase Frequency (bold subheading plus two `text-sm` lines with labels “What it means:” and “Send this:” to keep guidance action-oriented).
- Logic: aggregate 0-3 + 3-6 months as “new”, 6-12 as “mid”, and 1-2 + 2+ years as “old”. Treat as balanced when the leading aggregate is within 5 percentage points of the runner-up and label accordingly. Skip rendering entirely when `totalSubscribers` is zero.
- Scenario copy: New-dominant → emphasise onboarding, welcome storytelling, first/second-purchase nudges. Mid-dominant → focus on retention, loyalty proof, cross-sells. Old-dominant → highlight reactivation, preference refresh, sunset hygiene. Balanced → recommend maintaining a mix of onboarding, retention, and reactivation streams.

#### High-Value Customer Segments Action Note
- Placement: sits beneath the High-Value Customer Segments card using the same action-note shell (`mt-6`, bordered, rounded-xl, padded).
- Header line: “High-value customers generate {{total_share}} of total revenue.” (use `formatPercent` on combined high-value revenue share). Subline adapts per distribution:
  - Single tier ahead by ≥2 pp → “Prioritize moving customers up from {{top.name}} while protecting {{smallest.name}} with personal recognition.”
  - Top two tiers within 2 pp → “Balance lift efforts across tiers and protect {{smallest.name}} with personal recognition.”
  - 6x+ represents ≥1/3 of the combined share → “Anchor a VIP track for 6x+ AOV alongside lift programs for the lower tiers.”
- Interaction: reuse the “View Insights” / “Hide Insights” toggle; expanded state lists each tier with bold subheading, a share summary (“Largest…”, “Meaningful…”, etc.) plus “Range: …” and a `Campaign ideas` list of three bullets aligned to that tier.
- Logic: bucket customers exclusively into 2x-3x, 3x-6x, and 6x+ AOV ranges. Determine “largest”, “smallest”, or “comparable” using revenue share inside the high-value group (2 pp tolerance). Append the formatted range text used in the chart.
- Campaign idea templates:
  - 2x-3x AOV → spend-threshold offers, bundles/multi-packs, add-on upsells.
  - 3x-6x AOV → early access, accelerated loyalty rewards, personalised recommendations.
  - 6x+ AOV → concierge outreach, surprise-and-delight gifts, invitation-only previews.

#### Engagement by Profile Age Action Note
- Placement: sits directly below the Engagement by Profile Age heatmap; same card shell as other action notes.
- Header line: interpret the overall engagement health by age (use the rule priority: hygiene, then acquisition quality, then stability). Subline is a one-sentence focus reminder derived from the signals map.
- Interaction: “View Insights” / “Hide Insights” toggle with chevron; expanded state shows a short 4–6 sentence paragraph (no bullets) that covers acquisition quality, list maintenance, where habits form or fade, recommended allocation, and a contrast reminder.
- Data inputs: derive segments using the same age buckets (0–6m, 6–12m, 1–2y, 2+y) and engagement buckets (0–30d, 31–60d, 61–90d, 91–120d, 120+, Never). Do not restate raw percentages already shown on the chart.
- Sentence templates: follow the rule set–headline priority order, subline mapping, paragraph sentences covering quality, maintenance, stability, focus, and contrast.

#### Campaign Day Performance Action Note (new)
- Purpose: Recommend which day(s) of the week to prioritize for campaign sends based on Revenue per Email, engagement (opens, clicks, conversions), and risk (unsub & spam) while respecting the existing Send Frequency recommendation.
- Shell & Typography: Reuses the standard action note card (`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4`). Headline `text-sm font-semibold`, body `text-sm leading-relaxed`, sample line `text-xs` identical to other action notes.
- Headline styles:
  - Single clear winner: “Prioritize Tue sends.”
  - Multi-day cluster: “Focus sends on Tue and Thu.” (Oxford comma omitted; last two joined with “and”).
  - Even performance: “Performance is even across days.”
  - Not enough data: “Not enough data for day-of-week guidance.”
  - Exploratory (only one eligible day): “Use Tue as an anchor day.”
  - Consider (no clear winner for frequency=1): “No clear leader–consider Tue or Wed.”
- Sampling guardrails: Require ≥4 full weeks; a day eligible when it has ≥3 campaigns OR ≥1k emails (or ≥2% of total emails, whichever larger). Volatile single-campaign spikes dampen revenue weight (0.7×) to avoid overfitting.
- Scoring blend (not displayed directly): 55% revenue index, 25% engagement index (opens 50%, clicks 30%, conversion 20%), 20% risk index (penalizes unsub & spam deltas; spam weighted heavier). Result only influences recommendation copy and ordering; we do not surface raw composite values in UI to minimize noise.
- Risk gating: Days exceeding spam 0.5% or unsub +0.15 pp over weighted average are excluded/substituted when alternatives exist; elevated but not blocking risk adds a caution sentence (“Monitoring elevated complaints on Fri…”).
- Sample line format: “Based on X weeks / Y campaigns (Z emails).” Mirrors existing modules.
- No new colors, icons, or layout patterns introduced; the section header uses `CalendarDays` icon with purple accent consistent with scope icons.

#### (Removed) Campaign & Subject Line Action Note
2025-09-27: This experimental note was removed from the Campaign Details card after evaluation showed low incremental value (redundant with existing per-campaign metrics and day/hour performance modules). Narrative headline guidelines above are retained for potential future reuse in other summarization contexts.

### Campaign Details (Campaign Performance section)
2025-10-03: Campaign details display updated to show all metrics permanently without hover/container, improving accessibility and visibility.

Layout:
- Three-column grid on desktop (`md:[grid-template-columns:minmax(0,1fr)_400px_max-content]`): 
  1. Left column: Subject line, campaign name, send date/time, recipient count
  2. Center column (400px): 12-metric grid always visible
  3. Right column: Selected sort metric displayed large
- Mobile: Stacked layout with metrics below campaign info

Column 1 (Campaign Info):
- Subject line: `font-medium text-gray-900 dark:text-gray-100`, truncated
- Campaign name: `text-sm text-gray-500 dark:text-gray-400 mb-1`, truncated
- Send date/time: `text-sm text-gray-500 dark:text-gray-400`, formatted as "Sent on Sep 3, 2025 at 9:30 AM"
- Recipients: `text-sm text-gray-500 dark:text-gray-400`, formatted as "19,570 recipients" using `formatNumber()`

Column 2 (Metrics Grid):
- Always visible (no hover/opacity behavior)
- No container border, shadow, or background
- Centered using `justify-center` flexbox
- Grid: 2 columns with `gap-x-6 gap-y-1` (desktop), `gap-x-4` (mobile)
- Text size: `text-xs`
- Label: `text-gray-500 dark:text-gray-400`
- Value: `tabular-nums font-medium text-gray-900 dark:text-gray-100`
- Metrics (in order): revenue, revenuePerEmail, openRate, clickRate, clickToOpenRate, emailsSent, totalOrders, avgOrderValue, conversionRate, unsubscribeRate, spamRate, bounceRate

Column 3 (Sort Metric):
- Value: `text-xl font-semibold text-gray-900 dark:text-gray-100`
- Label: `text-sm text-gray-500 dark:text-gray-400`

Visual Changes from Previous Version:
- Removed hover-triggered opacity transition (`opacity-0 group-hover:opacity-100`)
- Removed metrics container styling (`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3`)
- Changed from `block` to `flex justify-center` for center column alignment
- Added send time to date display
- Added recipient count as separate line below date

This pattern provides immediate visibility of all campaign metrics without requiring user interaction, improving data scanability and accessibility while maintaining the app's clean aesthetic.


### Export controls

## Inline data links + tooltip (Segments)
- Trigger: small text button, purple-600 text, no underline on hover, placed inline after contextual label (e.g., "Sent on …").
- Tooltip: reuse general tooltip container (rounded-lg, subtle border, white/dark bg, shadow). Max-height ~12rem with overflow auto for long lists. Text size ~11px-12px, tight line-height.
- Accessibility: focusable, dismiss on click outside or blur; ensure hover/focus both show tooltip with a short show delay.
- `.section-controls`: Right-aligned inline controls.

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

### Segment Comparison (A/B) – Custom Segment
- Uploads: Two optional CSV inputs, labeled "Segment A" and "Segment B". A is the baseline.
- Labels: After upload, show an editable text field to rename each segment (defaults to file name).
- Layout when both segments are present (compact compare):
  - Row 1: Segment A value (left-aligned, `tabular-nums`). Prefix with `A:`.
  - Row 2: Segment B value (left-aligned, `tabular-nums`). Prefix with `B:`. Immediately to the right of the B value, show the inline delta text "Δ vs A" as a relative percent.
  - B-value tinting: Apply `text-emerald-600` when favorable vs A, `text-rose-600` when unfavorable; use neutral gray when equal or N/A. Ensure sufficient contrast in dark mode (`dark:text-emerald-400` / `dark:text-rose-400` acceptable).
- Favorability:
  - Higher is better: revenue, members, AOV, revenue/member, created%, engaged%, non‑suppressed%, opt‑in%.
  - Lower is better: average days between orders, unsubscribed%, spam complaint%, user suppressed%.
- Formatting and rounding:
  - Currency: 2 decimals.
  - Rates: 1 decimal as a percent in cards (e.g., 12.3%).
  - Deltas (relative % vs A):
    - 0–99.9%: show one decimal (e.g., 12.3%).
    - ≥100%: no decimals (e.g., 125%).
    - ≥1000%: thousands‑grouped integer (e.g., 1,463%).
  - Counts: integers using `toLocaleString()`.
- Anchoring for N‑day windows: anchor to `referenceDate` when provided; otherwise Today. Use the same anchor for both A and B.
- Baseline zero: show "N/A (no baseline)" when A = 0 and B > 0; show "–" when both are zero.
- Single-file behavior: When only Segment A is present, render the original single-segment cards without delta text.
- Row headers and order (both single and compare views):
  1) Revenue & Value
  2) Customer Base
  3) Order Behavior
  4) Acquisition
  5) Engagement
  6) Deliverability & List Health

### Selects
- Use `SelectBase` for dropdowns; has consistent padding, border, focus ring:
  - Class: `.select-base`
  - Height: typically `h-9` (~36px)
  - Focus: `focus:ring-2 focus:ring-purple-500`

### Admin account picker
- Component: `components/dashboard/AdminAccountPicker.tsx`.
- Trigger button: rounded, `border border-gray-200 dark:border-gray-700`, `bg-white dark:bg-gray-800`, `h-10`, `px-3`. Focus ring `purple-500`. Width `100%` on mobile, `260px` on desktop.
- Flyout: rounded-2xl surface with shadow, `bg-white dark:bg-gray-900`, border `gray-200/700`, list items get `hover:bg-purple-50 dark:hover:bg-gray-800`.
- Contact tags: lavender bubble `inline-flex items-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 px-2 py-0.5 text-[11px] font-semibold`. Keep copy ≤80 chars (truncate on input if longer).

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

### Plan Selection Modal
- Heading: only the “Choose Your Access Method” title belongs up top (no icon, no subtitle, no status badge).
- Free option: bordered emerald card with the three benefit bullets, CTA, and the reassurance line (“We unlock your dashboard the moment your call is booked.”).
- Scheduling state: swap the cards for just the Calendly embed, a single helper line (“We automatically unlock your dashboard when the booking completes.”), and a neutral Go Back button.
- Paid option: keep the “PREFER TO PAY?” label plus the monthly and annual cards. Skip the descriptive paragraph and shared-features list.
- Footer: remove auxiliary controls such as “Refresh status” or “Close”; the back button in the Calendly view is the only navigation affordance there.

### Charts
Flow Step Analysis layout:
- Use a simple grid with gaps (no inner card borders or shadows per step).
- Keep bars minimal and rely on section container for framing.
 - Header per step: big value at right with small arrow+percent change below it (emerald for positive, rose for negative, gray arrow for 0.0%). Metric name is shown only in the section dropdown, not under each value.

Notices:
- Data Coverage Notice must include: “Data is capped at 2 years.”
- Lines/areas follow scope color:
  - Campaigns: `#6366F1`
  - Flows: `#10B981`
  - All: `#8b5cf6`
  - Subscribed vs Not Subscribed: two horizontal bars using `#8b5cf6` (purple) to match the All scope accent.
    - Header icon: `BarChart3` in `purple-600`.
    - Metric dropdown: `SelectBase` (`h-9`) with focus ring `purple-500`.
  - Values: counts as integers (`tabular-nums`), LTV metrics in USD with 2 decimals, Total Revenue in USD with 2 decimals.
    - Tooltip: What/How/Why with definitions for “Subscribed” and “Not Subscribed”.
- Grid labels: 11px; `fill-gray-600 dark:fill-gray-400`
- Volume shading uses gradient with low opacity.
- Hover overlays: app-specific, not part of the standardized Info tooltip scope.

Overview (Email Performance Overview):
- Data source: Always aggregates All Flows (date‑filtered), regardless of the Flow Performance selection elsewhere. Campaigns remain included per date selection.
- Scope color: Use the All scope accent `#8b5cf6` for lines/areas.

Audience Growth header:
- Show the big total number at top-right; below it, show the compact arrow+percent change matching the big cards. No additional "Total …" label; rely on the metric dropdown.

Audience Size Performance (new):
- Section: use the standard section container and header with calendar icon (`CalendarFold`) and `InfoTooltipIcon`.
- Controls: single metric dropdown using `SelectBase` (h-9). Default metric is “Avg Campaign Revenue”.
- Buckets: 4 bars/cards laid left→right with indigo-filled bars and subtle indigo gradient backdrop.
- Tooltips: per-bar hover tooltip mirrors Send Frequency with 11px text, shows campaign count, total emails, averages, and weighted rates.
- Limited-data notice: show a small secondary line when sample < 12 campaigns.
- Action note: standard bordered card positioned below the bucket grid (`mt-6`) summarising the recommended audience size focus.

Subject Line Analysis (new):
- Section: use standard section container and header with `Type` icon and `InfoTooltipIcon`.
- Subsections should not include leading icons in their sub-headers; keep the main header icon only.
- Controls: two dropdowns using `SelectBase` (h-9): left is Segment (default “All Segments”), right is Metric (Open Rate default; also CTO, Click Rate, Revenue per Email).
- Notices: include an info tooltip noting Apple MPP inflation on opens and that comparisons are weighted by emails sent; also mention the 2-year cap.
- Cards: compact bordered cards for length bins and feature lifts; use semantic colors for lift deltas (`text-emerald-600` positive, `text-rose-600` negative). Text sizes 11–14px per this guide.
- Accessibility: tooltips use the standardized `TooltipPortal` with 100ms delay.
 - Baseline: include a left-most Baseline card in each section showing the weighted average metric for the selection. All lifts are shown as relative % change vs Baseline (including RPE).

Dynamic Subject Length bins:
- Binning: Use equal-count dynamic bins by number of campaigns (target tertiles). Handle tie groups at boundaries so a single length doesn’t split across bins.
- Fallbacks: If a bin would be empty after tie handling, reduce to 2 bins (halves). If still not possible (all same length), show a single range bin.
- Labels: Display as ranges only, e.g., “22–38” followed by “chars” in the card label. Keys for export mirror this range string.
- Layout: Always a single row on md+ with the Baseline card first, then 1–3 bins. Center the row as a whole. On small screens, stack vertically with standard gaps.

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

## Flow Step Analysis – Score & Tooltip Nomenclature

Scope: Applies to both UI and export surfaces. Keep naming, formatting, and calculations in strict parity.

- Pillars and weights: Money 70, Deliverability 20, Confidence 10 (total 100).
- Money pillar (70 points total) is composed of two 0–35 point sub-parts:
  - Revenue Index (RI): points = 35 × clamp(RI, 0, 2.0) / 2.0. RI is the step’s Revenue per Email divided by the baseline median RPE across steps. For single‑step flows, the baseline uses flows‑only account RPE for the selected window (exclude campaigns).
  - Email Rev Share (ERS): keep existing bins; max 35 points. Label everywhere as “Email Rev Share (ERS)”.
- Deliverability (20 points): additive bins with a low‑volume adjustment. In tooltips, show each bin as “→ value/max” (no plus sign), using title case labels.
- Confidence (10 points): 1 point per 100 emails sent in the window, capped at 10.
- Score N/A: When store revenue in the selected window is zero, show “Score N/A” in the UI; export should also note the lack of store revenue.
- Notes: When RI ≥ 1.4, include “High Revenue Index” in the notes. Retain the high‑revenue guardrail note when applicable.
- Minimum volume: Don’t recommend scaling/pausing until a step has at least 250 sends in the selected range. Show the purple “Low volume” badge and Action Note reminder instead of a scale/keep verdict below that threshold.
- Flow Action Note: sits below the step charts. Collapsed view shows a flow-specific summary headline plus the first summary line; the right side surfaces a “View Insights” purple text button with the chevron toggle. Expanded state reveals the remaining narrative sentences, optional bullet list, and the sample line. Call out the reason (Revenue Index, ERS share, deliverability issues) and average revenue per the selected granularity (day/week/month). When the last step is strong enough to extend, phrase the suggestion as “Adding one more email…” and include the estimated lift per the active granularity.

Formatting:
- RI display: use “x.x×” format in tooltips (e.g., “1.4×”).
- Use `tabular-nums` on numeric tooltip rows for alignment.

Color and Icons:
- Use brand semantic colors per this guide. Keep section header icon in purple. Tooltip icon via `InfoTooltipIcon`.

## Mobile Filters Drawer (Dashboard)

Purpose: Provide full access to date range, granularity, compare, and flow filters on small screens without crowding the header. Desktop filter bar remains unchanged.

Trigger (mobile only):
- Placement: Right-aligned in the header area under the page title.
- Style: Compact pill button `rounded-full` with subtle border and light surface.
  - Classes: `inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 shadow-sm`
  - (Sept 2025 update) Removed legacy decorative purple dot indicator (was `w-2 h-2 rounded-full bg-purple-600`) to reduce visual noise; rely on layout and section iconography instead.
- Label: "Filters".

Bottom Sheet:
- Container: `fixed bottom-0 left-0 right-0 z-50`, rounded top corners (`rounded-t-2xl`), border top, shadow. Backdrop: `bg-black/40`.
- Surface: `bg-white dark:bg-gray-900`; Border: `border-gray-200 dark:border-gray-800`.
- Handle: A small grabber bar at top center (`h-1 w-10 bg-gray-300 dark:bg-gray-700 rounded-full`). Close button uses `X` icon (lucide) in the top-right.
- Scrolling: Content area max height ~75vh with `overflow-y-auto`.

Contents:
- Date Range
  - Presets dropdown using `SelectBase` with full width and standard padding.
  - Optional custom date inputs: two `type="date"` fields with min/max clamped to the allowed window; changing either sets the range to Custom.
- Granularity
  - Segmented buttons mirroring desktop style; disabled states follow the same rules and tooltips.
- Compare
  - Two buttons: "Prev Period", "Prev Year" with disabled state when the window isn't available; parity with desktop logic and colors.
- Flow (convenience)
  - Dropdown using `SelectBase` listing live flow names plus "All Flows".

Footer:
- Left: "Reset" secondary button (bordered neutral) reverting to defaults: 30d, Daily, Prev Period, All Flows, no custom dates.
- Right: "Apply" primary button filled in brand purple (`bg-purple-600 hover:bg-purple-700`).

Accessibility:
- The sheet uses `role="dialog" aria-modal="true"`; backdrop click or the Close button dismisses it.
- Focus should remain within the sheet while open; initial focus on the presets dropdown is preferred. On close, return focus to the "Filters" trigger.

Dark Mode:
- Mirror light styles with `dark:` variants for surface, text, and borders as noted above.

Notes:
- Do not hide or reduce filters on mobile; the drawer provides complete parity with desktop controls.
- State changes are staged locally and applied on "Apply" to avoid jarring re-renders while users adjust multiple controls.
