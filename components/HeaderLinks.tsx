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
    const onReportGuide = pathname === '/report-export-guide';

    const signOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
        router.refresh();
    };

    const [isAdmin, setIsAdmin] = useState(false);
    useEffect(() => { (async () => { const s = (await supabase.auth.getSession()).data.session; setIsAdmin(s?.user?.app_metadata?.role === 'admin'); })(); }, []);

    return (
        <div className="flex items-center gap-3">
            {isAuthed ? (
                <>
                    {(!onDashboard) && (
                        <Link href="/dashboard" className="text-sm text-purple-600 dark:text-purple-400">Dashboard</Link>
                    )}
                    {!onAccount && (
                        <Link href="/account" className="text-sm text-purple-600 dark:text-purple-400">Account</Link>
                    )}
                    {!onReportGuide && (
                        <Link href="/report-export-guide" className="text-sm text-purple-600 dark:text-purple-400">Report Export Guide</Link>
                    )}
                    <button onClick={signOut} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">Sign out</button>
                </>
            ) : (
                <>
                    {!onReportGuide && (
                        <Link href="/report-export-guide" className="text-sm text-purple-600 dark:text-purple-400">Report Export Guide</Link>
                    )}
                    <Link href="/signup?mode=signin" className="text-sm text-purple-600 dark:text-purple-400">Sign in</Link>
                </>
            )}
        </div>
    );
}
