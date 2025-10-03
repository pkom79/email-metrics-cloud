'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import SelectBase from './SelectBase';

export interface DateRange {
    start: Date | null;
    end: Date | null;
}

export interface DateAvailability {
    minDate: Date;
    maxDate: Date;
    disabledDates?: Set<string>; // ISO date strings YYYY-MM-DD
}

export interface DateRangePickerProps {
    value: DateRange;
    onChange: (range: DateRange) => void;
    availability: DateAvailability;
    presets?: Array<{ label: string; getValue: () => DateRange }>;
    maxRangeDays?: number; // Optional max range restriction
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}

interface CalendarState {
    month: number;
    year: number;
    pendingStart: Date | null;
    pendingEnd: Date | null;
}

/**
 * DateRangePicker with month/year dropdowns
 * - No preselection when opening
 * - Month/Year changes don't commit dates
 * - Keyboard: PgUp/PgDn for month, Shift+PgUp/PgDn for year
 * - Smart disabled logic based on availability and range constraints
 */
export default function DateRangePicker({
    value,
    onChange,
    availability,
    presets = [],
    maxRangeDays,
    placeholder = 'Select date range',
    className = '',
    disabled = false,
}: DateRangePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [calendarState, setCalendarState] = useState<CalendarState>(() => ({
        month: availability.maxDate.getMonth(),
        year: availability.maxDate.getFullYear(),
        pendingStart: null,
        pendingEnd: null,
    }));
    const [validationMessage, setValidationMessage] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Format date to YYYY-MM-DD
    const formatDate = useCallback((date: Date | null): string => {
        if (!date) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }, []);

    // Parse YYYY-MM-DD to Date
    const parseDate = useCallback((str: string): Date | null => {
        if (!str) return null;
        const [y, m, d] = str.split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
    }, []);

    // Check if a date is disabled
    const isDateDisabled = useCallback(
        (date: Date, mode: 'start' | 'end'): boolean => {
            const dateStr = formatDate(date);

            // Check basic availability
            if (date < availability.minDate || date > availability.maxDate) return true;
            if (availability.disabledDates?.has(dateStr)) return true;

            // Additional logic based on mode
            if (mode === 'end') {
                // When picking end, disable dates before current start
                if (calendarState.pendingStart && date < calendarState.pendingStart) return true;
            }

            // Check max range constraint
            if (maxRangeDays && mode === 'end' && calendarState.pendingStart) {
                const daysDiff = Math.ceil(
                    (date.getTime() - calendarState.pendingStart.getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysDiff > maxRangeDays) return true;
            }

            return false;
        },
        [availability, calendarState.pendingStart, formatDate, maxRangeDays]
    );

    // Handle day click
    const handleDayClick = useCallback(
        (date: Date) => {
            const { pendingStart, pendingEnd } = calendarState;

            // First click or reset: set start
            if (!pendingStart || (pendingStart && pendingEnd)) {
                if (isDateDisabled(date, 'start')) {
                    setValidationMessage('This date is not available');
                    return;
                }
                setCalendarState((prev) => ({
                    ...prev,
                    pendingStart: date,
                    pendingEnd: null,
                }));
                setValidationMessage(null);
                return;
            }

            // Second click: set end
            if (pendingStart && !pendingEnd) {
                if (date < pendingStart) {
                    setValidationMessage("End date can't be before start date");
                    return;
                }
                if (isDateDisabled(date, 'end')) {
                    setValidationMessage('This date is not available');
                    return;
                }

                // Commit the range
                onChange({ start: pendingStart, end: date });
                setCalendarState((prev) => ({
                    ...prev,
                    pendingStart: null,
                    pendingEnd: null,
                }));
                setValidationMessage(null);
                setIsOpen(false);
            }
        },
        [calendarState, isDateDisabled, onChange]
    );

    // Month/Year navigation
    const changeMonth = useCallback((delta: number) => {
        setCalendarState((prev) => {
            let newMonth = prev.month + delta;
            let newYear = prev.year;

            if (newMonth < 0) {
                newMonth = 11;
                newYear -= 1;
            } else if (newMonth > 11) {
                newMonth = 0;
                newYear += 1;
            }

            // Clamp to available range
            const minYear = availability.minDate.getFullYear();
            const maxYear = availability.maxDate.getFullYear();

            if (newYear < minYear) {
                newYear = minYear;
                newMonth = availability.minDate.getMonth();
            } else if (newYear > maxYear) {
                newYear = maxYear;
                newMonth = availability.maxDate.getMonth();
            } else if (newYear === minYear && newMonth < availability.minDate.getMonth()) {
                newMonth = availability.minDate.getMonth();
            } else if (newYear === maxYear && newMonth > availability.maxDate.getMonth()) {
                newMonth = availability.maxDate.getMonth();
            }

            return { ...prev, month: newMonth, year: newYear };
        });
    }, [availability]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                return;
            }

            if (e.key === 'PageUp') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Shift+PgUp: previous year
                    changeMonth(-12);
                } else {
                    // PgUp: previous month
                    changeMonth(-1);
                }
            } else if (e.key === 'PageDown') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Shift+PgDn: next year
                    changeMonth(12);
                } else {
                    // PgDn: next month
                    changeMonth(1);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, changeMonth]);

    // Click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Reset pending state when opening
    useEffect(() => {
        if (isOpen) {
            setCalendarState((prev) => ({
                ...prev,
                pendingStart: null,
                pendingEnd: null,
            }));
            setValidationMessage(null);
        }
    }, [isOpen]);

    // Generate available years
    const availableYears = useMemo(() => {
        const years: number[] = [];
        const minYear = availability.minDate.getFullYear();
        const maxYear = availability.maxDate.getFullYear();
        for (let y = maxYear; y >= minYear; y--) {
            years.push(y);
        }
        return years;
    }, [availability]);

    // Display value
    const displayValue = useMemo(() => {
        if (!value.start && !value.end) return placeholder;
        const startStr = value.start
            ? value.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '?';
        const endStr = value.end
            ? value.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '?';
        return `${startStr} – ${endStr}`;
    }, [value, placeholder]);

    return (
        <div className={`relative ${className}`}>
            {/* Trigger Button */}
            <button
                ref={buttonRef}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className="flex items-center gap-2 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Calendar className="w-4 h-4 text-gray-500" />
                <span>{displayValue}</span>
            </button>

            {/* Popover */}
            {isOpen && (
                <div
                    ref={containerRef}
                    className="absolute left-0 top-full mt-2 z-50 w-[700px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-4"
                >
                    {/* Header with Month/Year Controls */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            {/* Previous Month Button */}
                            <button
                                onClick={() => changeMonth(-1)}
                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-purple-600 dark:text-purple-400"
                                aria-label="Previous month"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>

                            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Month</label>
                            <SelectBase
                                value={calendarState.month}
                                onChange={(e) =>
                                    setCalendarState((prev) => ({
                                        ...prev,
                                        month: parseInt(e.target.value, 10),
                                    }))
                                }
                                className="px-2 py-1 pr-6 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                            >
                                {Array.from({ length: 12 }, (_, i) => {
                                    const date = new Date(2024, i, 1);
                                    const monthName = date.toLocaleDateString('en-US', { month: 'long' });
                                    return (
                                        <option key={i} value={i}>
                                            {monthName}
                                        </option>
                                    );
                                })}
                            </SelectBase>

                            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Year</label>
                            <SelectBase
                                value={calendarState.year}
                                onChange={(e) =>
                                    setCalendarState((prev) => ({
                                        ...prev,
                                        year: parseInt(e.target.value, 10),
                                    }))
                                }
                                className="px-2 py-1 pr-6 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                            >
                                {availableYears.map((y) => (
                                    <option key={y} value={y}>
                                        {y}
                                    </option>
                                ))}
                            </SelectBase>

                            {/* Next Month Button */}
                            <button
                                onClick={() => changeMonth(1)}
                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-purple-600 dark:text-purple-400"
                                aria-label="Next month"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Two-Month Calendar Grid */}
                    <div className="grid grid-cols-2 gap-6">
                        <CalendarMonth
                            year={calendarState.year}
                            month={calendarState.month}
                            pendingStart={calendarState.pendingStart}
                            pendingEnd={calendarState.pendingEnd}
                            committedStart={value.start}
                            committedEnd={value.end}
                            onDayClick={handleDayClick}
                            isDateDisabled={isDateDisabled}
                        />
                        <CalendarMonth
                            year={
                                calendarState.month === 11
                                    ? calendarState.year + 1
                                    : calendarState.year
                            }
                            month={(calendarState.month + 1) % 12}
                            pendingStart={calendarState.pendingStart}
                            pendingEnd={calendarState.pendingEnd}
                            committedStart={value.start}
                            committedEnd={value.end}
                            onDayClick={handleDayClick}
                            isDateDisabled={isDateDisabled}
                        />
                    </div>

                    {/* Validation Message */}
                    {validationMessage && (
                        <div
                            role="alert"
                            aria-live="polite"
                            className="mt-3 text-xs text-rose-600 dark:text-rose-400"
                        >
                            {validationMessage}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                            {presets.map((preset, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        const range = preset.getValue();
                                        onChange(range);
                                        setIsOpen(false);
                                    }}
                                    className="px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    setCalendarState((prev) => ({
                                        ...prev,
                                        pendingStart: null,
                                        pendingEnd: null,
                                    }));
                                    onChange({ start: null, end: null });
                                }}
                                className="px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {/* Info */}
                    <div className="mt-3 text-[10px] text-gray-500">
                        Available: {availability.minDate.toLocaleDateString()} –{' '}
                        {availability.maxDate.toLocaleDateString()}
                        {maxRangeDays && ` • Max range: ${maxRangeDays} days`}
                    </div>
                </div>
            )}
        </div>
    );
}

