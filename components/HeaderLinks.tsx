"use client";
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

export default function HeaderLinks({ isAuthed }: { isAuthed: boolean }) {
    const pathname = usePathname();
    const router = useRouter();
    const onDashboard = pathname === '/dashboard';

    const signOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
        router.refresh();
    };

    return (
        <div className="flex items-center gap-3">
            {isAuthed ? (
                <>
                    <Link href="/account" className="text-sm text-gray-600 dark:text-gray-300">Account</Link>
                    {!onDashboard && (
                        <Link href="/dashboard" className="text-sm text-purple-600 dark:text-purple-400">Dashboard</Link>
                    )}
                    <button onClick={signOut} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">Sign out</button>
                </>
            ) : (
                <Link href="/signup?mode=signin" className="text-sm text-purple-600 dark:text-purple-400">Sign in</Link>
            )}
        </div>
    );
}
