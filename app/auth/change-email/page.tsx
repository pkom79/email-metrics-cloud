"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase/client';

export default function ChangeEmailPage() {
    const router = useRouter();
    const search = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        const init = async () => {
            try {
                const token_hash = search.get('token_hash');
                const type = search.get('type');

                if (token_hash && type === 'email_change') {
                    const { data, error } = await supabase.auth.verifyOtp({
                        token_hash,
                        type: 'email_change'
                    });

                    if (error) {
                        console.error('Email change verification error:', error);
                        setError(`Failed to verify email change: ${error.message}`);
                    } else if (data?.user) {
                        // Refresh the session to get updated user data
                        const { error: refreshError } = await supabase.auth.refreshSession();
                        if (refreshError) {
                            console.warn('Session refresh warning:', refreshError);
                        }
                        setSuccess(true);
                        setTimeout(() => router.replace('/account'), 2000);
                    } else {
                        setError('Email verification succeeded but user data is missing');
                    }
                } else {
                    setError('Invalid or missing verification parameters');
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
