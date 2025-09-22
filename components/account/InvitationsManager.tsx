"use client";
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { UserPlus, XCircle } from 'lucide-react';

type Account = { id: string; name: string | null; company: string | null };
type Invitation = { id: string; email: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; created_at: string };
type Member = { user_id: string; email: string | null; role: 'owner' | 'manager' };

export default function InvitationsManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [creating, setCreating] = useState(false);
  // No longer surface raw tokens in the UI
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

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
    try {
      const res = await fetch(`/api/invitations/list?accountId=${encodeURIComponent(acc)}`, { cache: 'no-store' });
      const j = await res.json();
      setPending((j.invitations || []) as any);
    } catch { setPending([]); }
  };
  const loadMembers = async (acc: string) => {
    try {
      const res = await fetch(`/api/account/members/list?accountId=${encodeURIComponent(acc)}`, { cache: 'no-store' });
      const j = await res.json();
      setMembers((j.members || []) as any);
    } catch { setMembers([]); }
  };
  useEffect(() => { if (accountId) { loadInvites(accountId); loadMembers(accountId); } }, [accountId]);

  const onCreate = async () => {
    setErr(null); setMsg(null);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('Enter a valid email'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/invitations/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, email: email.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      setMsg('Invitation created and email queued');
      setEmail('');
      await loadInvites(accountId);
      await loadMembers(accountId);
    } catch (e: any) { setErr(e?.message || 'Failed to create invitation'); }
    finally { setCreating(false); }
  };

  if (isAgency) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 text-center">
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Manager invites are managed by brand owners</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">This page is for brand accounts. Agencies cannot add brand managers.</div>
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
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Invite Users</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Admins can invite up to 5 managers per brand.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="text-sm text-gray-700 dark:text-gray-300">Account</label>
          <select aria-label="Select brand account" value={accountId} onChange={e => setAccountId(e.target.value)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
            {accounts.map(a => <option key={a.id} value={a.id}>{a.company || a.name || a.id}</option>)}
          </select>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" className="flex-1 min-w-[220px] h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
          <button disabled={creating} onClick={onCreate} className="inline-flex items-center gap-2 h-9 px-3 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-50">Invite</button>
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Current users</div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800 rounded border border-gray-200 dark:border-gray-800">
          {members.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">No users yet.</div>
          )}
          {members.map(m => (
            <div key={m.user_id} className="p-3 flex items-center justify-between">
              <div className="text-sm text-gray-800 dark:text-gray-200">{m.email || m.user_id} <span className="text-gray-400">•</span> {m.role === 'owner' ? 'Admin' : 'Manager'}</div>
              {m.role === 'manager' && (
                <button onClick={async () => { await fetch('/api/account/members/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, userId: m.user_id }) }); await loadMembers(accountId); }} className="h-7 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center"><XCircle className="w-4 h-4 mr-1" />Remove</button>
              )}
            </div>
          ))}
        </div>
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
                <button
                  disabled={resendingId === inv.id}
                  onClick={async () => {
                    setErr(null); setMsg(null); setResendingId(inv.id);
                    try {
                      const res = await fetch('/api/invitations/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, invitationId: inv.id }) });
                      const j = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(j?.error || 'Failed');
                      setMsg(`Invitation re-sent to ${inv.email}`);
                      setTimeout(() => setMsg(null), 3000);
                      await loadInvites(accountId);
                    } catch (e: any) { setErr(e?.message || 'Failed to resend'); }
                    finally { setResendingId(null); }
                  }}
                  className="h-7 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                  {resendingId === inv.id ? 'Resending…' : 'Resend'}
                </button>
                <button onClick={async () => { await fetch('/api/invitations/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, invitationId: inv.id }) }); await loadInvites(accountId); }} className="h-7 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center"><XCircle className="w-4 h-4 mr-1" />Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
