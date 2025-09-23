"use client";
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { Bell, Plus, Trash2 } from 'lucide-react';

type Account = { id: string; name: string | null; company: string | null; role?: string | null };
type SubRow = { id: string; account_id: string; topic: string; recipient_user_id: string | null; recipient_email: string | null; enabled: boolean };

const TOPICS = [
  { key: 'csv_uploaded', label: 'Data Updated' },
  { key: 'member_invited', label: 'User Invited' },
  { key: 'member_revoked', label: 'User Access Removed' },
];

export default function NotificationsSettings() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<string>('csv_uploaded');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadAccounts = async () => {
    try {
      const res = await fetch('/api/account/my-brands', { cache: 'no-store' });
      const j = await res.json();
      const rows = (j.accounts || []) as Account[];
      setAccounts(rows);
      // Prefer ?account=... from URL if present
      try {
        const usp = new URLSearchParams(window.location.search);
        const q = usp.get('account');
        if (q && rows.some(a => a.id === q)) {
          setAccountId(q);
          return;
        }
      } catch {}
      if (!accountId && rows.length) setAccountId(rows[0].id);
    } catch {}
  };
  const loadSubs = async (acc: string) => {
    setLoading(true);
    const { data } = await supabase.from('account_notification_subscriptions').select('*').eq('account_id', acc).order('created_at', { ascending: true });
    setSubs((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { loadAccounts(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (accountId) loadSubs(accountId); }, [accountId]);

  // Gate for agency logins (UI only)
  useEffect(() => { (async () => {
    const { data } = await supabase.auth.getUser();
  })(); }, []);

  const AVAILABLE_TOPICS = useMemo(() => TOPICS, []);

  const onAdd = async () => {
    setErr(null); setMsg(null);
    if (!accountId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('Enter a valid recipient email'); return; }
    setAdding(true);
    try {
      const { error } = await supabase.from('account_notification_subscriptions').upsert({ account_id: accountId, topic, recipient_email: email.trim(), enabled: true } as any);
      if (error) throw error;
      setEmail('');
      setMsg('Recipient added');
      await loadSubs(accountId);
    } catch (e: any) { setErr(e?.message || 'Failed to add'); }
    finally { setAdding(false); }
  };

  const onToggle = async (row: SubRow) => {
    await supabase.from('account_notification_subscriptions').update({ enabled: !row.enabled } as any).eq('id', row.id);
    await loadSubs(accountId);
  };
  const onDelete = async (row: SubRow) => {
    await supabase.from('account_notification_subscriptions').delete().eq('id', row.id);
    await loadSubs(accountId);
  };

  const accountLabel = useMemo(() => {
    const a = accounts.find(x => x.id === accountId);
    return a ? (a.company || a.name || a.id) : '';
  }, [accounts, accountId]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-purple-600" />
            <div>
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Manage Notification Recipients</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Per-account subscriptions. Agency users can manage for linked brands.</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-700 dark:text-gray-300">Account</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.company || a.name || a.id}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">Selected: {accountLabel || '(none)'}</span>
        </div>

        <div className="mt-6 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={topic} onChange={e => setTopic(e.target.value)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
              {AVAILABLE_TOPICS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Recipient email" className="flex-1 min-w-[220px] h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
            <button disabled={adding} onClick={onAdd} className="inline-flex items-center gap-2 h-9 px-3 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-50"><Plus className="w-4 h-4" />Add</button>
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
          {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        </div>

        <div className="mt-6">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Current recipients</div>
          <div className="divide-y divide-gray-200 dark:divide-gray-800 rounded border border-gray-200 dark:border-gray-800">
            {loading && <div className="p-3 text-sm text-gray-500">Loading…</div>}
            {!loading && subs.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">
                No recipients yet. Add one above.
              </div>
            )}
            {!loading && subs.map(row => (
              <div key={row.id} className="p-3 flex items-center justify-between">
                <div className="text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-medium">{AVAILABLE_TOPICS.find(t => t.key === row.topic)?.label || row.topic}</span>
                  <span className="mx-2 text-gray-400">•</span>
                  {row.recipient_email || `User ${row.recipient_user_id}`}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => onToggle(row)} className={`h-7 px-3 rounded border text-xs ${row.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' : 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700'}`}>{row.enabled ? 'Enabled' : 'Disabled'}</button>
                  <button onClick={() => onDelete(row)} className="h-7 px-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
