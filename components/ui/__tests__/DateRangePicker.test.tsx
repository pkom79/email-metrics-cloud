/**
 * Unit Tests for DateRangePicker
 * 
 * NOTE: This file requires test dependencies to run. Install with:
 * npm install --save-dev vitest @testing-library/react @testing-library/user-event @vitejs/plugin-react jsdom
 * 
 * Run tests with: npm run test (after adding test script to package.json)
 * 
 * Test Coverage:
 * 1. No preselection when opening
 * 2. Month/Year change doesn't commit date value
 * 3. Disabled date rules (minDate, maxDate, disabledDates)
 * 4. Start <= End validation
 * 5. Max range guard
 * 6. Keyboard navigation (PgUp/PgDn)
 * 7. Selection behavior (first click = start, second click = end)
 */

// @ts-nocheck
// Uncomment imports below after installing test dependencies:
// import { describe, it, expect, beforeEach, vi } from 'vitest';
// import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// import userEvent from '@testing-library/user-event';
// import DateRangePicker, { DateRange, DateAvailability } from '../DateRangePicker';

// Test suite commented out until dependencies are installed
export { };

/*
describe('DateRangePicker', () => {
  let defaultAvailability: DateAvailability;
  let mockOnChange: (range: DateRange) => void;

  beforeEach(() => {
    const today = new Date(2024, 11, 15); // Dec 15, 2024
    const sixMonthsAgo = new Date(2024, 5, 15); // Jun 15, 2024

    defaultAvailability = {
      minDate: sixMonthsAgo,
      maxDate: today,
    };

    mockOnChange = vi.fn();
  });

  describe('1. No Preselection', () => {
    it('should not preselect any date when calendar opens', () => {
      const { container } = render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      // Open the picker
      const button = screen.getByRole('button');
      fireEvent.click(button);

      // Check that no date cells have the selected class
      const selectedCells = container.querySelectorAll('.bg-purple-600');
      expect(selectedCells.length).toBe(0);
    });

    it('should maintain pending state independent of committed value', () => {
      const { rerender, container } = render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      // Open and click a date
      const button = screen.getByRole('button');
      fireEvent.click(button);

      // Click day 10
      const day10 = screen.getByLabelText(/December 10/);
      fireEvent.click(day10);

      // Pending start should be set, but onChange not called yet
      expect(mockOnChange).not.toHaveBeenCalled();

      // Selected cells should show only pending selection
      const selectedCells = container.querySelectorAll('.bg-purple-600');
      expect(selectedCells.length).toBe(1);
    });
  });

  describe('2. Month/Year Navigation', () => {
    it('should change visible month without committing date', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      // Open picker
      fireEvent.click(screen.getByRole('button'));

      // Change month dropdown
      const monthSelect = screen.getByLabelText(/Month/);
      fireEvent.change(monthSelect, { target: { value: '10' } }); // November

      // onChange should NOT be called
      expect(mockOnChange).not.toHaveBeenCalled();

      // Calendar should show November
      expect(screen.getByText(/November/)).toBeInTheDocument();
    });

    it('should change year without committing date', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const yearSelect = screen.getByLabelText(/Year/);
      fireEvent.change(yearSelect, { target: { value: '2023' } });

      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe('3. Disabled Date Rules', () => {
    it('should disable dates before minDate', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Navigate to June 2024 (boundary month)
      const monthSelect = screen.getByLabelText(/Month/);
      fireEvent.change(monthSelect, { target: { value: '5' } }); // June

      // Day 14 should be disabled (before minDate of June 15)
      const day14 = screen.getByLabelText(/June 14/);
      expect(day14).toBeDisabled();
      expect(day14).toHaveAttribute('aria-disabled', 'true');
    });

    it('should disable dates after maxDate', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Navigate to December (current month in test)
      // Day 16 should be disabled (after maxDate of Dec 15)
      const day16 = screen.getByLabelText(/December 16/);
      expect(day16).toBeDisabled();
    });

    it('should disable specific dates in disabledDates set', () => {
      const disabledDates = new Set(['2024-12-10', '2024-12-11']);
      
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={{ ...defaultAvailability, disabledDates }}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const day10 = screen.getByLabelText(/December 10/);
      const day11 = screen.getByLabelText(/December 11/);
      const day12 = screen.getByLabelText(/December 12/);

      expect(day10).toBeDisabled();
      expect(day11).toBeDisabled();
      expect(day12).not.toBeDisabled();
    });
  });

  describe('4. Start <= End Validation', () => {
    it('should show error when trying to select end before start', async () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Select Dec 10 as start
      const day10 = screen.getByLabelText(/December 10/);
      fireEvent.click(day10);

      // Try to select Dec 8 as end (before start)
      const day8 = screen.getByLabelText(/December 8/);
      fireEvent.click(day8);

      // Should show validation message
      await waitFor(() => {
        expect(screen.getByText(/End date can't be before start date/)).toBeInTheDocument();
      });

      // onChange should not be called
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should allow start and end to be the same date', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const day10 = screen.getByLabelText(/December 10/);
      fireEvent.click(day10); // Set as start
      fireEvent.click(day10); // Set as end (same date)

      // Should commit the range
      expect(mockOnChange).toHaveBeenCalledWith({
        start: expect.any(Date),
        end: expect.any(Date),
      });
    });
  });

  describe('5. Max Range Guard', () => {
    it('should disable dates beyond maxRangeDays when start is selected', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
          maxRangeDays={7} // Max 7 days
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Select Dec 1 as start
      const day1 = screen.getByLabelText(/December 1/);
      fireEvent.click(day1);

      // Dec 8 should be enabled (7 days later)
      const day8 = screen.getByLabelText(/December 8/);
      expect(day8).not.toBeDisabled();

      // Dec 9 should be disabled (8 days later, exceeds max)
      const day9 = screen.getByLabelText(/December 9/);
      expect(day9).toBeDisabled();
    });

    it('should show info about max range in footer', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
          maxRangeDays={365}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText(/Max range: 365 days/)).toBeInTheDocument();
    });
  });

  describe('6. Keyboard Navigation', () => {
    it('should navigate to previous month with PageUp', async () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Initially showing December 2024
      expect(screen.getByText(/December 2024/)).toBeInTheDocument();

      // Press PageUp
      fireEvent.keyDown(window, { key: 'PageUp' });

      await waitFor(() => {
        expect(screen.getByText(/November 2024/)).toBeInTheDocument();
      });
    });

    it('should navigate to next month with PageDown', async () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Navigate to November first
      const monthSelect = screen.getByLabelText(/Month/);
      fireEvent.change(monthSelect, { target: { value: '10' } });

      // Press PageDown
      fireEvent.keyDown(window, { key: 'PageDown' });

      await waitFor(() => {
        expect(screen.getByText(/December 2024/)).toBeInTheDocument();
      });
    });

    it('should navigate to previous year with Shift+PageUp', async () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Press Shift+PageUp
      fireEvent.keyDown(window, { key: 'PageUp', shiftKey: true });

      await waitFor(() => {
        expect(screen.getByText(/December 2023/)).toBeInTheDocument();
      });
    });

    it('should navigate to next year with Shift+PageDown', async () => {
      // Update availability to allow 2025
      const futureAvailability = {
        ...defaultAvailability,
        maxDate: new Date(2025, 11, 15),
      };

      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={futureAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Press Shift+PageDown
      fireEvent.keyDown(window, { key: 'PageDown', shiftKey: true });

      await waitFor(() => {
        expect(screen.getByText(/December 2025/)).toBeInTheDocument();
      });
    });

    it('should close picker with Escape key', () => {
      const { container } = render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Popover should be visible
      expect(container.querySelector('.absolute.left-0.top-full')).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      // Popover should be hidden
      expect(container.querySelector('.absolute.left-0.top-full')).not.toBeInTheDocument();
    });
  });

  describe('7. Selection Behavior', () => {
    it('should set start on first click', () => {
      const { container } = render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const day10 = screen.getByLabelText(/December 10/);
      fireEvent.click(day10);

      // Should have one selected cell (pending start)
      const selectedCells = container.querySelectorAll('.bg-purple-600');
      expect(selectedCells.length).toBe(1);

      // onChange not called yet
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should set end and commit on second click', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // First click: set start
      const day10 = screen.getByLabelText(/December 10/);
      fireEvent.click(day10);

      // Second click: set end
      const day12 = screen.getByLabelText(/December 12/);
      fireEvent.click(day12);

      // Should commit the range and close
      expect(mockOnChange).toHaveBeenCalledTimes(1);
      expect(mockOnChange).toHaveBeenCalledWith({
        start: new Date(2024, 11, 10),
        end: new Date(2024, 11, 12),
      });
    });

    it('should reset to new start if clicking before current start', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Set start to Dec 10
      const day10 = screen.getByLabelText(/December 10/);
      fireEvent.click(day10);

      // Click Dec 8 (before start) - should reset start
      const day8 = screen.getByLabelText(/December 8/);
      fireEvent.click(day8);

      // Should not commit
      expect(mockOnChange).not.toHaveBeenCalled();

      // Now click Dec 12 to set end
      const day12 = screen.getByLabelText(/December 12/);
      fireEvent.click(day12);

      // Should commit with new start
      expect(mockOnChange).toHaveBeenCalledWith({
        start: new Date(2024, 11, 8),
        end: new Date(2024, 11, 12),
      });
    });

    it('should reset on third click', () => {
      const { container } = render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Select range
      fireEvent.click(screen.getByLabelText(/December 10/));
      fireEvent.click(screen.getByLabelText(/December 12/));

      // Reopen picker
      fireEvent.click(screen.getByRole('button'));

      // Third click should start new selection
      fireEvent.click(screen.getByLabelText(/December 5/));

      const selectedCells = container.querySelectorAll('.bg-purple-600');
      expect(selectedCells.length).toBe(1);
    });
  });

  describe('8. Presets and Actions', () => {
    it('should apply preset values', () => {
      const presets = [
        {
          label: 'Last 7 Days',
          getValue: () => ({
            start: new Date(2024, 11, 8),
            end: new Date(2024, 11, 15),
          }),
        },
      ];

      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
          presets={presets}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const presetButton = screen.getByText('Last 7 Days');
      fireEvent.click(presetButton);

      expect(mockOnChange).toHaveBeenCalledWith({
        start: new Date(2024, 11, 8),
        end: new Date(2024, 11, 15),
      });
    });

    it('should clear selection with Clear button', () => {
      render(
        <DateRangePicker
          value={{ start: new Date(2024, 11, 10), end: new Date(2024, 11, 12) }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const clearButton = screen.getByText('Clear');
      fireEvent.click(clearButton);

      expect(mockOnChange).toHaveBeenCalledWith({ start: null, end: null });
    });

    it('should set today with Today button', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const todayButton = screen.getByText('Today');
      fireEvent.click(todayButton);

      // Should set pending start to today (not commit yet)
      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe('9. Accessibility', () => {
    it('should have proper aria-labels on date buttons', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const day10 = screen.getByLabelText(/December 10/);
      expect(day10).toHaveAttribute('aria-label');
    });

    it('should have aria-disabled on disabled dates', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      const day16 = screen.getByLabelText(/December 16/);
      expect(day16).toHaveAttribute('aria-disabled', 'true');
      expect(day16).toHaveAttribute('tabIndex', '-1');
    });

    it('should announce validation messages with aria-live', () => {
      render(
        <DateRangePicker
          value={{ start: null, end: null }}
          onChange={mockOnChange}
          availability={defaultAvailability}
        />
      );

      fireEvent.click(screen.getByRole('button'));

      // Select start
      fireEvent.click(screen.getByLabelText(/December 10/));

      // Try invalid end
      fireEvent.click(screen.getByLabelText(/December 8/));

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'polite');
    });
  });
});
*/
