"use client";
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { Building2, Plus } from 'lucide-react';

type Brand = { id: string; name: string | null; company: string | null; store_url?: string | null };

export default function BrandsManager() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const normalizeStoreUrl = (v: string) => v.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/,'').toLowerCase();

  const [isAgency, setIsAgency] = useState(false);
  const load = async () => {
    const uid = (await supabase.auth.getUser()).data.user?.id || '';
    setIsAgency(((await supabase.auth.getUser()).data.user?.user_metadata as any)?.signup_type === 'agency');
    const { data } = await supabase.from('accounts').select('id,name,company,store_url').eq('owner_user_id', uid).order('created_at', { ascending: true });
    setBrands((data || []) as any);
  };
  useEffect(() => { load(); }, []);

  const onCreate = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const insert = { name: name || company || 'Account', company: company || name || null, store_url: normalizeStoreUrl(storeUrl) } as any;
      const { data, error } = await supabase.from('accounts').insert(insert).select('id').single();
      if (error) throw error;
      setMsg('Brand created'); setName(''); setCompany(''); setStoreUrl('');
      await load();
    } catch (e: any) { setErr(e?.message || 'Failed to create brand'); }
    finally { setBusy(false); }
  };

  if (isAgency) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 text-center">
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Brands are created by owners</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">This page is for brand accounts. Use the Agency Console to create a brand linked to your agency.</div>
        <a href="/agencies" className="inline-flex items-center h-9 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm">Open Agency Console</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-3">
          <Building2 className="w-5 h-5 text-purple-600" />
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Your Brands</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Add additional brands you own. Each brand has its own members and data.</div>
          </div>
        </div>
        {brands.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">No brands yet.</div>
        )}
        {brands.length > 0 && (
          <ul className="space-y-2">
            {brands.map(b => (
              <li key={b.id} className="text-sm flex items-center justify-between">
                <span>{b.company || b.name || b.id}</span>
                <a className="text-purple-600 hover:underline" href={`/dashboard?account=${b.id}`}>Open</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Create New Brand</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Display name" className="w-full h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company (optional)" className="w-full h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        <input value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="Store domain (optional)" className="w-full h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {msg && <div className="text-sm text-emerald-600">{msg}</div>}
        <button disabled={busy || (!name && !company)} onClick={onCreate} className="inline-flex items-center gap-2 h-9 px-3 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-50"><Plus className="w-4 h-4" />Create Brand</button>
      </div>
    </div>
  );
}
