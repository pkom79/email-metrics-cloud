"use client";
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { UserPlus, Copy, XCircle } from 'lucide-react';

type Account = { id: string; name: string | null; company: string | null };
type Invitation = { id: string; email: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; created_at: string };

export default function InvitationsManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<Invitation[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [isAgency, setIsAgency] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/account/my-brands', { cache: 'no-store' });
        const j = await res.json();
        const list = (j.accounts || []) as Account[];
        setAccounts(list);
        if (!accountId && list.length) setAccountId(list[0].id);
      } catch {}
      const me = await supabase.auth.getUser();
      setIsAgency(((me.data.user?.user_metadata as any)?.signup_type) === 'agency');
    })();
  }, []);

  const loadInvites = async (acc: string) => {
    const { data } = await supabase.from('invitations').select('id,email,status,created_at').eq('account_id', acc).eq('status', 'pending').order('created_at', { ascending: false });
    setPending((data || []) as any);
  };
  useEffect(() => { if (accountId) loadInvites(accountId); }, [accountId]);

  const onCreate = async () => {
    setErr(null); setMsg(null); setCreatedToken(null);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('Enter a valid email'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/invitations/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, email: email.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      setCreatedToken(j.token);
      setMsg('Invitation created');
      setEmail('');
      await loadInvites(accountId);
    } catch (e: any) { setErr(e?.message || 'Failed to create invitation'); }
    finally { setCreating(false); }
  };

  if (isAgency) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 text-center">
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Member invites are managed by brand owners</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">This page is for brand accounts. Agencies cannot add brand members.</div>
        <a href="/agencies" className="inline-flex items-center h-9 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm">Open Agency Console</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-3">
          <UserPlus className="w-5 h-5 text-purple-600" />
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Invite Members</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Owners can invite up to 5 members per brand.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="text-sm text-gray-700 dark:text-gray-300">Account</label>
          <select aria-label="Select brand account" value={accountId} onChange={e => setAccountId(e.target.value)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
            {accounts.map(a => <option key={a.id} value={a.id}>{a.company || a.name || a.id}</option>)}
          </select>
          {accountId && (
            <a href={`/dashboard?account=${accountId}`} className="text-sm text-purple-600 hover:underline">Open</a>
          )}
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="member@example.com" className="flex-1 min-w-[220px] h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
          <button disabled={creating} onClick={onCreate} className="inline-flex items-center gap-2 h-9 px-3 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-50">Invite</button>
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        {createdToken && (
          <div className="mt-3 p-3 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">Share this token with the invitee to accept:</div>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-white dark:bg-gray-900 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">{createdToken}</code>
              <button className="h-7 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center" onClick={() => navigator.clipboard.writeText(createdToken)}><Copy className="w-4 h-4" /></button>
            </div>
            <div className="text-xs text-gray-500 mt-1">Invitees can accept at /invitations/accept</div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Pending invitations</div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800 rounded border border-gray-200 dark:border-gray-800">
          {pending.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">No pending invitations.</div>
          )}
          {pending.map(inv => (
            <div key={inv.id} className="p-3 flex items-center justify-between">
              <div className="text-sm text-gray-800 dark:text-gray-200">{inv.email} <span className="text-gray-400">•</span> {new Date(inv.created_at).toLocaleString()}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800">Pending</span>
                {/* Future: revoke */}
                <button className="hidden h-7 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center"><XCircle className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
