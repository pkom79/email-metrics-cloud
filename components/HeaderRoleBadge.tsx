"use client";
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';

export default function HeaderRoleBadge() {
  const [badge, setBadge] = useState<{ label: string; className: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) { setBadge(null); return; }
        const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
        if (isAdmin) {
          if (!cancelled) setBadge({ label: 'Global Admin', className: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-700' });
        } else if (!cancelled) {
          setBadge(null);
        }
      } catch { setBadge(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!badge) return null;
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold tracking-wide ${badge.className}`}>{badge.label}</span>
  );
}
