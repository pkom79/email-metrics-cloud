"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import SelectBase from "./ui/SelectBase";
import { supabase } from '../lib/supabase/client';

type Props = {
    initial: { email: string; businessName: string; storeUrl: string };
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
    const [isAgency, setIsAgency] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    useEffect(() => { (async () => {
        const { data } = await supabase.auth.getUser();
        setIsAgency(((data.user?.user_metadata as any)?.signup_type) === 'agency');
        try {
            // Show Management when owner of current brand if provided, otherwise when owner of any brand
            const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
            const accountId = sp.get('account');
            const r = await fetch(`/api/account/is-owner${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`, { cache: 'no-store' });
            const j = await r.json().catch(() => ({}));
            const isOwnerCurrent = accountId ? Boolean(j?.isOwnerOf) : Boolean(j?.isOwnerAny);
            setIsOwner(isOwnerCurrent);
        } catch { setIsOwner(false); }
    })(); }, []);

    const onDeleteAccount = async () => {
        if (deleting) return;
        setDeleting(true); setErr(null); setMsg(null);
        try {
            const res = await fetch('/api/account/delete', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j?.ok) throw new Error(j.error || 'Delete failed');
            setMsg('Account deleted');
            // Sign out locally
            await supabase.auth.signOut();
            // Redirect after short delay
            setTimeout(() => { window.location.href = '/'; }, 800);
        } catch (e: any) {
            setErr(e?.message || 'Failed to delete');
        } finally { setDeleting(false); }
    };

    const onSaveCompany = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            const normalized = normalizeStoreUrl(storeUrl);
            const { error } = await supabase.auth.updateUser({ data: { businessName: businessName.trim(), storeUrl: normalized } });
            if (error) throw error;
            setStoreUrl(normalized);
            setMsg('Company details updated');
        } catch (e: any) {
            setErr(e?.message || 'Failed to update');
        } finally {
            setBusy(false);
        }
    };

    const onChangeEmail = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email');
            const base = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '') || '').replace(/\/$/, '');
            const redirectTo = `${base}/auth/change-email`;
            const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
            if (error) throw error;
            setMsg('Check your email to confirm the change');
            setEmailChangeRequested(true);
        } catch (e: any) {
            setErr(e?.message || 'Failed to start email change');
        } finally {
            setBusy(false);
        }
    };

    const onResendEmailChange = async () => {
        setBusy(true); setMsg(null); setErr(null);
        try {
            if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email');
            const origin = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '') || '').replace(/\/$/, '');
            const { error } = await (supabase as any).auth.resend({
                email,
                type: 'email_change',
                options: { emailRedirectTo: `${origin}/auth/change-email` }
            });
            if (error) throw error;
            setMsg('Confirmation email resent. Please check your inbox.');
        } catch (e: any) {
            setErr(e?.message || 'Failed to resend email');
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
        } catch (e: any) {
            setErr(e?.message || 'Failed to change password');
        } finally {
            setBusy(false);
        }
    };

    const currentEmail = (initial.email || '').trim().toLowerCase();
    const enteredEmail = (email || '').trim().toLowerCase();
    const isValidEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(enteredEmail);
    const hasEmailChanged = enteredEmail && enteredEmail !== currentEmail;
    const canChangeEmail = !busy && isValidEmail && hasEmailChanged;

    const [allAccounts, setAllAccounts] = useState<any[] | null>(null);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('admin-self');
    const [isAdmin, setIsAdmin] = useState(false);
    // Removed: third‑party API integration state (CSV‑only ingestion)

    // Detect admin & fetch accounts list
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const session = (await supabase.auth.getSession()).data.session;
            const admin = session?.user?.app_metadata?.role === 'admin';
            if (!admin) return; // normal users skip
            setIsAdmin(true);
            try {
                const res = await fetch('/api/accounts', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
                const j = await res.json();
                if (cancelled) return;
                setAllAccounts(j.accounts || []);
            } catch (e: any) {
                if (!cancelled) setAccountsError(e?.message || 'Failed to load accounts');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Integrations removed: no background status queries

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <h1 className="text-2xl font-bold">Account</h1>

            {/* Management hub */}
            {(!isAgency && isOwner) && (
            <section className="space-y-3">
                <h2 className="font-semibold">Management</h2>
                    <div className="grid gap-3">
                        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Managers</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">Invite and manage brand members.</div>
                            </div>
                            <Link href="/account/members" className="inline-flex items-center px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm">Open</Link>
                        </div>
                        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Notifications</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">Manage per-brand recipients.</div>
                            </div>
                            <Link href="/account/notifications" className="inline-flex items-center px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm">Open</Link>
                        </div>
                        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Brands</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">Create and switch between your brands.</div>
                            </div>
                            <Link href="/account/brands" className="inline-flex items-center px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm">Open</Link>
                        </div>
                    </div>
            </section>
            )}
            {isAgency && (
                <section className="space-y-3">
                    <h2 className="font-semibold">Management</h2>
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Agency Console</div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">Manage brands linked to your agency.</div>
                        </div>
                        <Link href="/agencies" className="inline-flex items-center px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm">Open</Link>
                    </div>
                </section>
            )}

            {isAdmin && (
                <section className="space-y-3">
                    <h2 className="font-semibold flex items-center gap-2">Accounts</h2>
                    <p className="text-xs text-gray-500">Select your profile or view another account (read-only).</p>
                    {accountsError && <div className="text-xs text-red-600">{accountsError}</div>}
                    <div className="relative">
                        <SelectBase
                            value={selectedAccountId}
                            onChange={e => setSelectedAccountId((e.target as HTMLSelectElement).value)}
                            className="w-full px-3 py-2 pr-9 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100"
                        >
                            <option value="admin-self">Admin (My Account)</option>
                            {(allAccounts || []).map(a => (
                                <option key={a.id} value={a.id}>{a.businessName || a.id}</option>
                            ))}
                        </SelectBase>
                    </div>
                    {selectedAccountId !== 'admin-self' && selectedAccountId && (
                        <div className="text-xs text-gray-600 dark:text-gray-300 space-y-2 border rounded p-3 bg-gray-50 dark:bg-gray-800/40">
                            {(() => {
                                const a = (allAccounts || []).find(x => x.id === selectedAccountId); if (!a) return null; return (
                                    <>
                                        <div className="grid sm:grid-cols-2 gap-2">
                                            <div><span className="font-medium">Owner Email:</span> {a.ownerEmail || '—'}</div>
                                            <div><span className="font-medium">Country:</span> {a.country || '—'}</div>
                                            <div className="sm:col-span-2"><span className="font-medium">Store URL:</span> {a.storeUrl ? `https://${a.storeUrl}` : '—'}</div>
                                        </div>
                                        <div className="mt-2">
                                            <div className="font-medium mb-1">Users</div>
                                            <div className="divide-y divide-gray-200 dark:divide-gray-700 rounded border border-gray-200 dark:border-gray-700">
                                                {(a.members || []).length === 0 && <div className="p-2">None</div>}
                                                {(a.members || []).map((m: any) => (
                                                    <div key={m.userId} className="p-2 flex items-center justify-between">
                                                        <div>{m.email || m.userId}</div>
                                                        <span className={`text-[10px] tracking-wide px-2 py-0.5 rounded ${m.role==='owner' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>{m.role==='owner' ? 'Admin' : 'Manager'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}

                    {/* Agencies retired: hide admin overview */}

                    <div className="mt-6 space-y-2">
                        <h3 className="font-semibold">Email Logs</h3>
                        <AdminEmailLogsPanel />
                    </div>
                </section>
            )}

            {(msg || err) && (
                <div className={`p-3 rounded border text-sm ${msg ? 'border-green-300 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200 dark:border-green-700' : 'border-red-300 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200 dark:border-red-700'}`}>
                    {msg || err}
                </div>
            )}

            {!isAdmin && isOwner && (
                <section className="space-y-3">
                    <h2 className="font-semibold">Company</h2>
                    <div className="space-y-2">
                        <label className="block text-sm">Business name</label>
                        <input value={businessName} onChange={e => setBusinessName(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm">Store domain</label>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">https://</span>
                            <input
                                value={storeUrl}
                                onChange={e => setStoreUrl(normalizeStoreUrl(e.target.value))}
                                onBlur={e => setStoreUrl(normalizeStoreUrl(e.target.value))}
                                placeholder="store.com"
                                className="flex-1 px-3 py-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700"
                            />
                        </div>
                    </div>
                    <button disabled={busy} onClick={onSaveCompany} className="mt-2 inline-flex items-center px-4 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Save</button>
                </section>
            )}

            <section className="space-y-3">
                <h2 className="font-semibold">Email</h2>
                <div className="space-y-2">
                    <label className="block text-sm">Account email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                </div>
                <button disabled={!canChangeEmail} onClick={onChangeEmail} className="mt-2 inline-flex items-center px-4 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Change Email</button>
                <p className="text-xs text-gray-500">You will receive a confirmation link.</p>
                {emailChangeRequested && (
                    <div>
                        <button disabled={busy} onClick={onResendEmailChange} className="mt-2 inline-flex items-center px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-xs hover:bg-gray-50 dark:hover:bg-gray-700">Resend confirmation</button>
                    </div>
                )}
            </section>

            {/* Leave brand (members only) */}
            {!isAdmin && !isOwner && (() => {
                try {
                    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
                    const acc = sp.get('account');
                    if (!acc) return null;
                    return (
                        <section className="space-y-2 border-t pt-6">
                            <h2 className="font-semibold">Management</h2>
                            <button
                                onClick={async () => {
                                    if (!window.confirm('Are you sure you want to leave this brand? You will lose access to its data.')) return;
                                    try {
                                        const res = await fetch('/api/account/members/leave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: acc }) });
                                        const j = await res.json().catch(() => ({}));
                                        if (!res.ok) throw new Error(j?.error || 'Failed');
                                        window.location.assign('/dashboard');
                                    } catch (e: any) { alert(e?.message || 'Failed'); }
                                }}
                                className="inline-flex items-center px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-800 dark:text-gray-200 text-sm"
                            >Leave Brand</button>
                        </section>
                    );
                } catch { return null; }
            })()}

            {/* Integrations section removed (CSV-only) */}

            <section className="space-y-3">
                <h2 className="font-semibold">Password</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                        <label className="block text-sm">New password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm">Confirm password</label>
                        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                    </div>
                </div>
                <button disabled={busy} onClick={onChangePassword} className="mt-2 inline-flex items-center px-4 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Update Password</button>
            </section>

            {!isAdmin && (
                <section className="space-y-3 border-t pt-6">
                    <h2 className="font-semibold text-red-600 flex items-center gap-2">Danger Zone</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Deleting your account is permanent and will remove all uploaded data and snapshots. This cannot be undone.</p>
                    <div className="space-y-2">
                        <label className="block text-xs uppercase tracking-wide font-medium text-gray-500 dark:text-gray-400">Type DELETE to confirm</label>
                        <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700" placeholder="DELETE" />
                    </div>
                    <button
                        disabled={deleting || deleteConfirm !== 'DELETE'}
                        onClick={onDeleteAccount}
                        className="inline-flex items-center px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                    >{deleting ? 'Deleting…' : 'Delete Account'}</button>
                </section>
            )}
        </div>
    );
}

// Lightweight admin panel to list agencies with details
function AdminAgenciesPanel() {
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [agencies, setAgencies] = useState<any[]>([]);
    const [selId, setSelId] = useState<string>('');

    useEffect(() => { (async () => {
        try {
            const res = await fetch('/api/agencies', { cache: 'no-store' });
            const j = await res.json();
            if (!res.ok) throw new Error(j?.error || 'Failed');
            setAgencies(j.agencies || []);
            if ((j.agencies || []).length) setSelId(j.agencies[0].id);
        } catch (e: any) { setErr(e?.message || 'Failed to load agencies'); }
        finally { setLoading(false); }
    })(); }, []);

    if (loading) return <div className="text-xs text-gray-500">Loading…</div>;
    if (err) return <div className="text-xs text-rose-600">{err}</div>;
    if (agencies.length === 0) return <div className="text-xs text-gray-500">No agencies found.</div>;

    const ag = agencies.find(a => a.id === selId) || agencies[0];
    return (
        <div className="text-xs space-y-2">
            <select value={selId} onChange={e => setSelId(e.target.value)} className="h-8 px-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700">
                {agencies.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
            <div className="border rounded p-3 bg-gray-50 dark:bg-gray-800/40 space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                    <div><span className="font-medium">Owner Email:</span> {ag.ownerEmail || '—'}</div>
                    <div><span className="font-medium">Created:</span> {ag.createdAt ? new Date(ag.createdAt).toLocaleString() : '—'}</div>
                    <div><span className="font-medium">Brand Limit:</span> {ag.brandLimit}</div>
                    <div><span className="font-medium">Seat Limit:</span> {ag.seatLimit}</div>
                </div>
                <div>
                    <div className="font-medium mb-1">Linked Brands</div>
                    <div className="divide-y divide-gray-200 dark:divide-gray-700 border rounded">
                        {(ag.brands || []).length === 0 && <div className="p-2">None</div>}
                        {(ag.brands || []).map((b: any) => <div key={b.id} className="p-2">{b.label}</div>)}
                    </div>
                </div>
                <div>
                    <div className="font-medium mb-1">Users</div>
                                        <div className="divide-y divide-gray-200 dark:divide-gray-700 border rounded">
                        {(ag.users || []).length === 0 && <div className="p-2">None</div>}
                        {(ag.users || []).map((u: any) => {
                            const roleLabel = u.role==='owner' ? 'Agency Owner' : u.role==='admin' ? 'Agency Admin' : 'Agency Manager';
                            const roleClass = u.role==='owner'
                                ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700'
                                : u.role==='admin'
                                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700'
                                  : 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700';
                            return (
                              <div key={u.userId} className="p-2 flex items-center justify-between">
                                <div>{u.email || u.userId}</div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${roleClass}`}>{roleLabel}</span>
                                  {!u.allAccounts && <span className="px-2 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700">{(u.brandIds || []).length} brand(s)</span>}
                                </div>
                              </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AdminEmailLogsPanel() {
    const [status, setStatus] = useState<'all' | 'pending' | 'processing' | 'sent' | 'error' | 'dead'>('all');
    const [limit, setLimit] = useState(50);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [rows, setRows] = useState<any[]>([]);

    const load = async () => {
        setLoading(true); setErr(null);
        try {
            const res = await fetch(`/api/notifications/logs?status=${encodeURIComponent(status)}&limit=${limit}`, { cache: 'no-store' });
            const j = await res.json();
            if (!res.ok) throw new Error(j?.error || 'Failed');
            setRows(j.logs || []);
        } catch (e: any) { setErr(e?.message || 'Failed'); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    return (
        <div className="text-xs border rounded p-3 bg-gray-50 dark:bg-gray-800/40">
            <div className="flex flex-wrap items-center gap-2 mb-2">
                <select value={status} onChange={e => setStatus(e.target.value as any)} className="h-7 px-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700">
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="sent">Sent</option>
                    <option value="error">Error</option>
                    <option value="dead">Dead</option>
                </select>
                <select value={limit} onChange={e => setLimit(parseInt(e.target.value, 10))} className="h-7 px-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700">
                    {[25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <button onClick={load} className="h-7 px-3 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700">Refresh</button>
            </div>
            {loading && <div>Loading…</div>}
            {err && <div className="text-rose-600">{err}</div>}
            {!loading && !err && (
                <div className="overflow-auto max-h-[320px]">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-gray-500"><th className="py-1 pr-2">Time</th><th className="py-1 pr-2">Topic</th><th className="py-1 pr-2">Recipient</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Attempts</th><th className="py-1">Last Error</th></tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={r.id || i} className="border-t border-gray-200 dark:border-gray-700">
                                    <td className="py-1 pr-2 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                                    <td className="py-1 pr-2 whitespace-nowrap">{r.topic}</td>
                                    <td className="py-1 pr-2 whitespace-nowrap">{r.recipient_email || r.recipient_user_id || '—'}</td>
                                    <td className="py-1 pr-2 whitespace-nowrap">{String(r.status)}</td>
                                    <td className="py-1 pr-2 whitespace-nowrap">{r.attempts ?? 0}</td>
                                    <td className="py-1 truncate max-w-[380px]" title={r.last_error || ''}>{r.last_error || ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
