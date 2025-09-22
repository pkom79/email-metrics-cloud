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
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) { setBadge(null); return; }
        const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
        if (isAdmin) { if (!cancelled) setBadge({ label: 'Global Admin', className: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-700' }); return; }
        const isAgency = (user.user_metadata as any)?.signup_type === 'agency';
        if (isAgency) {
          // Resolve specific agency role (owner/admin/member). Prefer highest privilege if multiple.
          try {
            const { data: aus } = await supabase
              .from('agency_users')
              .select('role, agencies(owner_user_id)')
              .eq('user_id', user.id);
            const roles: string[] = [];
            for (const r of (aus || []) as any[]) {
              if (r?.agencies?.owner_user_id === user.id) roles.push('owner');
              else roles.push(r?.role || 'member');
            }
            const role = roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : 'member';
            const palette = role === 'owner'
              ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700'
              : role === 'admin'
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700'
                : 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700';
            const label = role === 'owner' ? 'Agency Owner' : role === 'admin' ? 'Agency Admin' : 'Agency Member';
            if (!cancelled) setBadge({ label, className: palette });
            return;
          } catch {
            if (!cancelled) setBadge({ label: 'Agency', className: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700' });
            return;
          }
        }
        const acc = sp?.get('account');
        let isOwner = false;
        try {
          const url = acc ? `/api/account/is-owner?accountId=${encodeURIComponent(acc)}` : '/api/account/is-owner';
          const res = await fetch(url, { cache: 'no-store' });
          const j = await res.json().catch(() => ({}));
          isOwner = acc ? Boolean(j?.isOwnerOf) : Boolean(j?.isOwnerAny);
        } catch {}
        if (isOwner) {
          if (!cancelled) setBadge({ label: 'Admin', className: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800' });
        } else {
          if (!cancelled) setBadge({ label: 'Manager', className: 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700' });
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
