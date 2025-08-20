"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

export default function SupabaseAuthListener() {
    const router = useRouter();
    useEffect(() => {
        let suppress = false;
        // If we're processing a hash-based auth callback on this page load, avoid double-sync
        if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) suppress = true;
        const { data: subscription } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
            try {
                if (!suppress) {
                    await fetch('/api/auth/session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ event, session })
                    });
                }
            } catch { /* ignore */ }
            router.refresh();
            suppress = false;
        });
        return () => {
            try { subscription.subscription.unsubscribe(); } catch { }
        };
    }, [router]);
    return null;
}
