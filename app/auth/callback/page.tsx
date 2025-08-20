"use client";
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
    const router = useRouter();
    const search = useSearchParams();

    useEffect(() => {
        const run = async () => {
            const err = search.get('error_description') || search.get('error');
            if (err) {
                router.replace(`/signup?mode=signin&error=${encodeURIComponent(err)}`);
                return;
            }
            const code = search.get('code');
            const token_hash = search.get('token_hash');
            const type = search.get('type');

            if (code || (token_hash && type)) {
                const qs = new URLSearchParams();
                if (code) qs.set('code', code);
                if (token_hash) qs.set('token_hash', token_hash);
                if (type) qs.set('type', type);
                const res = await fetch(`/api/auth/callback?${qs.toString()}`, { method: 'GET' });
                if (!res.ok) {
                    const { error } = await res.json().catch(() => ({ error: 'Auth failed' }));
                    router.replace(`/signup?mode=signin&error=${encodeURIComponent(error || 'Auth failed')}`);
                    return;
                }
                // Give server a tick to write cookies then go to dashboard
                await new Promise(r => setTimeout(r, 200));
                router.replace('/dashboard');
                return;
            }

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


