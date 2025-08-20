"use client";
import React, { useState } from 'react';
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

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <h1 className="text-2xl font-bold">Account</h1>

            {(msg || err) && (
                <div className={`p-3 rounded border text-sm ${msg ? 'border-green-300 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200 dark:border-green-700' : 'border-red-300 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200 dark:border-red-700'}`}>
                    {msg || err}
                </div>
            )}

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
        </div>
    );
}
