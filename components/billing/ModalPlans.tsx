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

const MONTHLY_BENEFITS = [
    'See what’s working and what’s costing you money',
    'Optimize flows and campaigns for higher returns',
    'Keep your audience engaged and deliverability strong',
    'Turn insights into extra revenue you’d otherwise miss'
];

const ANNUAL_BENEFITS = [
    'Full access to actionable Klaviyo insights',
    'Smarter campaign and flow optimization all year',
    'Ongoing audience management that reduces costs',
    'Boost ROI with proven strategies at scale'
];

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
            title: 'Monthly',
            pricePrimary: '$0 today',
            priceSecondary: 'then $19 / month',
            tagline: 'Flexible access with no long-term commitment',
            benefits: MONTHLY_BENEFITS,
            buttonTone: 'violet',
            microcopy: 'Pay nothing for 30 days. Cancel anytime.',
            highlight: false
        },
        {
            id: 'annual' as PlanId,
            title: 'Annual',
            pricePrimary: '$0 today',
            priceSecondary: 'then $199 / year',
            tagline: 'Lock in savings and maximize long-term growth',
            benefits: ANNUAL_BENEFITS,
            buttonTone: 'indigo',
            microcopy: 'Your card won’t be charged until the trial ends.',
            highlight: true
        }
    ]), []);

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
                    <h2 id="plans-title" className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Choose your Email Metrics plan</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
                        Unlock powerful, easy-to-use analytics that help you optimize flows, improve campaigns, and grow revenue. Every plan starts with a 30-day free trial—$0 due today. Cancel anytime.
                    </p>
                    <div className="text-xs font-semibold text-indigo-600">30 day free trial on every plan</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{status}</div>
                </div>

                {error && (
                    <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                        {error}
                    </div>
                )}

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    {planCards.map(plan => {
                        const isBusy = busyPlan === plan.id;
                        return (
                            <div
                                key={plan.id}
                                className={`rounded-2xl p-5 transition ${plan.highlight ? 'bg-indigo-50/30 dark:bg-indigo-900/20 ring-2 ring-indigo-500 dark:ring-indigo-400' : 'bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-800'}`}
                            >
                                {plan.highlight && (
                                    <div className="mb-3 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                                        Best Value – Save 12% vs monthly
                                    </div>
                                )}
                                <div className="flex flex-col gap-2">
                                    <div className="text-base font-medium text-gray-900 dark:text-gray-100">{plan.title}</div>
                                    <div className="flex flex-col">
                                        <span className="text-xl font-semibold text-emerald-600">{plan.pricePrimary}</span>
                                        <span className="text-sm text-gray-600 dark:text-gray-300">{plan.priceSecondary}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">{plan.tagline}</p>
                                    <ul className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                                        {plan.benefits.map(benefit => (
                                            <li key={benefit} className="flex items-start gap-2">
                                                <Check className="h-4 w-4 mt-0.5 text-emerald-500" />
                                                <span>{benefit}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        data-autofocus={plan.id === 'annual'}
                                        type="button"
                                        onClick={() => onSelect(plan.id)}
                                        disabled={isBusy}
                                        className={`mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${plan.buttonTone === 'indigo'
                                            ? 'bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600'
                                            : 'bg-violet-600 hover:bg-violet-500 focus-visible:outline-violet-600'
                                        }`}
                                    >
                                        {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                        Get Started Free
                                    </button>
                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{plan.microcopy}</div>
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
