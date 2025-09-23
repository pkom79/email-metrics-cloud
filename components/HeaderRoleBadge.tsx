"use client";
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

export default function HeaderRoleBadge() {
  const sp = useSearchParams();
  const [badge, setBadge] = useState<{ label: string; className: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) { setBadge(null); return; }
        const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
        if (isAdmin) { if (!cancelled) setBadge({ label: 'Global Admin', className: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-700' }); return; }
        const acc = sp?.get('account');
        if (!acc) { if (!cancelled) setBadge(null); return; }
        try {
          const res = await fetch(`/api/account/my-role?accountId=${encodeURIComponent(acc)}`, { cache: 'no-store' });
          const j = await res.json().catch(() => ({}));
          const role = j?.role as string | null;
          if (cancelled) return;
          if (role === 'owner') {
            setBadge({ label: 'Admin', className: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800' });
          } else if (role === 'manager') {
            setBadge({ label: 'Manager', className: 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700' });
          } else {
            setBadge(null);
          }
        } catch {
          if (!cancelled) setBadge(null);
        }
      } catch { setBadge(null); }
    })();
    return () => { cancelled = true; };
  }, [sp]);

  if (!badge) return null;
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold tracking-wide ${badge.className}`}>{badge.label}</span>
  );
}
