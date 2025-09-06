"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { session, loading } = useAuth();

    useEffect(() => {
        if (loading) return; // Wait for auth check to complete

        if (!session) {
            router.replace('/signup?mode=signup');
        }
    }, [session, loading, router]);

    if (loading) return null; // Show nothing while loading
    if (!session) return null; // Show nothing while redirecting

    return <>{children}</>;
}
