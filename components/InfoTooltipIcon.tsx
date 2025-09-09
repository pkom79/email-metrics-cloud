"use client";
import React from 'react';
import { Info } from 'lucide-react';
import TooltipPortal from './TooltipPortal';

interface Props {
    content: React.ReactNode;
    placement?: import('@popperjs/core').Placement;
    className?: string;
    widthClass?: string; // override width if needed; defaults to standardized width
}

// Standardized info icon (16x16) that inherits currentColor. Base gray-400; hover gray-600; dark hover gray-300.
export default function InfoTooltipIcon({ content, placement = 'top', className, widthClass }: Props) {
    const icon = (
        <span
            className={`inline-flex items-center justify-center cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 ${className || ''}`}
            aria-label="More info"
            role="button"
            tabIndex={0}
        >
            <Info className="w-4 h-4" strokeWidth={2} />
        </span>
    );
    const wrapped = (
        <div className={`${widthClass || 'w-96 max-w-[95vw]'} space-y-2`}>
            {content}
        </div>
    );
    return (
        <TooltipPortal placement={placement} content={wrapped}>
            {icon}
        </TooltipPortal>
    );
}
