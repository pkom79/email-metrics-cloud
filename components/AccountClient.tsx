"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';

type Props = {
    initial: { email: string; businessName: string; storeUrl: string };
};

type AdminAccount = {
    id: string;
    businessName: string;
    ownerEmail: string | null;
    storeUrl: string | null;
    country: string | null;
};

function normalizeStoreUrl(input: string) {
    let v = (input || '').trim();
    if (!v) return v;
    v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return v.toLowerCase();
}

export default function AccountClient({ initial }: Props) {
    const [email, setEmail] = useState(initial.email);
    const [businessName, setBusinessName] = useState(initial.businessName || '');
    const [storeUrl, setStoreUrl] = useState(normalizeStoreUrl(initial.storeUrl || ''));

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [emailChangeRequested, setEmailChangeRequested] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState('');
    const [deleting, setDeleting] = useState(false);

    const [isAdmin, setIsAdmin] = useState(false);
    const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
    const [adminError, setAdminError] = useState<string | null>(null);

    const [billingInfo, setBillingInfo] = useState({
        loading: true,
        accountId: '',
        status: 'unknown',
        trialEndsAt: null as string | null,
        error: null as string | null,
        portalBusy: false,
        canManage: false,
        portalLoginUrl: process.env.NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL || ''
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const session = (await supabase.auth.getSession()).data.session;
            const admin = session?.user?.app_metadata?.role === 'admin';
            if (!admin) return;
            setIsAdmin(true);
            try {
                const res = await fetch('/api/accounts', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
                const j = await res.json();
                if (!cancelled) setAdminAccounts((j.accounts || []).map((a: any) => ({
                    id: a.id,
                    businessName: a.businessName,
                    ownerEmail: a.ownerEmail ?? null,
                    storeUrl: a.storeUrl ?? null,
                    country: a.country ?? null,
                })));
            } catch (e: any) {
                if (!cancelled) setAdminError(e?.message || 'Failed to load accounts');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const resp = await fetch('/api/payments/status', { cache: 'no-store' });
                if (!resp.ok) {
                    if (resp.status === 403) throw new Error('Billing is only available to the account owner.');
                    throw new Error('Unable to load billing details.');
                }
                const json = await resp.json().catch(() => ({}));
                if (cancelled) return;
                const subscription = json.subscription || {};
                setBillingInfo(prev => ({
                    ...prev,
                    loading: false,
                    accountId: json.accountId || '',
                    status: (subscription.status || 'inactive').toLowerCase(),
                    trialEndsAt: subscription.trialEndsAt || null,
                    canManage: Boolean(subscription.hasCustomer),
                    portalLoginUrl: json.portalLoginUrl || prev.portalLoginUrl || ''
                }));
            } catch (err: any) {
                if (cancelled) return;
                setBillingInfo(prev => ({ ...prev, loading: false, error: err?.message || 'Unable to load billing details.' }));
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const currentEmail = useMemo(() => (initial.email || '').trim().toLowerCase(), [initial.email]);
    const enteredEmail = useMemo(() => (email || '').trim().toLowerCase(), [email]);
    const isValidEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(enteredEmail);
    const hasEmailChanged = enteredEmail && enteredEmail !== currentEmail;
    const canChangeEmail = !busy && isValidEmail && hasEmailChanged;

    const handleError = (error: any, fallback = 'Something went wrong') => {
        const message = error?.message || (typeof error === 'string' ? error : fallback);
        setErr(message);
    };

    const onSaveCompany = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            const normalized = normalizeStoreUrl(storeUrl);
            const { error } = await supabase.auth.updateUser({
                data: { businessName: businessName.trim(), storeUrl: normalized },
            });
            if (error) throw error;
            setStoreUrl(normalized);
            setMsg('Company details updated');
        } catch (e) {
            handleError(e, 'Failed to update company details');
        } finally {
            setBusy(false);
        }
    };

    const onChangeEmail = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            if (!canChangeEmail) throw new Error('Enter a valid email');
            const origin = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '') || '').replace(/\/$/, '');
            const redirectTo = `${origin}/auth/change-email`;
            const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
            if (error) throw error;
            setMsg('Check your email to confirm the change');
            setEmailChangeRequested(true);
        } catch (e) {
            handleError(e, 'Failed to start email change');
        } finally {
            setBusy(false);
        }
    };

    const onResendEmailChange = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            if (!enteredEmail || !isValidEmail) throw new Error('Enter a valid email');
            const origin = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '') || '').replace(/\/$/, '');
            const { error } = await (supabase as any).auth.resend({
                email,
                type: 'email_change',
                options: { emailRedirectTo: `${origin}/auth/change-email` },
            });
            if (error) throw error;
            setMsg('Confirmation email resent. Please check your inbox.');
        } catch (e) {
            handleError(e, 'Failed to resend email');
        } finally {
            setBusy(false);
        }
    };

    const onChangePassword = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');
            if (password !== confirm) throw new Error('Passwords do not match');
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            setMsg('Password updated');
            setPassword(''); setConfirm('');
        } catch (e) {
            handleError(e, 'Failed to change password');
        } finally {
            setBusy(false);
        }
    };

    const onDeleteAccount = async () => {
        if (deleting) return;
        setDeleting(true); setErr(null); setMsg(null);
        try {
            const res = await fetch('/api/account/delete', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j?.ok) throw new Error(j.error || 'Delete failed');
            setMsg('Account deleted');
            await supabase.auth.signOut();
            setTimeout(() => { window.location.href = '/'; }, 800);
        } catch (e) {
            handleError(e, 'Failed to delete account');
        } finally {
            setDeleting(false);
        }
    };

    const openBillingPortal = async () => {
        if (billingInfo.portalBusy) return;
        const direct = billingInfo.portalLoginUrl;
        if (direct) {
            window.open(direct, '_blank', 'noopener,noreferrer');
            return;
        }
        if (!billingInfo.accountId) {
            setBillingInfo(prev => ({ ...prev, error: 'No billing account available.' }));
            return;
        }
        try {
            setBillingInfo(prev => ({ ...prev, portalBusy: true, error: null }));
            const resp = await fetch('/api/payments/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: billingInfo.accountId })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok || !json?.url) {
                throw new Error(json?.error || 'Unable to open billing portal.');
            }
            window.location.href = json.url as string;
        } catch (error: any) {
            setBillingInfo(prev => ({ ...prev, error: error?.message || 'Unable to open billing portal.' }));
        } finally {
            setBillingInfo(prev => ({ ...prev, portalBusy: false }));
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <h1 className="text-2xl font-bold">Account</h1>

            {msg && <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}
            {err && <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}

            <section className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <header className="space-y-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Company details</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Update the business name and store URL shown across the dashboard.</p>
                </header>
                <div className="space-y-3">
                    <label className="block text-sm text-gray-700 dark:text-gray-300">
                        <span className="mb-1 block">Business name</span>
                        <input
                            value={businessName}
                            onChange={e => setBusinessName(e.target.value)}
                            className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                            placeholder="Acme Co"
                        />
                    </label>
                    <label className="block text-sm text-gray-700 dark:text-gray-300">
                        <span className="mb-1 block">Store URL</span>
                        <input
                            value={storeUrl}
                            onChange={e => setStoreUrl(e.target.value)}
                            className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                            placeholder="yourstore.com"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={onSaveCompany}
                        disabled={busy}
                        className={`inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60`}
                    >
                        Save
                    </button>
                </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <header className="space-y-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Login email</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Change the email used for sign-in and notifications.</p>
                </header>
                <div className="space-y-3">
                    <label className="block text-sm text-gray-700 dark:text-gray-300">
                        <span className="mb-1 block">Email</span>
                        <input
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                            type="email"
                        />
                    </label>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>{emailChangeRequested ? 'Confirmation pending.' : 'A confirmation email will be sent to the new address.'}</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={onChangeEmail}
                            disabled={!canChangeEmail || busy}
                            className="inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                        >
                            Update email
                        </button>
                        {emailChangeRequested && (
                            <button
                                type="button"
                                onClick={onResendEmailChange}
                                disabled={busy}
                                className="inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                            >
                                Resend confirmation
                            </button>
                        )}
                    </div>
                </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <header className="space-y-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Billing</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Manage your Email Metrics subscription, payment methods, and invoices.</p>
                </header>
                {billingInfo.error && <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{billingInfo.error}</div>}
                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    <div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">Status:</span>{' '}
                        <span className="uppercase tracking-wide text-xs inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 font-semibold text-gray-700 dark:text-gray-200">
                            {billingInfo.loading ? 'Checking…' : billingInfo.status.replace(/_/g, ' ')}
                        </span>
                    </div>
                    {billingInfo.trialEndsAt && (
                        <div>Trial ends on {new Date(billingInfo.trialEndsAt).toLocaleDateString()}</div>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={openBillingPortal}
                        disabled={billingInfo.portalBusy || billingInfo.loading}
                        className="inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                    >
                        {billingInfo.portalBusy ? 'Opening portal…' : 'Open billing portal'}
                    </button>
                    {billingInfo.portalLoginUrl && (
                        <a
                            href={billingInfo.portalLoginUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                            Stripe portal login
                        </a>
                    )}
                </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <header className="space-y-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Password</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Choose a new password for this account.</p>
                </header>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                        <span className="mb-1 block">New password</span>
                        <input
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            type="password"
                            className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                        />
                    </label>
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                        <span className="mb-1 block">Confirm password</span>
                        <input
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            type="password"
                            className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                        />
                    </label>
                </div>
                <button
                    type="button"
                    onClick={onChangePassword}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                >
                    Update password
                </button>
            </section>

            {isAdmin && (
                <section className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                    <header className="space-y-1">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Global Admin</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Open any customer account in read/write mode.</p>
                    </header>
                    {adminError && <div className="text-sm text-rose-600">{adminError}</div>}
                    <ul className="space-y-2">
                        {adminAccounts.map(account => (
                            <li key={account.id} className="flex items-center justify-between rounded border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
                                <div>
                                    <div className="font-medium">{account.businessName}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {account.ownerEmail ? `Owner: ${account.ownerEmail}` : 'Owner email unavailable'}
                                    </div>
                                </div>
                                <a
                                    href={`/dashboard?account=${account.id}`}
                                    className="inline-flex items-center justify-center rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
                                >
                                    Open
                                </a>
                            </li>
                        ))}
                        {!adminError && adminAccounts.length === 0 && (
                            <li className="rounded border border-dashed border-gray-200 dark:border-gray-800 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                No customer accounts found yet.
                            </li>
                        )}
                    </ul>
                </section>
            )}

            <section className="space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-800 dark:bg-rose-950/30">
                <header className="space-y-1">
                    <h2 className="text-lg font-semibold text-rose-700 dark:text-rose-300">Danger zone</h2>
                    <p className="text-sm text-rose-600 dark:text-rose-200">Deleting your account removes uploads, snapshots, and dashboard data.</p>
                </header>
                <label className="block text-sm text-rose-700 dark:text-rose-200">
                    <span className="mb-1 block">Type DELETE to confirm</span>
                    <input
                        value={deleteConfirm}
                        onChange={e => setDeleteConfirm(e.target.value)}
                        className="w-full h-10 rounded border border-rose-300 bg-white px-3 text-sm text-rose-700 focus:border-rose-500 focus:outline-none dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-100"
                        placeholder="DELETE"
                    />
                </label>
                <button
                    type="button"
                    onClick={onDeleteAccount}
                    disabled={deleting || deleteConfirm !== 'DELETE'}
                    className="inline-flex items-center justify-center rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                    Delete account
                </button>
            </section>
        </div>
    );
}
