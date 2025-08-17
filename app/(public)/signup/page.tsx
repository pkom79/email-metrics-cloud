"use client";
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase/client';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Norway', 'Denmark', 'Ireland', 'New Zealand', 'Mexico', 'Brazil', 'Japan', 'Singapore', 'India'];
const ISO_TO_NAME: Record<string, string> = {
    US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', DE: 'Germany', FR: 'France', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', IE: 'Ireland', NZ: 'New Zealand', MX: 'Mexico', BR: 'Brazil', JP: 'Japan', SG: 'Singapore', IN: 'India'
};
// GDPR/EEA/UK list based on options above
const GDPR_COUNTRIES = new Set(['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Norway', 'Denmark', 'Ireland']);

export default function Signup() {
    const search = useSearchParams();
    const qpMode = (search.get('mode') as 'signin' | 'signup') || 'signup';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [storeUrl, setStoreUrl] = useState('');
    const [country, setCountry] = useState('');
    const [mode, setMode] = useState<'signin' | 'signup'>(qpMode);
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    useEffect(() => {
        setMode(qpMode);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qpMode]);

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
        if (!/^https?:\/\//i.test(v)) {
            v = `https://${v}`;
        }
        try {
            const url = new URL(v);
            // If user entered just domain, keep as https://domain
            return `${url.protocol}//${url.hostname}${url.pathname !== '/' ? url.pathname : ''}`;
        } catch {
            return v; // let backend validation handle truly invalid URLs
        }
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setOk(null);
        try {
            if (mode === 'signup') {
                if (isGdprCountry) return; // guard in UI layer
                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${origin}/auth/callback`,
                        data: { businessName, storeUrl: normalizeStoreUrl(storeUrl), country }
                    }
                });
                if (error) throw error;
                setOk('Check your email to confirm your account.');
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                window.location.href = '/dashboard';
            }
        } catch (e: any) {
            setError(e?.message || 'Failed');
        }
    };

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
                        <input type="url" placeholder="Store URL" value={storeUrl} onChange={e => setStoreUrl(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />
                        {/* Country dropdown styled like other selects */}
                        <div className="relative">
                            <select
                                value={country}
                                onChange={e => setCountry(e.target.value)}
                                className="appearance-none w-full px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            >
                                <option value="">Select Country</option>
                                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
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
                    disabled={mode === 'signup' && isGdprCountry}
                    className={`w-full py-2 rounded ${mode === 'signup' && isGdprCountry ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                >
                    {mode === 'signup' ? 'Sign up' : 'Sign in'}
                </button>
            </form>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {ok && <p className="text-sm text-green-600">{ok}</p>}
        </div>
    );
}
