"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase/client';

export default function ChangeEmailPage() {
    const router = useRouter();
    const search = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const init = async () => {
            const token_hash = search.get('token_hash');
            const type = search.get('type');
            if (token_hash && type === 'email_change') {
                const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'email_change' });
                if (error) {
                    setError(error.message);
                } else {
                    router.replace('/dashboard');
                }
            }
        };
        init();
    }, [router, search]);

    return (
        <div className="max-w-md mx-auto py-20 text-center">
            {error ? (
                <p className="text-sm text-red-500">{error}</p>
            ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">Updating your email…</p>
            )}
        </div>
    );
}
