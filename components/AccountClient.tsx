"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
    adminContactLabel: string | null;
    billingMode: 'standard' | 'admin_free';
    isAdminFree: boolean;
};

type Membership = {
    account_id: string;
    user_id: string;
    role: 'manager' | 'owner';
    created_at?: string;
    email?: string | null;
    name?: string | null;
    last_login_at?: string | null;
};

function normalizeStoreUrl(input: string) {
    let v = (input || '').trim();
    if (!v) return v;
    v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return v.toLowerCase();
}

export default function AccountClient({ initial }: Props) {
    const searchParams = useSearchParams();
    const selectedAccountId = searchParams?.get('account') || '';
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
    const [adminFormName, setAdminFormName] = useState('');
    const [adminFormContact, setAdminFormContact] = useState('');
    const [adminFormStore, setAdminFormStore] = useState('');
    const [adminCreateBusy, setAdminCreateBusy] = useState(false);
    const [adminCreateError, setAdminCreateError] = useState<string | null>(null);
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editContact, setEditContact] = useState('');
    const [editStore, setEditStore] = useState('');
    const [editBusy, setEditBusy] = useState(false);
    const [adminManageError, setAdminManageError] = useState<string | null>(null);
    const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
    const [memberLists, setMemberLists] = useState<Record<string, Membership[]>>({});
    const [memberLoading, setMemberLoading] = useState<Record<string, boolean>>({});
    const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
    const [inviteRole, setInviteRole] = useState<Record<string, 'manager' | 'owner'>>({});
    const [inviteBusy, setInviteBusy] = useState<Record<string, boolean>>({});
    const [inviteMsg, setInviteMsg] = useState<Record<string, string>>({});
    const [inviteErr, setInviteErr] = useState<Record<string, string>>({});

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
                    adminContactLabel: a.adminContactLabel ?? null,
                    billingMode: a.billingMode === 'admin_free' ? 'admin_free' : 'standard',
                    isAdminFree: Boolean(a.isAdminFree),
                })));
                // Preload member lists for accounts
                if (!cancelled) {
                    const loadMembers = async (accountId: string) => {
                        setMemberLoading(prev => ({ ...prev, [accountId]: true }));
                        try {
                            const res = await fetch(`/api/admin/account-users?accountId=${accountId}`, { cache: 'no-store' });
                            const json = await res.json().catch(() => ({}));
                            if (res.ok) {
                                const members: Membership[] = (json.memberships || []).map((m: any) => ({
                                    account_id: m.account_id,
                                    user_id: m.user_id,
                                    role: m.role,
                                    created_at: m.created_at,
                                    email: m.email ?? null,
                                    name: m.name ?? null,
                                    last_login_at: m.last_login_at ?? null,
                                }));
                                setMemberLists(prev => ({ ...prev, [accountId]: members }));
                            }
                        } catch { /* ignore */ }
                        setMemberLoading(prev => ({ ...prev, [accountId]: false }));
                    };
                    for (const acct of j.accounts || []) {
                        loadMembers(acct.id);
                    }
                }
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

    const handleInvite = async (accountId: string) => {
        setInviteErr(prev => ({ ...prev, [accountId]: '' }));
        setInviteMsg(prev => ({ ...prev, [accountId]: '' }));
        const email = (inviteEmail[accountId] || '').trim();
        const role = inviteRole[accountId] || 'manager';
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            setInviteErr(prev => ({ ...prev, [accountId]: 'Enter a valid email' }));
            return;
        }
        setInviteBusy(prev => ({ ...prev, [accountId]: true }));
        try {
            const res = await fetch('/api/admin/account-users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, email, role }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(json?.error || 'Failed to invite/add');
            }
            setInviteMsg(prev => ({ ...prev, [accountId]: role === 'owner' ? 'Owner set' : 'Access granted / invite sent' }));
            // Refresh members list
            const listRes = await fetch(`/api/admin/account-users?accountId=${accountId}`, { cache: 'no-store' });
            const listJson = await listRes.json().catch(() => ({}));
            if (listRes.ok) {
                const members: Membership[] = (listJson.memberships || []).map((m: any) => ({
                    account_id: m.account_id,
                    user_id: m.user_id,
                    role: m.role,
                    created_at: m.created_at,
                    email: m.email ?? null,
                    name: m.name ?? null,
                    last_login_at: m.last_login_at ?? null,
                }));
                setMemberLists(prev => ({ ...prev, [accountId]: members }));
            }
            setInviteEmail(prev => ({ ...prev, [accountId]: '' }));
        } catch (e: any) {
            setInviteErr(prev => ({ ...prev, [accountId]: e?.message || 'Failed to invite/add' }));
        } finally {
            setInviteBusy(prev => ({ ...prev, [accountId]: false }));
        }
    };

    const handleRemoveMember = async (accountId: string, userId: string) => {
        setMemberLoading(prev => ({ ...prev, [accountId]: true }));
        try {
            const res = await fetch('/api/admin/account-users', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, userId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok && json?.status !== 'not_found') {
                throw new Error(json?.error || 'Failed to remove');
            }
            setMemberLists(prev => ({
                ...prev,
                [accountId]: (prev[accountId] || []).filter(m => m.user_id !== userId),
            }));
        } catch (e: any) {
            setInviteErr(prev => ({ ...prev, [accountId]: e?.message || 'Failed to remove' }));
        } finally {
            setMemberLoading(prev => ({ ...prev, [accountId]: false }));
        }
    };

    const onSaveCompany = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            const normalized = normalizeStoreUrl(storeUrl);
            const trimmedName = businessName.trim();
            const { error } = await supabase.auth.updateUser({
                data: { businessName: trimmedName, storeUrl: normalized },
            });
            if (error) throw error;
            setStoreUrl(normalized);
            const payload = {
                accountId: selectedAccountId || billingInfo.accountId || null,
                businessName: trimmedName,
                storeUrl: normalized,
            };
            const resp = await fetch('/api/account/update-company', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) {
                const json = await resp.json().catch(() => ({}));
                throw new Error(json?.error || 'Failed to update account details');
            }
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

    const onCreateAdminAccount = async (event: React.FormEvent) => {
        event.preventDefault();
        if (adminCreateBusy) return;
        setAdminCreateError(null);
        const trimmedName = adminFormName.trim();
        if (!trimmedName) {
            setAdminCreateError('Enter a business name');
            return;
        }
        setAdminCreateBusy(true);
        try {
            const payload = {
                businessName: trimmedName,
                contactLabel: adminFormContact.trim(),
                storeUrl: normalizeStoreUrl(adminFormStore),
            };
            const resp = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json?.error || 'Failed to create account');
            const createdAccount = json.account as AdminAccount | undefined;
            if (createdAccount) {
                setAdminAccounts(prev => [createdAccount, ...prev]);
            }
            setMsg('Created a new comped account');
            setAdminFormName('');
            setAdminFormContact('');
            setAdminFormStore('');
        } catch (error: any) {
            setAdminCreateError(error?.message || 'Failed to create account');
        } finally {
            setAdminCreateBusy(false);
        }
    };

    const startEditingAccount = (account: AdminAccount) => {
        setAdminManageError(null);
        setEditingAccountId(account.id);
        setEditName(account.businessName);
        setEditContact(account.adminContactLabel || '');
        setEditStore(account.storeUrl || '');
    };

    const cancelEditingAccount = () => {
        setEditingAccountId(null);
        setEditName('');
        setEditContact('');
        setEditStore('');
        setEditBusy(false);
    };

    const onSaveAdminAccount = async () => {
        if (!editingAccountId || editBusy) return;
        setAdminManageError(null);
        const trimmedName = editName.trim();
        if (!trimmedName) {
            setAdminManageError('Business name is required');
            return;
        }
        const trimmedContact = editContact.trim();
        if (trimmedContact.length > 80) {
            setAdminManageError('Contact tag must be 80 characters or fewer');
            return;
        }
        setEditBusy(true);
        try {
            const payload = {
                accountId: editingAccountId,
                businessName: trimmedName,
                contactLabel: trimmedContact,
                storeUrl: normalizeStoreUrl(editStore),
            };
            const resp = await fetch('/api/accounts', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json?.error || 'Failed to update account');
            const updated = json.account as AdminAccount | undefined;
            setAdminAccounts(prev => prev.map(acc => {
                if (acc.id !== editingAccountId) return acc;
                if (updated) {
                    return { ...acc, ...updated, ownerEmail: updated.ownerEmail ?? acc.ownerEmail };
                }
                return {
                    ...acc,
                    businessName: trimmedName,
                    storeUrl: payload.storeUrl || null,
                    adminContactLabel: trimmedContact || null,
                };
            }));
            setMsg('Account updated');
            cancelEditingAccount();
        } catch (error: any) {
            setAdminManageError(error?.message || 'Failed to update account');
        } finally {
            setEditBusy(false);
        }
    };

    const onDeleteAdminAccount = async (accountId: string) => {
        if (deleteBusyId) return;
        if (!window.confirm('Delete this account? This cannot be undone.')) return;
        setAdminManageError(null);
        setDeleteBusyId(accountId);
        try {
            const resp = await fetch('/api/accounts', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId }),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json?.error || 'Failed to delete account');
            setAdminAccounts(prev => prev.filter(acc => acc.id !== accountId));
            if (editingAccountId === accountId) {
                cancelEditingAccount();
            }
            setMsg('Account deleted');
        } catch (error: any) {
            setAdminManageError(error?.message || 'Failed to delete account');
        } finally {
            setDeleteBusyId(null);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <h1 className="text-2xl font-bold">Account</h1>

            {msg && <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}
            {err && <div className="rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}

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
                <section className="space-y-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                    <header className="space-y-1">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Accounts</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Create comped accounts and tag the contact so the dashboard picker shows a purple bubble for them.</p>
                    </header>
                    <form onSubmit={onCreateAdminAccount} className="space-y-4 rounded-xl border border-dashed border-purple-200 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/20 p-4">
                        <div className="grid gap-4 md:grid-cols-3">
                            <label className="text-sm text-gray-700 dark:text-gray-200">
                                <span className="mb-1 block font-medium">Business name</span>
                                <input
                                    className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                    value={adminFormName}
                                    onChange={e => setAdminFormName(e.target.value)}
                                    placeholder="Acme Skincare"
                                />
                            </label>
                            <label className="text-sm text-gray-700 dark:text-gray-200">
                                <span className="mb-1 block font-medium">Contact tag (optional)</span>
                                <input
                                    className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                    value={adminFormContact}
                                    onChange={e => setAdminFormContact(e.target.value)}
                                    placeholder="Taylor – Head of Email"
                                    maxLength={80}
                                />
                                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">Shown as a purple bubble in the dashboard switcher.</span>
                            </label>
                            <label className="text-sm text-gray-700 dark:text-gray-200">
                                <span className="mb-1 block font-medium">Store URL (optional)</span>
                                <input
                                    className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                    value={adminFormStore}
                                    onChange={e => setAdminFormStore(e.target.value)}
                                    placeholder="brand.com"
                                />
                            </label>
                        </div>
                        {adminCreateError && <div className="text-sm text-rose-600 dark:text-rose-400">{adminCreateError}</div>}
                        <div className="flex items-center gap-3">
                            <button
                                type="submit"
                                disabled={adminCreateBusy}
                                className="inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                            >
                                {adminCreateBusy ? 'Creating…' : 'Create account'}
                            </button>
                        </div>
                    </form>
                    {adminError && <div className="text-sm text-rose-600">{adminError}</div>}
                    {adminManageError && <div className="text-sm text-rose-600">{adminManageError}</div>}
                    <ul className="space-y-3">
                        {adminAccounts.map(account => (
                            <li key={account.id} className="rounded border border-gray-200 dark:border-gray-800 px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="font-medium text-base text-gray-900 dark:text-gray-100">{account.businessName}</div>
                                        {account.isAdminFree && (
                                            <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 px-2 py-0.5 text-[11px] font-semibold tracking-wide">
                                                {account.adminContactLabel || 'Internal'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => startEditingAccount(account)}
                                            className="inline-flex items-center rounded border border-gray-200 dark:border-gray-700 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDeleteAdminAccount(account.id)}
                                            disabled={deleteBusyId === account.id}
                                            className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
                                        >
                                            {deleteBusyId === account.id ? 'Deleting…' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                                {account.storeUrl && (
                                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                        {account.storeUrl}
                                    </div>
                                )}
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {account.ownerEmail ? `Owner: ${account.ownerEmail}` : 'Owner email unavailable'}
                                    </div>
                                    {/* Access management */}
                                    <div className="mt-3 space-y-3 border-t border-dashed border-gray-200 pt-3 dark:border-gray-800">
                                        <div className="flex items-center justify-between">
                                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Access</div>
                                            {memberLoading[account.id] && <span className="text-xs text-gray-500">Updating…</span>}
                                        </div>
                                        <div className="space-y-2">
                                            {(memberLists[account.id] || []).length === 0 && (
                                                <div className="text-sm text-gray-500 dark:text-gray-400">No members yet.</div>
                                            )}
                                            {(memberLists[account.id] || []).map(m => {
                                                const primary = m.email || m.name || m.user_id;
                                                const secondary = m.name && m.name !== primary ? m.name : null;
                                                const lastLogin = m.last_login_at ? new Date(m.last_login_at).toLocaleString() : 'No recent login';
                                                return (
                                                    <div key={m.user_id} className="flex items-center justify-between rounded border border-gray-200 dark:border-gray-700 px-3 py-2">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm text-gray-800 dark:text-gray-100">{primary}</span>
                                                            {secondary && <span className="text-xs text-gray-500 dark:text-gray-400">{secondary}</span>}
                                                            <span className="text-xs text-gray-500 dark:text-gray-400">{m.role === 'owner' ? 'Owner' : 'Manager'}</span>
                                                            <span className="text-[11px] text-gray-400 dark:text-gray-500">Last login: {lastLogin}</span>
                                                        </div>
                                                        {m.role !== 'owner' && (
                                                            <button
                                                                type="button"
                                                                disabled={memberLoading[account.id]}
                                                                onClick={() => handleRemoveMember(account.id, m.user_id)}
                                                                className="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-300"
                                                            >
                                                                Remove
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-5">
                                            <input
                                                type="email"
                                                placeholder="user@example.com"
                                                value={inviteEmail[account.id] || ''}
                                                onChange={e => setInviteEmail(prev => ({ ...prev, [account.id]: e.target.value }))}
                                                className="sm:col-span-3 h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                            />
                                            <select
                                                value={inviteRole[account.id] || 'manager'}
                                                onChange={e => setInviteRole(prev => ({ ...prev, [account.id]: e.target.value as 'manager' | 'owner' }))}
                                                className="sm:col-span-1 h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100"
                                            >
                                                <option value="manager">Manager</option>
                                                <option value="owner">Owner</option>
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => handleInvite(account.id)}
                                                disabled={inviteBusy[account.id]}
                                                className="sm:col-span-1 inline-flex items-center justify-center rounded bg-purple-600 px-3 h-10 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                                            >
                                                {inviteBusy[account.id] ? 'Sending…' : 'Grant'}
                                            </button>
                                        </div>
                                        {(inviteErr[account.id] || inviteMsg[account.id]) && (
                                            <div className="text-xs text-gray-600 dark:text-gray-300">
                                                {inviteErr[account.id] && <span className="text-rose-600 dark:text-rose-300">{inviteErr[account.id]}</span>}
                                                {inviteMsg[account.id] && <span className="text-emerald-600 dark:text-emerald-300">{inviteMsg[account.id]}</span>}
                                            </div>
                                        )}
                                    </div>
                                {editingAccountId === account.id && (
                                    <div className="mt-3 space-y-3 border-t border-dashed border-gray-200 pt-3 dark:border-gray-800">
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <label className="text-sm text-gray-700 dark:text-gray-200">
                                                <span className="mb-1 block font-medium">Business name</span>
                                                <input
                                                    className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                />
                                            </label>
                                            <label className="text-sm text-gray-700 dark:text-gray-200">
                                                <span className="mb-1 block font-medium">Contact tag</span>
                                                <input
                                                    className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                                    value={editContact}
                                                    onChange={e => setEditContact(e.target.value)}
                                                    maxLength={80}
                                                />
                                            </label>
                                            <label className="text-sm text-gray-700 dark:text-gray-200">
                                                <span className="mb-1 block font-medium">Store URL</span>
                                                <input
                                                    className="w-full h-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100"
                                                    value={editStore}
                                                    onChange={e => setEditStore(e.target.value)}
                                                />
                                            </label>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={onSaveAdminAccount}
                                                disabled={editBusy}
                                                className="inline-flex items-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                                            >
                                                {editBusy ? 'Saving…' : 'Save changes'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={cancelEditingAccount}
                                                disabled={editBusy}
                                                className="inline-flex items-center rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
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
