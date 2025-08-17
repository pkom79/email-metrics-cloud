"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase/client';

export default function ResetPasswordPage() {
    const router = useRouter();
    const search = useSearchParams();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    // Ensure we have an active session (generated via recovery link)
    useEffect(() => {
        const init = async () => {
            const token_hash = search.get('token_hash');
            const type = search.get('type');
            if (token_hash && type === 'recovery') {
                const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' });
                if (error) setError(error.message);
            }
        };
        init();
    }, [search]);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setOk(null);
        if (!password || password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
            setError(error.message);
            return;
        }
        setOk('Your password has been updated. Redirecting…');
        setTimeout(() => router.replace('/dashboard'), 1200);
    };

    return (
        <div className="max-w-md mx-auto space-y-6">
            <h2 className="text-xl font-semibold">Reset Password</h2>
            <p className="text-sm opacity-80">Enter a new password for your account.</p>
            <form onSubmit={onSubmit} className="space-y-3">
                <input type="password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />
                <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} className="w-full px-3 py-2 rounded border bg-white dark:bg-gray-800" />
                <button type="submit" className="w-full py-2 rounded bg-purple-600 text-white hover:bg-purple-700">Update Password</button>
            </form>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {ok && <p className="text-sm text-green-600">{ok}</p>}
        </div>
    );
}
