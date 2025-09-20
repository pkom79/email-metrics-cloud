"use client";
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase/client';

function ChangeEmailInner() {
    const router = useRouter();
    const search = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        const init = async () => {
            try {
                // Handle both hash-based and token_hash-based redirects
                const hash = typeof window !== 'undefined' ? window.location.hash : '';
                let token_hash = search.get('token_hash');
                let type = search.get('type');

                if (hash && hash.includes('access_token')) {
                    const params = new URLSearchParams(hash.replace(/^#/, ''));
                    const access_token = params.get('access_token');
                    const refresh_token = params.get('refresh_token');
                    const hType = params.get('type');
                    if (access_token && refresh_token && hType === 'email_change') {
                        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
                        if (error) {
                            setError(`Failed to apply email change: ${error.message}`);
                        } else {
                            setSuccess(true);
                            history.replaceState(null, '', window.location.pathname + window.location.search);
                            setTimeout(() => router.replace('/account'), 1500);
                        }
                        return;
                    }
                }

                // Fallback: verify token_hash (legacy)
                const tokenHash = token_hash || undefined;
                if (tokenHash && (type === 'email_change' || !type)) {
                    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email_change' as any });
                    if (error) {
                        setError(`Failed to verify email change: ${error.message}`);
                    } else if (data?.user) {
                        setSuccess(true);
                        setTimeout(() => router.replace('/account'), 1500);
                    } else {
                        setError('Email verification succeeded but user data is missing');
                    }
                } else {
                    setError('Invalid or expired link');
                }
            } catch (err: any) {
                console.error('Email change error:', err);
                setError(`Unexpected error: ${err.message}`);
            } finally {
                setLoading(false);
            }
        };

        init();
    }, [router, search]);

    return (
        <div className="max-w-md mx-auto py-20 text-center">
            {loading ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Updating your email…</p>
            ) : success ? (
                <div>
                    <p className="text-sm text-green-600 mb-4">Email updated successfully!</p>
                    <p className="text-xs text-gray-500">Redirecting to account settings...</p>
                </div>
            ) : error ? (
                <div>
                    <p className="text-sm text-red-500 mb-4">{error}</p>
                    <button
                        onClick={() => router.replace('/account')}
                        className="text-sm text-blue-600 hover:text-blue-800 underline"
                    >
                        Return to Account Settings
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export default function ChangeEmailPage() {
    return (
        <Suspense fallback={<div />}>
            <ChangeEmailInner />
        </Suspense>
    );
}
