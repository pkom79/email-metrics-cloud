"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabase/client';

export default function AcceptInvitationPage() {
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const t = sp?.get('token');
    if (t && !token) setToken(t);
  }, [sp, token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null); setBusy(true);
    try {
      // Ensure the user is authenticated (create account or sign in inline if needed)
      let { data: u } = await supabase.auth.getUser();
      if (!u?.user) {
        if (!email || !password) {
          setErr('Enter your email and password to continue.');
          setBusy(false); return;
        }
        if (authMode === 'signup') {
          const { error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        // refresh
        u = (await supabase.auth.getUser()).data;
        if (!u?.user) {
          setErr('Authentication failed.'); setBusy(false); return;
        }
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
        {/* Inline auth if needed */}
        <div className="space-y-2">
          <div className="inline-flex rounded border border-gray-300 dark:border-gray-700 overflow-hidden text-sm">
            <button type="button" onClick={() => setAuthMode('signup')} className={`px-3 py-1.5 ${authMode==='signup' ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}>Create account</button>
            <button type="button" onClick={() => setAuthMode('signin')} className={`px-3 py-1.5 border-l border-gray-300 dark:border-gray-700 ${authMode==='signin' ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}>Sign in</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email" className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
          </div>
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        <button disabled={busy || !token} className="h-10 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Accept</button>
        <div className="text-xs text-gray-500">Tip: If you don’t have an account, choose Create account. Business details are not required for invites.</div>
      </form>
    </div>
  );
}
