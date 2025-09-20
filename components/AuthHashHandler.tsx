"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

export default function AuthHashHandler() {
  const router = useRouter();
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash || !hash.includes('access_token')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    (async () => {
      try {
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (!error) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
            // Send them to dashboard by default
            router.replace('/dashboard');
          }
        }
      } catch {}
    })();
  }, [router]);
  return null;
}

