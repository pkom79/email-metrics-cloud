"use client";
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

export default function SupabaseAuthListener() {
    const router = useRouter();
    const initialized = useRef(false);
    const lastSyncTime = useRef(0);
    const SYNC_COOLDOWN = 1000; // 1 second between syncs

    useEffect(() => {
        if (initialized.current) return; // Prevent multiple initializations
        initialized.current = true;

        let suppress = false;
        // If we're processing a hash-based auth callback on this page load, avoid double-sync
        if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
            suppress = true;
        }

        let subscription: any = null;
        try {
            const { data: sub } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
                const now = Date.now();
                if (now - lastSyncTime.current < SYNC_COOLDOWN) {
                    console.log('Skipping auth sync due to rate limit');
                    return;
                }

                try {
                    if (!suppress) {
                        lastSyncTime.current = now;
                        await fetch('/api/auth/session', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ event, session })
                        });
                    }
                } catch (error) {
                    console.warn('Auth sync failed:', error);
                }

                router.refresh();
                suppress = false;
            });
            subscription = sub;
        } catch (e) {
            // Supabase env missing; skip listener entirely in this runtime
            console.warn('Supabase auth listener disabled (env missing).');
            return;
        }

        return () => {
            try {
                subscription?.subscription?.unsubscribe?.();
                initialized.current = false;
            } catch (error) {
                console.warn('Failed to unsubscribe auth listener:', error);
            }
        };
    }, [router]);

    return null;
}
