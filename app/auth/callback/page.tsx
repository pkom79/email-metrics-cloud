"use client";
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase/client';

export default function AuthCallback() {
    const router = useRouter();
    const search = useSearchParams();

    useEffect(() => {
        const run = async () => {
            const error = search.get('error_description') || search.get('error');
            if (error) {
                console.error('Auth error:', error);
                router.replace(`/signup?mode=signin&error=${encodeURIComponent(error)}`);
                return;
            }

            const code = search.get('code');
            const token_hash = search.get('token_hash');
            const type = search.get('type');

            if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession({ code });
                if (error) {
                    console.error('Exchange code error:', error);
                    router.replace(`/signup?mode=signin&error=${encodeURIComponent(error.message)}`);
                    return;
                }
                router.replace('/dashboard');
                return;
            }

            if (token_hash && type) {
                const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as any });
                if (error) {
                    console.error('Verify OTP error:', error);
                    router.replace(`/signup?mode=signin&error=${encodeURIComponent(error.message)}`);
                    return;
                }
                router.replace('/dashboard');
                return;
            }

            // Fallback: if already authenticated
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    router.replace('/dashboard');
                    return;
                }
            } catch { /* ignore */ }

            router.replace('/signup?mode=signin');
        };

        run();
    }, [router, search]);

    return (
        <div className="max-w-md mx-auto py-20 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Signing you in…</p>
        </div>
    );
}
