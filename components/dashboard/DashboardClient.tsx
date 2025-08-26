"use client";
import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';

// Dynamically import the heavy desktop dashboard only when needed
const DashboardHeavy = dynamic(() => import('./DashboardHeavy'), {
    ssr: false, loading: () => (
        <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500 dark:text-gray-400 text-sm">Loading dashboard…</div></div>
    )
});

interface Props { businessName?: string; userId?: string }

export default function DashboardClient({ businessName, userId }: Props) {
    // Instant mobile detection (runs in constructor on client-side hydration)
    const [isMobile, setIsMobile] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false; // assume desktop during SSR
        const ua = navigator.userAgent;
        return window.innerWidth < 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    });

    // Allow force desktop override for debugging via localStorage or query param
    const [forceDesktop, setForceDesktop] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        try { return localStorage.getItem('EM_FORCE_DESKTOP') === '1'; } catch { return false; }
    });

    useEffect(() => {
        const update = () => {
            const ua = navigator.userAgent;
            const mobileNow = window.innerWidth < 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
            setIsMobile(prev => prev === mobileNow ? prev : mobileNow);
        };
        window.addEventListener('resize', update, { passive: true });
        update();
        // Query param override (?forceDesktop=1)
        try {
            const usp = new URLSearchParams(window.location.search);
            if (usp.get('forceDesktop') === '1') {
                localStorage.setItem('EM_FORCE_DESKTOP', '1');
                setForceDesktop(true);
            }
        } catch { }
        return () => window.removeEventListener('resize', update);
    }, []);

    useEffect(() => {
        // Debug URL parameters for auth callback issues
        try {
            const params = new URLSearchParams(window.location.search);
            const linkError = params.get('link_error');
            const status = params.get('status');

            if (linkError) {
                console.error('Auth callback link error detected:', { linkError, status });
                // Show a temporary alert for debugging
                const message = linkError === '1'
                    ? `Failed to link uploads (HTTP ${status || 'unknown'})`
                    : 'Error during upload linking process';

                // Display error in UI temporarily
                setTimeout(() => {
                    if (confirm(`DEBUG: ${message}\n\nThis means your uploaded files weren't linked to your account during email confirmation. Would you like to see the console logs?`)) {
                        console.log('Check the server logs for "link-pending-uploads" messages to debug further.');
                    }
                    // Clean up URL after showing error
                    const url = new URL(window.location.href);
                    url.searchParams.delete('link_error');
                    url.searchParams.delete('status');
                    window.history.replaceState({}, '', url.toString());
                }, 1000);
            }
        } catch (error) {
            console.error('Error checking URL params:', error);
        }
    }, []);

    const mobileNotice = useMemo(() => (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            <main className="flex-1 flex items-start justify-center p-6">
                <div className="max-w-xl w-full mx-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="relative w-10 h-10">
                            <Image alt="Brand" src="/brand/logo-email.png" fill className="object-contain" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Desktop Experience Required</h2>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                        <span className="font-semibold">This application performs advanced in‑browser data processing and multi‑dimensional performance modeling across large email datasets.</span>
                        <br />
                        <br />
                        For the full experience: Please access from a desktop, laptop, or high-end tablet (iPad Pro or similar) with 8GB+ RAM, modern processor (Intel i5, AMD Ryzen 5, Apple M1 or better), and screen width of at least 768px. Chrome/Safari recommended.
                    </p>
                </div>
            </main>
        </div>
    ), []);

    if (isMobile && !forceDesktop) return mobileNotice;
    return <DashboardHeavy businessName={businessName} userId={userId} />;
}
