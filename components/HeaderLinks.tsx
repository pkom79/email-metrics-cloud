"use client";
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';
import { useEffect, useState } from 'react';

export default function HeaderLinks({ isAuthed }: { isAuthed: boolean }) {
    const pathname = usePathname();
    const router = useRouter();
    const onDashboard = pathname === '/dashboard';
    const onAccount = pathname === '/account';

    const signOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
        router.refresh();
    };

    const [isAdmin, setIsAdmin] = useState(false);
    const [adminAccounts, setAdminAccounts] = useState<{ id: string; name?: string | null; businessName?: string | null }[] | null>(null);
    useEffect(() => {
        (async () => {
            const s = (await supabase.auth.getSession()).data.session; const admin = s?.user?.app_metadata?.role === 'admin'; setIsAdmin(admin); if (admin) {
                try { const r = await fetch('/api/accounts', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); setAdminAccounts(j.accounts || []); } } catch { /* ignore */ }
            }
        })();
    }, []);

    return (
        <div className="flex items-center gap-3">
            {isAuthed ? (
                <>
                    {(!onDashboard) && (
                        <Link href="/dashboard" className="text-sm text-purple-600 dark:text-purple-400">Dashboard</Link>
                    )}
                    {!isAdmin && !onAccount && <Link href="/account" className="text-sm text-gray-600 dark:text-gray-300">Account</Link>}
                    {isAdmin && !onAccount && <Link href="/account" className="text-sm text-gray-600 dark:text-gray-300">Account</Link>}
                    {isAdmin && (
                        <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-purple-600/10 border border-purple-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                            {adminAccounts ? `${adminAccounts.length} accounts` : 'Loading accounts'}
                        </span>
                    )}
                    <button onClick={signOut} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">Sign out</button>
                </>
            ) : (
                <Link href="/signup?mode=signin" className="text-sm text-purple-600 dark:text-purple-400">Sign in</Link>
            )}
        </div>
    );
}
