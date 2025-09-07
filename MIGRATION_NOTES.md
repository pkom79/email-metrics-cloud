# Dropdown Unification – Migration Inventory

This document inventories dropdown/select usages and tracks migration to `components/ui/SelectBase`.

Legend:
- Type: Native = HTML select; Lucide chevron indicates a sibling icon.
- Action: Auto = replace with `SelectBase`; Wrapper = use a compatibility wrapper; Skip = keep existing (complex search/multi/select).

| File | Component | Props used (not exhaustive) | Action | Notes |
| ---- | --------- | --------------------------- | ------ | ----- |
| components/dashboard/DashboardHeavy.tsx | Native select + ChevronDown | value, onChange, className, options children, min-w classes | Auto | Remove adjacent ChevronDown; map className; preserve min width via minWidthClass or className |
| components/dashboard/FlowStepAnalysis.tsx | Native select | value, onChange, className | Auto | Focus ring currently emerald; can override via className if needed |
| components/dashboard/FlowStepDropOff.tsx | Native select | value, onChange, className | Auto | |
| components/dashboard/DetailedMetricChart.tsx | Native select | id, value, onChange, className | Auto | |
| components/dashboard/HourOfDayPerformance.tsx | Native select + ChevronDown | value, onChange, className | Auto | Remove adjacent ChevronDown |
| components/dashboard/DayOfWeekPerformance.tsx | Native select + ChevronDown | value, onChange, className | Auto | Remove adjacent ChevronDown |
| components/dashboard/DeliverabilityRiskPanel.tsx | Native select | value, onChange, className | Auto | |
| components/dashboard/SubscriberGrowth.tsx | Native select | value, onChange, className | Auto | |
| components/dashboard/AudienceGrowth.tsx | Native select | value, onChange, className | Auto | |
| components/dashboard/CampaignSendFrequency.tsx | Native select | value, onChange, className | Auto | |
| components/dashboard/SendVolumeImpact.tsx | Native select | value, onChange, className | Auto | |
| components/AccountClient.tsx | Native select + chevron ▼ | value, onChange, className | Auto | Remove text chevron span |
| app/(public)/signup/page.tsx | Native select + ChevronDown | value, onChange, className | Auto | Remove adjacent ChevronDown |

No Radix, Headless UI, or react-select usages detected in the project at time of inventory.

Skipped/Complex: None currently.

Validation: Keep native attributes and validation (required, pattern, min, max, name, id, aria-*, data-*) untouched.
