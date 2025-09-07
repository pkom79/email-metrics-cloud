"use client";

import React, { forwardRef } from "react";
import clsx from "clsx";

type Option = { value: string | number; label: React.ReactNode; disabled?: boolean };

export interface SelectBaseProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
    className?: string;
    /** Optional min width utility, e.g. "min-w-[220px]". Not applied unless provided. */
    minWidthClass?: string;
    /** Extra classes for the chevron icon. */
    iconClassName?: string;
    /** Provide options to render. If children is provided, children takes precedence. */
    options?: Option[];
    /** Override the chevron icon with a custom React component (e.g., from lucide-react). */
    icon?: React.ComponentType<{ className?: string }>;
    /** Children <option> nodes; if provided, used instead of options prop. */
    children?: React.ReactNode;
}

const DefaultChevron: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

const SelectBase = forwardRef<HTMLSelectElement, SelectBaseProps>(function SelectBase(
    { className, minWidthClass, iconClassName, options, children, icon: Icon, disabled, ...rest },
    ref
) {
    // Merge classes: base utility from @layer components, optional min width, then consumer classes last (override-friendly)
    const selectClasses = clsx(
        "select-base",
        minWidthClass,
        className
    );

    const Chevron = Icon || DefaultChevron;

    return (
        <div className="relative">
            <select ref={ref} disabled={disabled} className={selectClasses} {...rest}>
                {children
                    ? children
                    : options?.map((opt, i) => (
                        <option key={i} value={opt.value as any} disabled={opt.disabled}>
                            {opt.label}
                        </option>
                    ))}
            </select>
            <Chevron className={clsx("select-chevron", iconClassName)} />
        </div>
    );
});

export default SelectBase;
