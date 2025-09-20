"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabase/client';

export default function AcceptInvitationPage() {
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [inv, setInv] = useState<{ email: string; brand: string; status: string; expiresAt?: string; userExists?: boolean; accountId?: string } | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    (async () => {
      const t = sp?.get('token');
      if (t && !token) setToken(t);
      if (!t) return;
      // Load invitation info
      try {
        const res = await fetch(`/api/invitations/info?token=${encodeURIComponent(t)}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || 'Invalid or expired invitation');
        setInv(j);
      } catch (e: any) {
        setErr(e?.message || 'Invalid or expired invitation');
      }
      // Get current session email (if any)
      try {
        const u = await supabase.auth.getUser();
        const email = u.data.user?.email || null;
        setAuthedEmail(email);
      } catch {}
    })();
  }, [sp, token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null); setBusy(true);
    try {
      if (!token) throw new Error('Missing token');
      if (!inv) throw new Error('Invitation not loaded');
      const invitedEmail = inv.email;

      // Determine auth state
      let { data: u } = await supabase.auth.getUser();
      const authed = !!u?.user;
      const matches = authed && String(u?.user?.email || '').trim().toLowerCase() === invitedEmail.trim().toLowerCase();

      if (!matches) {
        // If different user is signed in, block and ask them to sign out
        if (authed && u?.user?.email && u.user.email !== invitedEmail) {
          throw new Error(`Signed in as ${u.user.email}. Please sign out and continue as ${invitedEmail}.`);
        }
        // Not signed in: sign in or sign up using invited email
        if (!password) { setErr('Enter a password to continue.'); setBusy(false); return; }
        if (inv.userExists) {
          const { error } = await supabase.auth.signInWithPassword({ email: invitedEmail, password });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signUp({ email: invitedEmail, password });
          if (error) throw error;
        }
        // refresh session
        u = (await supabase.auth.getUser()).data;
        if (!u?.user) { setErr('Authentication failed.'); setBusy(false); return; }
      }
      const res = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Failed');
      setMsg('Invitation accepted');
      const target = j?.accountId ? `/dashboard?account=${j.accountId}` : '/dashboard';
      setTimeout(() => { window.location.assign(target); }, 600);
    } catch (e: any) { setErr(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Accept Invitation</h1>
      <form onSubmit={onSubmit} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
        {!token && <div className="text-sm text-rose-600">Missing invitation token.</div>}
        {inv && (
          <div className="space-y-1">
            <div className="text-sm text-gray-700 dark:text-gray-300">You’re invited to join <span className="font-medium">{inv.brand}</span></div>
            <div className="text-xs text-gray-500">Email: {inv.email}</div>
          </div>
        )}

        {/* If different user is signed in, surface a hint */}
        {authedEmail && inv && authedEmail !== inv.email && (
          <div className="text-xs text-amber-600">Currently signed in as {authedEmail}. Please sign out and continue as {inv.email}.</div>
        )}

        {/* Ask only for password when needed; email is taken from the invitation */}
        {inv && (!authedEmail || authedEmail !== inv.email) && (
          <div className="space-y-2">
            <label className="block text-xs text-gray-500">Set or enter password for {inv.email}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        <button disabled={busy || !token} className="h-10 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Accept</button>
        <div className="text-xs text-gray-500">You won’t need the token or email; just confirm your password if asked.</div>
      </form>
    </div>
  );
}
