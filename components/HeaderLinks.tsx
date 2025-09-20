"use client";
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../lib/supabase/client';
import { useAuth } from './AuthProvider';

export default function HeaderLinks({ isAuthed }: { isAuthed: boolean }) {
    const pathname = usePathname();
    const router = useRouter();
    const { isAdmin } = useAuth();
    const [signingOut, setSigningOut] = useState(false);
    const onDashboard = pathname?.startsWith('/dashboard');
    const onAccount = pathname?.startsWith('/account');
    const sp = useSearchParams();
    const accountId = sp?.get('account') || '';

    const signOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            await supabase.auth.signOut();
        } catch (error) {
            console.error('Sign out error:', error);
        } finally {
            setSigningOut(false);
        }
        router.replace('/');
        router.refresh();
    };

    return (
        <div className="flex items-center gap-3">
            {isAuthed ? (
                <>
                    {(!onDashboard) && (
                        <Link href="/dashboard" className="text-sm text-purple-600 dark:text-purple-400">Dashboard</Link>
                    )}
                    {!onAccount && (
                        <Link href={`/account${accountId ? `?account=${accountId}` : ''}`} className="text-sm text-purple-600 dark:text-purple-400">Account</Link>
                    )}
                    <button onClick={signOut} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">Sign out</button>
                </>
            ) : (
                <>
                    <Link href="/signup?mode=signin" className="text-sm text-purple-600 dark:text-purple-400">Sign in</Link>
                </>
            )}
        </div>
    );
}
