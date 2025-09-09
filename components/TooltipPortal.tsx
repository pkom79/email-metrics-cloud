"use client";
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createPopper, Instance, Placement } from '@popperjs/core';

interface TooltipPortalProps {
    content: React.ReactNode;
    children: React.ReactNode;
    placement?: Placement;
    showDelayMs?: number; // delay before showing tooltip on hover/focus
}

export default function TooltipPortal({ content, children, placement = 'top', showDelayMs = 100 }: TooltipPortalProps) {
    const triggerRef = useRef<HTMLElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const popperInstance = useRef<Instance | null>(null);
    const [visible, setVisible] = useState(false);
    const showTimer = useRef<number | null>(null);

    useEffect(() => {
        if (!visible) return;
        if (!triggerRef.current || !tooltipRef.current) return;
        popperInstance.current = createPopper(triggerRef.current, tooltipRef.current, {
            placement,
            modifiers: [
                { name: 'offset', options: { offset: [0, 8] } },
                { name: 'flip', options: { fallbackPlacements: ['top', 'bottom', 'right', 'left'] } },
                { name: 'preventOverflow', options: { padding: 8 } }
            ]
        });
        return () => {
            try { popperInstance.current?.destroy(); } catch { }
            popperInstance.current = null;
        };
    }, [visible, placement]);

    useEffect(() => {
        return () => { if (showTimer.current) { window.clearTimeout(showTimer.current); showTimer.current = null; } };
    }, []);

    // Attach portal root lazily
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // Clone child to attach ref and event handlers
    const child = React.Children.only(children) as React.ReactElement<any>;
    const show = () => {
        if (showTimer.current) window.clearTimeout(showTimer.current);
        showTimer.current = window.setTimeout(() => setVisible(true), showDelayMs) as unknown as number;
    };
    const hide = () => {
        if (showTimer.current) { window.clearTimeout(showTimer.current); showTimer.current = null; }
        setVisible(false);
    };
    const trigger = React.cloneElement(child, {
        ref: (el: HTMLElement) => { triggerRef.current = el; const { ref } = child as any; if (typeof ref === 'function') ref(el); else if (ref) (ref as any).current = el; },
        onMouseEnter: (e: any) => { show(); if (child.props.onMouseEnter) child.props.onMouseEnter(e); },
        onMouseLeave: (e: any) => { hide(); if (child.props.onMouseLeave) child.props.onMouseLeave(e); },
        onFocus: (e: any) => { show(); if (child.props.onFocus) child.props.onFocus(e); },
        onBlur: (e: any) => { hide(); if (child.props.onBlur) child.props.onBlur(e); }
    });

    return (
        <>
            {trigger}
            {mounted && visible && createPortal(
                <div ref={tooltipRef} role="tooltip" className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3 text-[11px] leading-snug text-gray-800 dark:text-gray-100 z-[9999]">
                    {content}
                </div>,
                document.body
            )}
        </>
    );
}
