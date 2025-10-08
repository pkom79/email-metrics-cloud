"use client";
import { useEffect, useState } from 'react';

export default function AdminOutboxLogs() {
  const [status, setStatus] = useState<'all' | 'pending' | 'processing' | 'sent' | 'error' | 'dead'>('all');
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/notifications/logs?status=${encodeURIComponent(status)}&limit=${limit}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      setRows(j.logs || []);
    } catch (e: any) { setErr(e?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Outbox Diagnostics</h2>
        <div className="flex items-center gap-2">
          <select value={status} onChange={e => setStatus(e.target.value as any)} className="h-8 px-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="sent">Sent</option>
            <option value="error">Error</option>
            <option value="dead">Dead</option>
          </select>
          <select value={limit} onChange={e => setLimit(parseInt(e.target.value, 10))} className="h-8 px-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
            {[25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={load} className="h-8 px-3 rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-sm">Refresh</button>
        </div>
      </div>
      {loading && <div className="text-sm text-gray-600 dark:text-gray-300">Loading…</div>}
      {err && <div className="text-sm text-rose-600">{err}</div>}
      {!loading && !err && (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr><th className="py-1 pr-2">Time</th><th className="py-1 pr-2">Topic</th><th className="py-1 pr-2">Recipient</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Attempts</th><th className="py-1">Last Error</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="py-1 pr-2 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{r.topic}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{r.recipient_email || r.recipient_user_id || '–'}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{String(r.status)}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{r.attempts ?? 0}</td>
                  <td className="py-1 truncate max-w-[480px]" title={r.last_error || ''}>{r.last_error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

