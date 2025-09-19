"use client";
import { useEffect, useMemo, useState, Suspense } from 'react';
import { supabase } from '../../../lib/supabase/client';
import { AlertCircle } from 'lucide-react';
import SelectBase from '../../../components/ui/SelectBase';
import { useSearchParams, useRouter } from 'next/navigation';

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
    const qpErrorParam = search.get('error');
    const qpMode = (qpModeParam as 'signin' | 'signup') || 'signup';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [storeUrl, setStoreUrl] = useState('');
    const [country, setCountry] = useState('');
    const [mode, setMode] = useState<'signin' | 'signup'>(qpMode);
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [resendBusy, setResendBusy] = useState(false);
    const [resendMsg, setResendMsg] = useState<string | null>(null);

    useEffect(() => {
        setMode(qpMode);
        if (qpErrorParam) setError(qpErrorParam);
        // dependency array must be stable in size: include only primitive values
    }, [qpMode, qpErrorParam]);

    // Handle hash token redirects like: /signup#access_token=...&refresh_token=...
    useEffect(() => {
        const urlHash = typeof window !== 'undefined' ? window.location.hash : '';
        if (!urlHash || !urlHash.includes('access_token')) return;
        const params = new URLSearchParams(urlHash.replace(/^#/, ''));
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        const type = params.get('type');
        (async () => {
            try {
                if (access_token && refresh_token) {
                    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
                    if (error) throw error;
                    // cleanup hash to avoid re-processing
                    history.replaceState(null, '', window.location.pathname + window.location.search);
                    await new Promise(r => setTimeout(r, 200));
                    router.replace(type === 'signup' ? '/dashboard' : '/dashboard');
                    router.refresh();
                }
            } catch (e) {
                // fall back to signin
            }
        })();
    }, [router]);

    // If already signed in (e.g., from a previous session), redirect to dashboard
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase.auth.getSession();
                if (!cancelled && data?.session) {
                    router.replace('/dashboard');
                }
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [router]);

    useEffect(() => {
        let mounted = true;
        const fetchCountry = async () => {
            try {
                const res = await fetch('/api/geo');
                const data = await res.json();
                const name = data?.country ? ISO_TO_NAME[data.country] : undefined;
                if (mounted && name) setCountry(name);
            } catch { }
        };
        fetchCountry();
        return () => { mounted = false; };
    }, []);

    const isGdprCountry = useMemo(() => GDPR_COUNTRIES.has(country), [country]);

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
            if (mode === 'signup') {
                if (isGdprCountry) return; // guard in UI layer

                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        // Email confirmation disabled - user is immediately authenticated
                        data: { businessName, storeUrl: normalizeStoreUrl(storeUrl), country }
                    }
                });
                if (error) throw error;

                // Klaviyo integration removed (CSV-only ingestion)

                // User is now immediately authenticated! Link uploads using server-side cookie mechanism
                setOk('Account created! Setting up your data...');

                try {
                    const linkResponse = await fetch('/api/auth/link-pending-uploads', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    });

                    if (linkResponse.ok) {
                        const result = await linkResponse.json();
                        console.log('Successfully linked uploads during signup:', result);
                        if (result.processedCount > 0) {
                            setOk(`Account created! Linked ${result.processedCount} upload(s). Redirecting...`);
                        } else {
                            setOk('Account created! Redirecting...');
                        }
                    } else {
                        console.warn('Upload linking failed, but account created successfully');
                        setOk('Account created! Redirecting...');
                    }
                } catch (error) {
                    console.warn('Upload linking error:', error);
                    setOk('Account created! Redirecting...');
                }

                // Clean up localStorage since we've processed the uploads
                localStorage.removeItem('pending-upload-ids');
                localStorage.removeItem('pending-upload-id');

                // Brief delay then redirect to dashboard  
                setTimeout(() => {
                    router.replace('/dashboard');
                }, 2000);
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                if (!data?.session) {
                    setError('Sign in failed. Please verify your credentials or confirm your email.');
                } else {
                    // give cookies a moment to persist before navigating to SSR-protected route
                    await new Promise(r => setTimeout(r, 300));
                    router.replace('/dashboard');
                    router.refresh();
                }
            }
        } catch (e: any) {
            setError(e?.message || 'Failed');
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
        } catch (e: any) {
            setResendMsg(e?.message || 'Failed to resend');
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
            <div className="flex gap-2 text-sm">
                <button className={`px-3 py-1 rounded ${mode === 'signup' ? 'bg-purple-600 text-white' : 'bg-gray-200 dark:bg-gray-800'}`} onClick={() => setMode('signup')}>Sign up</button>
                <button className={`px-3 py-1 rounded ${mode === 'signin' ? 'bg-purple-600 text-white' : 'bg-gray-200 dark:bg-gray-800'}`} onClick={() => setMode('signin')}>Sign in</button>
            </div>
            <form onSubmit={onSubmit} className="space-y-3">
                {mode === 'signup' && (
                    <>
                        {/* Business Name */}
                        <input type="text" placeholder="Business Name" value={businessName} onChange={e => setBusinessName(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />
                        {/* Store URL */}
                        <input type="text" inputMode="url" placeholder="Store URL (e.g. yourstore.com)" value={storeUrl} onChange={e => setStoreUrl(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />
                        {/* Klaviyo API Key removed */}
                        {/* Country dropdown styled like other selects */}
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
                    </>
                )}

                {/* Email / Password */}
                <input type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />
                <input type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />

                {/* GDPR restriction notice (signup only) */}
                {mode === 'signup' && isGdprCountry && (
                    <div className="mt-2 p-3 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 text-amber-900 dark:text-amber-300">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <p className="text-sm">
                                Due to regional data protection requirements, we’re not able to create new accounts in your selected country at this time.
                            </p>
                        </div>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={(mode === 'signup' && isGdprCountry) || submitting}
                    className={`w-full py-2 rounded ${mode === 'signup' && isGdprCountry ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-700'} ${submitting ? 'opacity-70 cursor-wait' : ''}`}
                >
                    {submitting ? 'Please wait…' : (mode === 'signup' ? 'Sign up' : 'Sign in')}
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
