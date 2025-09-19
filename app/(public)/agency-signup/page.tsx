"use client";
import { useState } from 'react';
import { supabase } from '../../../lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function AgencySignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null); setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { signup_type: 'agency', agencyName } }
      });
      if (error) throw error;
      setMsg('Agency account created. Redirecting…');
      setTimeout(() => router.replace('/agencies'), 800);
    } catch (e: any) { setErr(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Agency Sign Up</h1>
      <form onSubmit={onSubmit} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
        <div className="space-y-1">
          <label className="text-sm text-gray-700 dark:text-gray-300">Agency name</label>
          <input value={agencyName} onChange={e => setAgencyName(e.target.value)} required className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-700 dark:text-gray-300">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-700 dark:text-gray-300">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full h-10 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        <button disabled={busy} className="h-10 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">Create Agency</button>
      </form>
    </div>
  );
}

