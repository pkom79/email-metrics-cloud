"use client";
import { useEffect, useMemo, useState, useRef, Suspense, useCallback } from 'react';
import { supabase } from '../../../lib/supabase/client';
import { AlertCircle } from 'lucide-react';
import SelectBase from '../../../components/ui/SelectBase';
import { useSearchParams, useRouter } from 'next/navigation';
import { isDiagEnabled, recordDiag } from '../../../lib/utils/diag';

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Norway', 'Denmark', 'Ireland', 'New Zealand', 'Mexico', 'Brazil', 'Japan', 'Singapore', 'India'];
const ISO_TO_NAME: Record<string, string> = {
    US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', DE: 'Germany', FR: 'France', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', IE: 'Ireland', NZ: 'New Zealand', MX: 'Mexico', BR: 'Brazil', JP: 'Japan', SG: 'Singapore', IN: 'India'
};
// GDPR/EEA/UK list based on options above
const GDPR_COUNTRIES = new Set(['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Norway', 'Denmark', 'Ireland']);

function SignupInner() {
    const search = useSearchParams();
    const router = useRouter();
    const qpModeParam = search.get('mode');
    // Agencies retired: force brand
    const qpTypeParam = 'brand';
    const qpErrorParam = search.get('error');
    const qpMode = (qpModeParam as 'signin' | 'signup') || 'signup';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [storeUrl, setStoreUrl] = useState('');
    const [country, setCountry] = useState('');
    const [mode, setMode] = useState<'signin' | 'signup'>(qpMode);
    const [accountType, setAccountType] = useState<'brand' | 'agency'>('brand');
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [resendBusy, setResendBusy] = useState(false);
    const [resendMsg, setResendMsg] = useState<string | null>(null);
    const diagEnabled = isDiagEnabled();
    const diag = useCallback((message: string, data?: any) => {
        if (diagEnabled) recordDiag('signup', message, data);
    }, [diagEnabled]);
    useEffect(() => {
        diag('render', { mode: qpMode });
    }, [diag, qpMode]);

    useEffect(() => {
        setMode(qpMode);
        if (qpErrorParam) setError(qpErrorParam);
        // dependency array must be stable in size: include only primitive values
    }, [qpMode, qpErrorParam]);

    // Handle hash token redirects like: /signup#access_token=...&refresh_token=...
    const hasNavigatedRef = useRef(false);
    const processedHashRef = useRef(false);

    useEffect(() => {
        const urlHash = typeof window !== 'undefined' ? window.location.hash : '';
        if (!urlHash || !urlHash.includes('access_token')) return;
        const params = new URLSearchParams(urlHash.replace(/^#/, ''));
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        const type = params.get('type');
        diag('hash-detected', { type, hasAccess: Boolean(access_token), hasRefresh: Boolean(refresh_token) });
        (async () => {
            try {
                if (access_token && refresh_token) {
                    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
                    if (error) throw error;
                    // cleanup hash to avoid re-processing
                    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
                    processedHashRef.current = true;
                    diag('session-from-hash', { type });
                    if (!hasNavigatedRef.current) {
                        hasNavigatedRef.current = true;
                        // Hard navigation avoids double-renders and throttled replaceState loops
                        diag('navigate-dashboard', { reason: 'hash-auth' });
                        window.location.assign('/dashboard');
                    }
                }
            } catch (e) {
                // fall back to signin
                diag('hash-session-error', { error: (e as any)?.message });
            }
        })();
    }, [diag, router]);

    // If already signed in (e.g., from a previous session), redirect to dashboard
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const existingSession = data?.session;
                if (!existingSession || processedHashRef.current || hasNavigatedRef.current) return;

                const serverCheck = await fetch('/api/account/is-owner', { cache: 'no-store', credentials: 'include' });
                if (serverCheck.status === 401) {
                    diag('existing-session-invalid');
                    await supabase.auth.signOut();
                    return;
                }
                if (!serverCheck.ok) return;
                if (cancelled) return;
                diag('existing-session', { userId: existingSession.user?.id });
                hasNavigatedRef.current = true;
                router.replace('/dashboard');
            } catch (err) {
                if (!cancelled) diag('existing-session-error', { error: (err as any)?.message });
            }
        })();
        return () => { cancelled = true; };
    }, [diag, router]);

    useEffect(() => {
        let mounted = true;
        const controller = new AbortController();
        const fetchCountry = async () => {
            try {
                // Debounce + abort-safe to avoid spamming on flaky networks
                await new Promise(r => setTimeout(r, 300));
                const res = await fetch('/api/geo', { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json();
                const name = data?.country ? ISO_TO_NAME[data.country] : undefined;
                if (mounted && name) setCountry(name);
            } catch { /* ignore */ }
        };
        if (!country) fetchCountry();
        return () => { mounted = false; controller.abort(); };
    }, [country]);

    const isGdprCountry = useMemo(() => GDPR_COUNTRIES.has(country), [country]); // informational only, no blocking

    const normalizeStoreUrl = (value: string) => {
        if (!value) return '';
        let v = value.trim();
        // Strip protocol, www, and trailing slashes; store bare domain
        v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
        return v.toLowerCase();
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setOk(null);
        setResendMsg(null);
        setSubmitting(true);
        try {
            diag('submit', { mode });
            if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        // Email confirmation disabled - user is immediately authenticated
                        data: { businessName, storeUrl: normalizeStoreUrl(storeUrl), country }
                    }
                });
                if (error) {
                    diag('signup-error', { message: error.message, status: error.status });
                    throw error;
                }

                let session = data.session || null;
                if (session) {
                    diag('signup-session', { userId: session.user?.id });
                    try {
                        await fetch('/api/auth/session', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ event: 'SIGNED_IN', session })
                        });
                    } catch (syncErr) {
                        console.warn('Failed to sync session after signup:', syncErr);
                    }
                }

                if (!session) {
                    for (let i = 0; i < 10; i++) {
                        const { data: { session: polled } } = await supabase.auth.getSession();
                        if (polled) { session = polled; break; }
                        await new Promise(r => setTimeout(r, 200));
                    }
                }

                if (!session) {
                    setOk('Account created! Please sign in again to finish linking your data.');
                    diag('signup-no-session');
                } else {
                    setOk('Account created! Setting up your data...');
                    diag('signup-session-ready', { userId: session.user?.id });
                    try {
                        const linkResponse = await fetch('/api/auth/link-pending-uploads', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({})
                        });

                        if (linkResponse.ok) {
                            const result = await linkResponse.json();
                            console.log('Successfully linked uploads during signup:', result);
                            diag('pending-link-success', result);
                            if (result.processedCount > 0) {
                                setOk(`Account created! Linked ${result.processedCount} upload(s). Redirecting...`);
                            } else {
                                setOk('Account created! Redirecting...');
                            }
                        } else {
                            console.warn('Upload linking failed, but account created successfully');
                            setOk('Account created! Redirecting...');
                            diag('pending-link-failed', { status: linkResponse.status });
                        }
                    } catch (linkErr) {
                        console.warn('Upload linking error:', linkErr);
                        setOk('Account created! Redirecting...');
                        diag('pending-link-error', { error: (linkErr as any)?.message });
                    }
                }

                localStorage.removeItem('pending-upload-ids');
                localStorage.removeItem('pending-upload-id');

                setTimeout(() => { window.location.assign('/dashboard'); }, 800);
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    diag('signin-error', { message: error.message, status: error.status });
                    throw error;
                }
                let session = data?.session ?? null;
                if (!session) {
                    const { data: refreshed } = await supabase.auth.getSession();
                    session = refreshed.session ?? null;
                }
                if (!session) {
                    setError('Sign in failed. Please verify your credentials or confirm your email.');
                } else {
                    try {
                        await fetch('/api/auth/session', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ event: 'SIGNED_IN', session }),
                        });
                    } catch {}
                    diag('signin-success', { userId: session.user?.id });
                    setTimeout(() => { window.location.assign('/dashboard'); }, 250);
                }
            }
        } catch (e: any) {
            setError(e?.message || 'Failed');
            diag('submit-error', { message: e?.message });
        } finally {
            setSubmitting(false);
        }
    };

    const onResend = async () => {
        if (!email) return;
        setResendBusy(true); setResendMsg(null);
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const { error } = await (supabase as any).auth.resend({
                type: 'signup',
                email,
                options: { emailRedirectTo: `${origin}/auth/callback` }
            });
            if (error) throw error;
            setResendMsg('Confirmation email resent. Check your inbox and spam folder.');
            diag('resend-success');
        } catch (e: any) {
            setResendMsg(e?.message || 'Failed to resend');
            diag('resend-error', { message: e?.message });
        } finally { setResendBusy(false); }
    };

    // Forgot password moved to dedicated page `/auth/forgot-password`.

    return (
        <div className="max-w-md mx-auto space-y-6">
            <h2 className="text-xl font-semibold">{mode === 'signup' ? 'Create Account' : 'Sign in'}</h2>
            <p className="text-sm opacity-80">
                {mode === 'signup'
                    ? 'Create your account to access your email metrics analysis.'
                    : 'Sign in to access your dashboard.'}
            </p>
            <div className="inline-flex rounded border border-gray-300 dark:border-gray-700 overflow-hidden text-sm">
                <button type="button" className={`px-3 py-1.5 ${mode === 'signup' ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`} onClick={() => setMode('signup')}>Sign up</button>
                <button type="button" className={`px-3 py-1.5 border-l border-gray-300 dark:border-gray-700 ${mode === 'signin' ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`} onClick={() => setMode('signin')}>Sign in</button>
            </div>
            {/* Account type selection removed (agencies retired) */}
            <form onSubmit={onSubmit} className="space-y-4">
                {mode === 'signup' && (
                    <>
                        {
                            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
                                <div className="space-y-1">
                                    <label className="text-sm text-gray-700 dark:text-gray-300">Business name</label>
                                    <input
                                        type="text"
                                        value={businessName}
                                        onChange={e => setBusinessName(e.target.value)}
                                        className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm text-gray-700 dark:text-gray-300">Store URL</label>
                                    <input
                                        type="text"
                                        inputMode="url"
                                       placeholder="e.g. yourstore.com"
                                        value={storeUrl}
                                        onChange={e => setStoreUrl(e.target.value)}
                                        className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm text-gray-700 dark:text-gray-300">Country</label>
                                    <div className="relative">
                                        <SelectBase
                                            value={country}
                                            onChange={e => setCountry((e.target as HTMLSelectElement).value)}
                                            className="w-full px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                        >
                                            <option value="">Select Country</option>
                                            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </SelectBase>
                                    </div>
                                </div>
                            </div>
                        }
                    </>
                )}

                {/* Email / Password */}
                <input
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <input
                    type="password"
                    autoComplete={mode==='signup' ? 'new-password' : 'current-password'}
                    required
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />

                {/* GDPR restriction notice (signup only) */}
                {/* GDPR notices removed (we’re compliant). Country is optional. */}

                <button
                    type="submit"
                    disabled={(mode === 'signup' && isGdprCountry) || submitting}
                    className={`w-full py-2 rounded ${'bg-purple-600 text-white hover:bg-purple-700'} ${submitting ? 'opacity-70 cursor-wait' : ''}`}
                >
                    {submitting ? 'Please wait…' : (mode === 'signup' ? 'Create account' : 'Sign in')}
                </button>
            </form>
            {mode === 'signin' && (
                <div className="flex justify-end -mt-2">
                    <a
                        href="/auth/forgot-password"
                        className="text-xs underline text-purple-600 hover:text-purple-700"
                    >
                        Forgot password?
                    </a>
                </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            {error === 'email rate limit exceeded' && (
                <div className="space-y-2">
                    <button
                        type="button"
                        disabled={resendBusy || !email}
                        onClick={onResend}
                        className={`text-sm underline ${resendBusy ? 'opacity-60' : 'text-purple-600 hover:text-purple-700'}`}
                    >{resendBusy ? 'Resending…' : 'Resend confirmation email'}</button>
                    {resendMsg && <p className="text-xs text-gray-600 dark:text-gray-300">{resendMsg}</p>}
                </div>
            )}
            {ok && <p className="text-sm text-green-600">{ok}</p>}
        </div>
    );
}

export default function Signup() {
    return (
        <Suspense fallback={<div />}>
            <SignupInner />
        </Suspense>
    );
}
