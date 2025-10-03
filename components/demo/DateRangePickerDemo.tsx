'use client';

import React, { useState } from 'react';
import DateRangePicker, { DateRange } from '../ui/DateRangePicker';

/**
 * Demo component showing DateRangePicker usage
 * 
 * This component demonstrates all features:
 * - Basic usage
 * - With presets
 * - With max range
 * - With disabled dates
 * - Dark mode support
 */
export default function DateRangePickerDemo() {
    const [basicRange, setBasicRange] = useState<DateRange>({ start: null, end: null });
    const [presetRange, setPresetRange] = useState<DateRange>({ start: null, end: null });
    const [restrictedRange, setRestrictedRange] = useState<DateRange>({ start: null, end: null });

    // Demo availability: last 6 months
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const availability = {
        minDate: sixMonthsAgo,
        maxDate: today,
    };

    // Demo with disabled weekends
    const disabledDates = new Set<string>();
    const cursor = new Date(sixMonthsAgo);
    while (cursor <= today) {
        const day = cursor.getDay();
        if (day === 0 || day === 6) {
            // Sunday or Saturday
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, '0');
            const d = String(cursor.getDate()).padStart(2, '0');
            disabledDates.add(`${y}-${m}-${d}`);
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    const availabilityWithDisabled = {
        ...availability,
        disabledDates,
    };

    // Presets for demo
    const presets = [
        {
            label: 'Last 7 Days',
            getValue: () => {
                const end = new Date(today);
                const start = new Date(end);
                start.setDate(start.getDate() - 6);
                return { start, end };
            },
        },
        {
            label: 'Last 30 Days',
            getValue: () => {
                const end = new Date(today);
                const start = new Date(end);
                start.setDate(start.getDate() - 29);
                return { start, end };
            },
        },
        {
            label: 'Last 90 Days',
            getValue: () => {
                const end = new Date(today);
                const start = new Date(end);
                start.setDate(start.getDate() - 89);
                return { start, end };
            },
        },
    ];

    const formatRangeDisplay = (range: DateRange): string => {
        if (!range.start && !range.end) return 'No range selected';
        const formatDate = (d: Date | null) =>
            d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
        return `${formatDate(range.start)} → ${formatDate(range.end)}`;
    };

    return (
        <div className="p-8 space-y-12 max-w-4xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-gray-100">
                    DateRangePicker Demo
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                    Explore all features of the new date range picker component
                </p>
            </div>

            {/* Demo 1: Basic Usage */}
            <div className="space-y-4">
                <div>
                    <h2 className="text-xl font-semibold mb-1 text-gray-900 dark:text-gray-100">
                        1. Basic Usage
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Simple date range picker with no additional features
                    </p>
                </div>
                <DateRangePicker
                    value={basicRange}
                    onChange={setBasicRange}
                    availability={availability}
                    className="w-full max-w-md"
                />
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 p-3 rounded">
                    Selected: {formatRangeDisplay(basicRange)}
                </div>
            </div>

            {/* Demo 2: With Presets */}
            <div className="space-y-4">
                <div>
                    <h2 className="text-xl font-semibold mb-1 text-gray-900 dark:text-gray-100">
                        2. With Presets
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Quick selection buttons for common ranges
                    </p>
                </div>
                <DateRangePicker
                    value={presetRange}
                    onChange={setPresetRange}
                    availability={availability}
                    presets={presets}
                    className="w-full max-w-md"
                />
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 p-3 rounded">
                    Selected: {formatRangeDisplay(presetRange)}
                </div>
            </div>

            {/* Demo 3: Max Range Restriction */}
            <div className="space-y-4">
                <div>
                    <h2 className="text-xl font-semibold mb-1 text-gray-900 dark:text-gray-100">
                        3. Max Range Restriction
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Limited to 30-day ranges (try selecting more!)
                    </p>
                </div>
                <DateRangePicker
                    value={restrictedRange}
                    onChange={setRestrictedRange}
                    availability={availability}
                    maxRangeDays={30}
                    presets={presets}
                    className="w-full max-w-md"
                />
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 p-3 rounded">
                    Selected: {formatRangeDisplay(restrictedRange)}
                </div>
            </div>

            {/* Feature List */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                    ✨ Features Demonstrated
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FeatureCard
                        title="Month/Year Dropdowns"
                        description="Navigate quickly without clicking arrows"
                    />
                    <FeatureCard
                        title="Keyboard Navigation"
                        description="PgUp/PgDn for month, Shift+PgUp/PgDn for year"
                    />
                    <FeatureCard
                        title="No Preselection"
                        description="Calendar opens clean, no dates selected"
                    />
                    <FeatureCard
                        title="Smart Disabled Logic"
                        description="Respects min/max dates and custom disabled dates"
                    />
                    <FeatureCard
                        title="Two-Click Selection"
                        description="Click start, then end - auto-commits and closes"
                    />
                    <FeatureCard
                        title="Validation Messages"
                        description="Clear feedback for invalid selections"
                    />
                    <FeatureCard
                        title="Presets Support"
                        description="Quick buttons for common ranges"
                    />
                    <FeatureCard
                        title="Max Range Guard"
                        description="Optional constraint on range span"
                    />
                    <FeatureCard
                        title="Two-Month View"
                        description="See current and next month simultaneously"
                    />
                    <FeatureCard
                        title="Full Accessibility"
                        description="ARIA labels, keyboard nav, screen reader support"
                    />
                    <FeatureCard
                        title="Dark Mode"
                        description="Complete Tailwind dark mode support"
                    />
                    <FeatureCard
                        title="Today Button"
                        description="Quick access to current date"
                    />
                </div>
            </div>

            {/* Keyboard Shortcuts */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                    ⌨️ Keyboard Shortcuts
                </h2>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <ShortcutRow keys="PgUp" action="Previous month" />
                    <ShortcutRow keys="PgDn" action="Next month" />
                    <ShortcutRow keys="Shift + PgUp" action="Previous year" />
                    <ShortcutRow keys="Shift + PgDn" action="Next year" />
                    <ShortcutRow keys="Escape" action="Close picker" />
                    <ShortcutRow keys="Tab" action="Navigate elements" />
                    <ShortcutRow keys="Enter / Space" action="Select focused day" />
                </div>
            </div>

            {/* Usage Example */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                    💻 Usage Example
                </h2>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs">
                    {`import DateRangePicker, { DateRange } from '@/components/ui/DateRangePicker';
import { useState } from 'react';

function MyComponent() {
  const [range, setRange] = useState<DateRange>({ 
    start: null, 
    end: null 
  });

  const availability = {
    minDate: new Date(2024, 0, 1),  // Jan 1, 2024
    maxDate: new Date(),             // Today
  };

  const presets = [
    { 
      label: 'Last 30 Days', 
      getValue: () => ({ 
        start: new Date(Date.now() - 30*24*60*60*1000), 
        end: new Date() 
      }) 
    },
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
}`}
                </pre>
            </div>
        </div>
    );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
    return (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        </div>
    );
}

function ShortcutRow({ keys, action }: { keys: string; action: string }) {
    return (
        <div className="flex items-center justify-between">
            <kbd className="px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-900 dark:text-gray-100">
                {keys}
            </kbd>
            <span className="text-sm text-gray-600 dark:text-gray-400">{action}</span>
        </div>
    );
}
