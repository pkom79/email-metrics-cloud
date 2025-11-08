"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, Check, Loader2, ShieldCheck } from 'lucide-react';

type PlanId = 'monthly' | 'annual';

type Props = {
    open: boolean;
    status: string;
    onClose: () => void;
    onSelect: (planId: PlanId) => void;
    onRefresh?: () => void;
    busyPlan?: PlanId | null;
    error?: string | null;
    onClaimFreeAccess?: () => Promise<void> | void;
    claimingFreeAccess?: boolean;
};

const SHARED_FEATURES = [
    'See what’s working and what’s costing you money',
    'Optimize flows and campaigns for higher returns',
    'Keep your audience engaged and deliverability strong',
    'Manage audience size and reduce costs automatically',
    'Turn insights into extra revenue you’d otherwise miss'
];

const CONCIERGE_POINTS = [
    'Book a 15-minute onboarding call',
    'Get instant access to your insights',
    'Never pay – yours free forever'
];

const MONTHLY_PRICE = 29;
const ANNUAL_PRICE = 99;
const ANNUAL_BADGE_TEXT = 'SAVE 71%';
const DEFAULT_CALENDLY_URL = 'https://calendly.com/peterkom/email_metrics?primary_color=9333ea';
const CONCIERGE_CALENDAR_URL = process.env.NEXT_PUBLIC_ONBOARDING_CALENDAR_URL || process.env.NEXT_PUBLIC_CONCIERGE_CALENDAR_URL || DEFAULT_CALENDLY_URL;
const CALENDLY_SCRIPT_SRC = 'https://assets.calendly.com/assets/external/widget.js';
const CALENDLY_SCRIPT_ID = 'calendly-inline-widget-script';

