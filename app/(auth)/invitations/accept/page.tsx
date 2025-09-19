"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabase/client';

export default function AcceptInvitationPage() {
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const t = sp?.get('token');
    if (t && !token) setToken(t);
  }, [sp, token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null); setBusy(true);
    try {
      // require login to bind membership
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) {
        setErr('Please sign in with the invited email, then try again.');
        setBusy(false); return;
      }
      const res = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Failed');
      setMsg('Invitation accepted');
      setTimeout(() => router.replace('/dashboard'), 800);
    } catch (e: any) { setErr(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Accept Invitation</h1>
      <form onSubmit={onSubmit} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
        <input value={token} onChange={e => setToken(e.target.value)} placeholder="Paste token" className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        <button disabled={busy || !token} className="h-10 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Accept</button>
        <div className="text-xs text-gray-500">Tip: If you aren’t signed in, sign in with the invited email first, then accept.</div>
      </form>
    </div>
  );
}