interface CalendarMonthProps {
    year: number;
    month: number;
    pendingStart: Date | null;
    pendingEnd: Date | null;
    committedStart: Date | null;
    committedEnd: Date | null;
    onDayClick: (date: Date) => void;
    isDateDisabled: (date: Date, mode: 'start' | 'end') => boolean;
}

function CalendarMonth({
    year,
    month,
    pendingStart,
    pendingEnd,
    committedStart,
    committedEnd,
    onDayClick,
    isDateDisabled,
}: CalendarMonthProps) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();

    const monthName = new Date(year, month, 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
    });

    // Build calendar cells
    const cells: React.ReactNode[] = [];

    // Leading empty cells
    for (let i = 0; i < firstDayOfMonth; i++) {
        cells.push(<div key={`empty-${i}`} className="h-9" />);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = date.toDateString();

        const isPendingStart = pendingStart?.toDateString() === dateStr;
        const isPendingEnd = pendingEnd?.toDateString() === dateStr;
        const isCommittedStart = committedStart?.toDateString() === dateStr;
        const isCommittedEnd = committedEnd?.toDateString() === dateStr;

        // Determine if in pending or committed range
        const inPendingRange =
            pendingStart &&
            !pendingEnd &&
            date > pendingStart &&
            !isPendingStart &&
            !isPendingEnd;

        const inCommittedRange =
            committedStart &&
            committedEnd &&
            date > committedStart &&
            date < committedEnd &&
            !isCommittedStart &&
            !isCommittedEnd;

        // Determine disabled state - use 'start' mode as default for visualization
        const disabled = isDateDisabled(date, 'start');

        const selected = isPendingStart || isPendingEnd || isCommittedStart || isCommittedEnd;
        const inRange = inPendingRange || inCommittedRange;

        cells.push(
            <button
                key={day}
                onClick={() => !disabled && onDayClick(date)}
                disabled={disabled}
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                aria-label={`${monthName} ${day}`}
                className={`
          h-9 w-9 text-xs rounded flex items-center justify-center border transition-colors
          ${disabled
                        ? 'text-gray-300 dark:text-gray-600 border-transparent cursor-not-allowed'
                        : selected
                            ? 'bg-purple-600 text-white border-purple-600 font-semibold'
                            : inRange
                                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100 border-purple-200 dark:border-purple-800'
                                : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100'
                    }
        `}
            >
                {day}
            </button>
        );
    }

    return (
        <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 text-center">
                {monthName}
            </div>
            <div className="grid grid-cols-7 gap-1 text-[10px] text-gray-500 mb-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => (
                    <div key={d} className="text-center font-medium">
                        {d}
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-1">{cells}</div>
        </div>
    );
}