export default function ModalPlans({
    open,
    status,
    onClose,
    onSelect,
    onRefresh,
    busyPlan,
    error,
    onClaimFreeAccess,
    claimingFreeAccess
}: Props) {
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const hasRequestedFreeUnlock = useRef(false);
    const [showScheduler, setShowScheduler] = useState(false);
    const [calendarLoaded, setCalendarLoaded] = useState(false);
    const [freePathTriggered, setFreePathTriggered] = useState(false);

    useEffect(() => {
        if (!open) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const focusDialog = () => {
            const focusable = overlayRef.current?.querySelector<HTMLElement>('[data-autofocus]');
            focusable?.focus();
        };
        focusDialog();
    }, [open]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
        if (event.key === 'Tab') {
            const focusable = overlayRef.current ? Array.from(overlayRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled')) : [];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }, [open, onClose]);

    useEffect(() => {
        if (!open) return;
        const handler = (event: KeyboardEvent) => handleKeyDown(event);
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, handleKeyDown]);

    const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === overlayRef.current) {
            onClose();
        }
    };

    useEffect(() => {
        if (open) return;
        setShowScheduler(false);
        setCalendarLoaded(false);
        setFreePathTriggered(false);
        hasRequestedFreeUnlock.current = false;
    }, [open]);

    useEffect(() => {
        if (!showScheduler || !CONCIERGE_CALENDAR_URL) return;
        const handleReady = () => setCalendarLoaded(true);
        if ((window as any)?.Calendly) {
            handleReady();
            return;
        }
        setCalendarLoaded(false);
        const existing = document.getElementById(CALENDLY_SCRIPT_ID) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener('load', handleReady);
            return () => existing.removeEventListener('load', handleReady);
        }
        const script = document.createElement('script');
        script.id = CALENDLY_SCRIPT_ID;
        script.src = CALENDLY_SCRIPT_SRC;
        script.async = true;
        script.addEventListener('load', handleReady);
        document.body.appendChild(script);
        return () => {
            script.removeEventListener('load', handleReady);
        };
    }, [showScheduler]);

    const planCards = useMemo(() => ([
        {
            id: 'monthly' as PlanId,
            label: 'Monthly',
            priceDetail: 'Monthly billing • cancel anytime',
            price: `$${MONTHLY_PRICE}`,
            suffix: '/month',
            highlight: false,
            orderClass: 'order-2 sm:order-1',
            autoFocus: false,
            cta: `Get Started – $${MONTHLY_PRICE}/month`
        },
        {
            id: 'annual' as PlanId,
            label: 'Annual',
            priceDetail: 'One payment covers the full year',
            price: `$${ANNUAL_PRICE}`,
            suffix: '/year',
            highlight: true,
            badge: ANNUAL_BADGE_TEXT,
            orderClass: 'order-1 sm:order-2',
            autoFocus: true,
            cta: 'Get Started – $99/year'
        }
    ]), []);

    const triggerFreeUnlock = useCallback(async () => {
        if (hasRequestedFreeUnlock.current) return;
        hasRequestedFreeUnlock.current = true;
        setFreePathTriggered(true);
        try {
            await onClaimFreeAccess?.();
        } catch (err) {
            hasRequestedFreeUnlock.current = false;
            setFreePathTriggered(false);
            throw err;
        }
    }, [onClaimFreeAccess]);

    useEffect(() => {
        if (!showScheduler) return;
        const handleMessage = (event: MessageEvent) => {
            const payload = typeof event.data === 'string'
                ? event.data
                : (event.data && (event.data.event || event.data.name)) || '';
            if (!payload) return;
            const normalized = String(payload).toLowerCase();
            if (normalized.includes('event_scheduled')) {
                triggerFreeUnlock().catch(() => {});
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [showScheduler, triggerFreeUnlock]);

    if (!open) return null;

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 sm:px-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plans-title"
            onMouseDown={handleOverlayClick}
        >
            <div className="relative w-full max-w-4xl rounded-2xl bg-white dark:bg-gray-950 shadow-2xl ring-1 ring-black/5 p-5 sm:p-8" onMouseDown={e => e.stopPropagation()}>
                <div className="flex flex-col items-center gap-3 text-center">
                    <div className="h-12 w-12 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <h2 id="plans-title" className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Choose Your Access Method</h2>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">Same features. Two ways to get started.</p>
                    {status ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{status}</div>
                    ) : null}
                </div>

                <div className="mt-6 h-px w-full bg-gray-200 dark:bg-gray-800" />

                {error && (
                    <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                        {error}
                    </div>
                )}

                <div className="mt-6 space-y-6">
                    <section className="rounded-3xl border-2 border-emerald-200 bg-gradient-to-b from-emerald-50 via-white to-white dark:from-emerald-900/20 dark:via-gray-950 dark:to-gray-950 p-5 sm:p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Recommended</p>
                                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Free Lifetime Access</h3>
                                <p className="text-sm text-gray-600 dark:text-gray-300 max-w-xl mt-1">
                                    Concierge onboarding unlocks every dashboard forever. Book once, keep unlimited access.
                                </p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center dark:bg-emerald-900/40 dark:text-emerald-200">
                                <CalendarCheck className="h-6 w-6" />
                            </div>
                        </div>
                        <ul className="mt-4 space-y-2 text-sm text-gray-800 dark:text-gray-200">
                            {CONCIERGE_POINTS.map(point => (
                                <li key={point} className="flex items-start gap-2">
                                    <Check className="mt-0.5 h-4 w-4 text-emerald-500" />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-5 flex flex-col gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowScheduler(true);
                                    setCalendarLoaded(false);
                                }}
                                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                            >
                                Book Call &amp; Get Instant Access
                            </button>
                            <p className="text-xs text-gray-500 dark:text-gray-400">We unlock your dashboard the moment your call is booked.</p>
                        </div>

                        {showScheduler && (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2">
                                    <div
                                        className="calendly-inline-widget rounded-xl"
                                        data-url={CONCIERGE_CALENDAR_URL}
                                        style={{ minWidth: '320px', height: '700px' }}
                                    />
                                </div>
                                {!calendarLoaded && CONCIERGE_CALENDAR_URL && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                        Loading calendar...
                                    </div>
                                )}
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <button
                                        type="button"
                                        onClick={() => triggerFreeUnlock().catch(() => {})}
                                        disabled={claimingFreeAccess}
                                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-200 px-6 text-sm font-semibold hover:border-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-60"
                                    >
                                        {(claimingFreeAccess || freePathTriggered) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                        I booked my call – unlock access
                                    </button>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Booked already? Tap once and we’ll mark your account free forever.</p>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/30 p-5 sm:p-6">
                        <div className="flex flex-col gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Prefer to pay?</p>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Own the same insights with a self-serve plan.</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-300">Pick the cadence that fits. We charge instantly and hand you the keys right away.</p>
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            {planCards.map(plan => {
                                const isBusy = busyPlan === plan.id;
                                return (
                                    <div
                                        key={plan.id}
                                        className={`relative flex h-full flex-col rounded-2xl border p-5 transition sm:p-6 ${plan.highlight
                                            ? 'border-violet-300 bg-white shadow-lg dark:border-violet-700 dark:bg-gray-950'
                                            : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                                        } ${plan.orderClass}`}
                                    >
                                        {plan.badge ? (
                                            <div className="absolute top-5 right-5 inline-flex items-center rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm">
                                                {plan.badge}
                                            </div>
                                        ) : null}
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{plan.label}</span>
                                        </div>
                                        <div className="mt-4 flex items-baseline gap-2">
                                            <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{plan.price}</span>
                                            <span className="text-sm text-gray-500 dark:text-gray-400">{plan.suffix}</span>
                                        </div>
                                        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{plan.priceDetail}</p>
                                        <div className="mt-auto pt-5">
                                            <button
                                                data-autofocus={plan.autoFocus}
                                                type="button"
                                                onClick={() => onSelect(plan.id)}
                                                disabled={isBusy}
                                                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-medium text-white transition hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:opacity-70"
                                            >
                                                {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                                {plan.cta}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Instant access after payment</p>
                        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                            <ul className="space-y-2">
                                {SHARED_FEATURES.map(feature => (
                                    <li key={feature} className="flex items-start gap-2">
                                        <Check className="mt-0.5 h-4 w-4 text-indigo-500" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        Refresh status
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export type { PlanId };
