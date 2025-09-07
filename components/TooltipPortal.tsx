"use client";
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createPopper, Instance, Placement } from '@popperjs/core';

interface TooltipPortalProps {
    content: React.ReactNode;
    children: React.ReactNode;
    placement?: Placement;
}

export default function TooltipPortal({ content, children, placement = 'top' }: TooltipPortalProps) {
    const triggerRef = useRef<HTMLElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const popperInstance = useRef<Instance | null>(null);
    const [visible, setVisible] = useState(false);

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

    // Attach portal root lazily
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // Clone child to attach ref and event handlers
    const child = React.Children.only(children) as React.ReactElement<any>;
    const trigger = React.cloneElement(child, {
        ref: (el: HTMLElement) => { triggerRef.current = el; const { ref } = child as any; if (typeof ref === 'function') ref(el); else if (ref) (ref as any).current = el; },
        onMouseEnter: (e: any) => { setVisible(true); if (child.props.onMouseEnter) child.props.onMouseEnter(e); },
        onMouseLeave: (e: any) => { setVisible(false); if (child.props.onMouseLeave) child.props.onMouseLeave(e); },
        onFocus: (e: any) => { setVisible(true); if (child.props.onFocus) child.props.onFocus(e); },
        onBlur: (e: any) => { setVisible(false); if (child.props.onBlur) child.props.onBlur(e); }
    });

    return (
        <>
            {trigger}
            {mounted && visible && createPortal(
                <div ref={tooltipRef} role="tooltip" className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3 text-xs z-[9999]">
                    {content}
                </div>,
                document.body
            )}
        </>
    );
}
