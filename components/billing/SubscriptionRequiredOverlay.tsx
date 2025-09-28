"use client";

import React from 'react';
import { Loader2, ShieldCheck, CreditCard, CalendarDays } from 'lucide-react';

export type PlanCadence = 'monthly' | 'annual';

interface Props {
    open: boolean;
    businessName?: string;
    selecting?: PlanCadence | null;
    onSelectPlan: (cadence: PlanCadence) => void;
    onManageBilling?: () => void;
    onRefreshStatus?: () => void;
    canManageBilling?: boolean;
    portalBusy?: boolean;
    error?: string | null;
    status?: string | null;
    trialEndsAt?: string | null;
}

const plans: Array<{ cadence: PlanCadence; price: string; label: string; savings?: string }> = [
    { cadence: 'monthly', price: '$19', label: 'Monthly' },
    { cadence: 'annual', price: '$199', label: 'Annual', savings: 'Save 15% vs monthly' }
];

export default function SubscriptionRequiredOverlay({
    open,
    businessName,
    selecting,
    onSelectPlan,
    onManageBilling,
    canManageBilling,
    onRefreshStatus,
    error,
    status,
    trialEndsAt,
    portalBusy
}: Props) {
    if (!open) return null;
    const trialCopy = trialEndsAt ? `Trial active until ${new Date(trialEndsAt).toLocaleDateString()}` : '30 day free trial on every plan';
    const normalizedStatus = status ? status.replace(/_/g, ' ') : 'inactive';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl px-8 py-10 relative text-gray-900">
                <div className="absolute inset-0 pointer-events-none rounded-3xl border border-white/60" />
                <div className="flex flex-col gap-6 relative">
                    <div className="flex flex-col gap-2 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                            <ShieldCheck className="h-6 w-6" />
                        </div>
                        <h2 className="text-2xl font-semibold">Choose your Email Metrics plan</h2>
                        <p className="text-sm text-gray-600 max-w-xl mx-auto">
                            {businessName ? `${businessName} ` : ''}your dashboard unlocks after selecting a plan. Every subscription starts with a 30 day free trial—cancel anytime before it renews.
                        </p>
                        <div className="mx-auto flex items-center gap-2 text-xs uppercase tracking-wide text-indigo-600 font-semibold">
                            <CalendarDays className="h-4 w-4" />
                            {trialCopy}
                        </div>
                        <div className="text-xs text-gray-400">Current status: {normalizedStatus}</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plans.map(plan => {
                            const loading = selecting === plan.cadence;
                            return (
                                <button
                                    key={plan.cadence}
                                    onClick={() => onSelectPlan(plan.cadence)}
                                    disabled={!!selecting}
                                    className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white px-6 py-6 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md disabled:cursor-not-allowed"
                                >
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-400 to-violet-500" />
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-sm font-semibold text-gray-500">{plan.label}</div>
                                            <div className="mt-1 flex items-baseline gap-1">
                                                <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                                                <span className="text-sm text-gray-500">USD</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                                                <CreditCard className="h-4 w-4" />
                                                <span>30 day free trial • Cancel anytime</span>
                                            </div>
                                        </div>
                                        {plan.savings ? (
                                            <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-600">{plan.savings}</span>
                                        ) : null}
                                    </div>
                                    <ul className="mt-4 space-y-2 text-sm text-gray-600">
                                        <li>✔ Unlimited dashboard access</li>
                                        <li>✔ Automated Klaviyo CSV processing</li>
                                        <li>✔ Priority metrics refresh</li>
                                    </ul>
                                    {loading ? (
                                        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1 text-xs font-semibold text-indigo-600">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Redirecting to secure checkout…
                                        </div>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                    {error ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                            {error}
                        </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-gray-500">
                        {canManageBilling ? (
                            <button
                                className="rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={onManageBilling}
                                type="button"
                                disabled={portalBusy}
                            >
                                {portalBusy ? 'Redirecting to portal…' : 'Already subscribed? Manage billing'}
                            </button>
                        ) : null}
                        <button
                            className="rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 transition hover:border-indigo-200 hover:text-indigo-600"
                            onClick={onRefreshStatus}
                            type="button"
                        >
                            Refresh status
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
