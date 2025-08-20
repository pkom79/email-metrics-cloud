"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const check = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                router.replace('/signup?mode=signup');
                return;
            }
            setReady(true);
        };
        check();
    }, [router]);

    if (!ready) return null;
    return <>{children}</>;
}
