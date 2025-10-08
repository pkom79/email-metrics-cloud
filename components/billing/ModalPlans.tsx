"use client";

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';

type PlanId = 'monthly' | 'annual';

type Props = {
    open: boolean;
    status: string;
    onClose: () => void;
    onSelect: (planId: PlanId) => void;
    onRefresh?: () => void;
    busyPlan?: PlanId | null;
    error?: string | null;
};

const SHARED_FEATURES = [
    'See what’s working and what’s costing you money',
    'Optimize flows and campaigns for higher returns',
    'Keep your audience engaged and deliverability strong',
    'Manage audience size and reduce costs automatically',
    'Turn insights into extra revenue you’d otherwise miss'
];

const MONTHLY_PRICE = 19;
const ANNUAL_PRICE = 99;
const annualMonthlyEquivalent = MONTHLY_PRICE * 12;
const annualSavingsValue = annualMonthlyEquivalent - ANNUAL_PRICE;
const annualSavingsPercent = Math.round((annualSavingsValue / annualMonthlyEquivalent) * 100);

export default function ModalPlans({ open, status, onClose, onSelect, onRefresh, busyPlan, error }: Props) {
    const overlayRef = useRef<HTMLDivElement | null>(null);

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

    const planCards = useMemo(() => ([
        {
            id: 'monthly' as PlanId,
            label: 'Monthly',
            priceDetail: `Monthly: $${MONTHLY_PRICE} / month`,
            highlight: false,
            orderClass: 'order-2 sm:order-1',
            autoFocus: false
        },
        {
            id: 'annual' as PlanId,
            label: 'Annual',
            priceDetail: `Annual: $${ANNUAL_PRICE} / year`,
            highlight: true,
            badge: `BEST VALUE – SAVE ${annualSavingsPercent}%`,
            orderClass: 'order-1 sm:order-2',
            autoFocus: true
        }
    ]), [annualSavingsPercent]);

    const finePrint = 'Your card won’t be charged until the trial ends. Cancel anytime.';

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
            <div className="relative w-full max-w-3xl rounded-2xl bg-white dark:bg-gray-950 shadow-2xl ring-1 ring-black/5 p-5 sm:p-8" onMouseDown={e => e.stopPropagation()}>
                <div className="flex flex-col items-center gap-3 text-center">
                    <div className="h-12 w-12 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <h2 id="plans-title" className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Choose your plan</h2>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">Same features. Pay how you prefer.</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
                        Unlock powerful, easy-to-use analytics that help you optimize flows, improve campaigns, and grow revenue. Every plan starts with a 30-day free trial–$0 due today. Cancel anytime.
                    </p>
                    <div className="text-xs font-semibold text-indigo-600">30 day free trial on every plan</div>
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

                <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
                    <ul className="space-y-3">
                        {SHARED_FEATURES.map(feature => (
                            <li key={feature} className="flex items-start gap-2">
                                <Check className="mt-0.5 h-4 w-4 text-emerald-500" />
                                <span>{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    {planCards.map(plan => {
                        const isBusy = busyPlan === plan.id;
                        return (
                            <div
                                key={plan.id}
                                className={`relative flex h-full flex-col rounded-2xl border p-5 transition sm:p-6 ${plan.highlight
                                    ? 'border-emerald-300 bg-emerald-50/40 shadow-lg dark:border-emerald-700 dark:bg-emerald-900/10'
                                    : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                                } ${plan.orderClass}`}
                            >
                                {plan.badge ? (
                                    <div className="absolute top-5 right-5 inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm">
                                        {plan.badge}
                                    </div>
                                ) : null}
                                <div className="flex items-start justify-between">
                                    <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{plan.label}</span>
                                </div>
                                <div className="mt-4 flex flex-col gap-2">
                                    <span className="text-3xl font-bold text-emerald-600">$0 today</span>
                                    <span className="inline-flex w-fit items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                                        30-day free trial
                                    </span>
                                </div>
                                <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">{plan.priceDetail}</p>
                                <div className="mt-auto pt-6">
                                    <button
                                        data-autofocus={plan.autoFocus}
                                        type="button"
                                        onClick={() => onSelect(plan.id)}
                                        disabled={isBusy}
                                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-medium text-white transition hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:opacity-70"
                                    >
                                        {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                        Get Started Free
                                    </button>
                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{finePrint}</div>
                                </div>
                            </div>
                        );
                    })}
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
