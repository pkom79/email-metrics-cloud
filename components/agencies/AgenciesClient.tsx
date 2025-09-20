"use client";
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { Building2, Link2, Plus } from 'lucide-react';

type AgencyRow = { agencies: { id: string; name: string; brand_limit: number; seat_limit: number } | null; role: string };
type BrandRow = { accounts: { id: string; name: string | null; company: string | null } | null };

export default function AgenciesClient() {
  const [agencies, setAgencies] = useState<AgencyRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [newAgencyName, setNewAgencyName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerAccounts, setOwnerAccounts] = useState<{ id: string; name: string | null; company: string | null }[]>([]);
  const [selectedOwnerAccountId, setSelectedOwnerAccountId] = useState('');
  const [linkToken, setLinkToken] = useState<string | null>(null);

  // Manage user access
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'member'>('member');
  const [scopeAllBrands, setScopeAllBrands] = useState(true);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      // Load agencies I belong to
      const { data } = await supabase
        .from('agency_users')
        .select('role, agencies(id, name, brand_limit, seat_limit)')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id || '');
      const list = (data || []) as any as AgencyRow[];
      setAgencies(list);
      const first = list.find(a => a.agencies)?.agencies?.id || null;
      setSelected(first);
    })();
  }, []);

  useEffect(() => { (async () => {
    if (!selected) { setBrands([]); return; }
    const { data } = await supabase
      .from('agency_accounts')
      .select('accounts(id, name, company)')
      .eq('agency_id', selected);
    setBrands((data || []) as any);
  })(); }, [selected]);

  const onCreateAgency = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/agencies/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newAgencyName }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed');
      setMsg('Agency created'); setNewAgencyName('');
      // reload
      const { data } = await supabase
        .from('agency_users')
        .select('role, agencies(id, name, brand_limit, seat_limit)')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id || '');
      const list = (data || []) as any as AgencyRow[];
      setAgencies(list); setSelected(list.find(a => a.agencies)?.agencies?.id || null);
    } catch (e: any) { setErr(e?.message || 'Failed to create agency'); }
    finally { setBusy(false); }
  };

  const onCreateBrand = async () => {
    if (!selected) return; setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/agencies/brands/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agencyId: selected, brandName: newBrandName }) });
      const j = await res.json(); if (!res.ok) throw new Error(j?.error || 'Failed');
      setMsg('Brand created and linked'); setNewBrandName('');
      // reload brands
      const { data } = await supabase.from('agency_accounts').select('accounts(id, name, company)').eq('agency_id', selected);
      setBrands((data || []) as any);
    } catch (e: any) { setErr(e?.message || 'Failed to create brand'); }
    finally { setBusy(false); }
  };

  const onFindBrands = async () => {
    setBusy(true); setErr(null); setMsg(null); setOwnerAccounts([]); setSelectedOwnerAccountId(''); setLinkToken(null);
    try {
      const res = await fetch('/api/agencies/owner-accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerEmail }) });
      const j = await res.json(); if (!res.ok) throw new Error(j?.error || 'Failed');
      setOwnerAccounts(j.accounts || []);
      if ((j.accounts || []).length === 1) setSelectedOwnerAccountId(j.accounts[0].id);
      setMsg(j.accounts?.length ? `Found ${j.accounts.length} brand(s).` : 'No brands found for that email.');
    } catch (e: any) { setErr(e?.message || 'Lookup failed'); }
    finally { setBusy(false); }
  };

  const onRequestLink = async () => {
    if (!selected || !selectedOwnerAccountId) return; setBusy(true); setErr(null); setMsg(null); setLinkToken(null);
    try {
      const res = await fetch('/api/agencies/links/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agencyId: selected, accountId: selectedOwnerAccountId }) });
      const j = await res.json(); if (!res.ok) throw new Error(j?.error || 'Failed');
      setLinkToken(j.rawToken || j.token || null);
      setMsg('Link request created. Share this token with the brand owner.');
    } catch (e: any) { setErr(e?.message || 'Failed to request link'); }
    finally { setBusy(false); }
  };

  const toggleBrand = (id: string) => {
    setSelectedBrandIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const onApplyAccess = async () => {
    if (!selected) return; setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/agencies/users/upsert', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agencyId: selected, userEmail: memberEmail, role: memberRole, allAccounts: scopeAllBrands, accountIds: selectedBrandIds })
      });
      const j = await res.json(); if (!res.ok) throw new Error(j?.error || 'Failed');
      setMsg('Access updated'); setMemberEmail(''); setSelectedBrandIds([]); setScopeAllBrands(true); setMemberRole('member');
    } catch (e: any) { setErr(e?.message || 'Failed to update access'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      {agencies.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 text-center">
          <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">No Agency Yet</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">Create an agency to manage multiple brands.</div>
          <div className="max-w-md mx-auto flex flex-col sm:flex-row gap-3 items-center justify-center">
            <input value={newAgencyName} onChange={e => setNewAgencyName(e.target.value)} placeholder="Agency name" className="w-full sm:w-auto flex-1 h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
            <button disabled={busy || !newAgencyName} onClick={onCreateAgency} className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 inline-flex items-center gap-2"><Plus className="w-4 h-4" />Create Agency</button>
          </div>
          {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
          {msg && <div className="text-sm text-emerald-600 mt-2">{msg}</div>}
        </div>
      )}
      {selected && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Manage User Access</div>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="Member email" className="flex-1 min-w-[220px] h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
              <select value={memberRole} onChange={e => setMemberRole(e.target.value as any)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="scope" checked={scopeAllBrands} onChange={() => setScopeAllBrands(true)} /> All brands
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="scope" checked={!scopeAllBrands} onChange={() => setScopeAllBrands(false)} /> Select brands
              </label>
            </div>
            {!scopeAllBrands && (
              <div className="grid sm:grid-cols-2 gap-2">
                {brands.map((b, i) => {
                  const id = b.accounts?.id || `b${i}`;
                  const label = b.accounts?.company || b.accounts?.name || id;
                  const checked = selectedBrandIds.includes(id);
                  return (
                    <label key={id} className={`flex items-center gap-2 border rounded px-3 py-2 ${checked ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleBrand(id)} />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div>
              <button disabled={busy || !memberEmail || (!scopeAllBrands && selectedBrandIds.length === 0)} onClick={onApplyAccess} className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 inline-flex items-center gap-2"><Plus className="w-4 h-4" />Apply Access</button>
            </div>
            {err && <div className="text-sm text-rose-600">{err}</div>}
            {msg && <div className="text-sm text-emerald-600">{msg}</div>}
          </div>
        </div>
      )}

      {agencies.length > 0 && (
        <div className="space-y-4">
          {agencies.filter(a => a.agencies).length === 1 ? (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300">Agency</label>
              <div className="text-sm text-gray-900 dark:text-gray-100">{agencies[0].agencies!.name}</div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300">Agency</label>
              <select value={selected || ''} onChange={e => setSelected(e.target.value)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
                {agencies.filter(a => a.agencies).map(a => <option key={a.agencies!.id} value={a.agencies!.id}>{a.agencies!.name}</option>)}
              </select>
            </div>
          )}

          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">Linked Brands</div>
            {brands.length === 0 && (
              <div className="text-sm text-gray-600 dark:text-gray-400">No brands linked yet.</div>
            )}
            {brands.length > 0 && (
              <ul className="space-y-2">
                {brands.map((b, i) => (
                  <li key={i} className="text-sm text-gray-800 dark:text-gray-200">{b.accounts?.company || b.accounts?.name || b.accounts?.id}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Create Brand</div>
            <div className="flex flex-wrap items-center gap-3">
              <input value={newBrandName} onChange={e => setNewBrandName(e.target.value)} placeholder="Brand name" className="flex-1 min-w-[220px] h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
              <button disabled={busy || !newBrandName} onClick={onCreateBrand} className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 inline-flex items-center gap-2"><Plus className="w-4 h-4" />Create</button>
            </div>

            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Request Access to Existing Brand</div>
            <div className="flex flex-wrap items-center gap-3">
              <input value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="Brand owner's email" className="flex-1 min-w-[220px] h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm" />
              <button disabled={busy || !ownerEmail} onClick={onFindBrands} className="h-9 px-4 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 disabled:opacity-50">Find Brands</button>
              {ownerAccounts.length > 0 && (
                <>
                  <select value={selectedOwnerAccountId} onChange={e => setSelectedOwnerAccountId(e.target.value)} className="h-9 px-3 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-sm">
                    <option value="">Select brand</option>
                    {ownerAccounts.map(a => <option key={a.id} value={a.id}>{a.company || a.name || a.id}</option>)}
                  </select>
                  <button disabled={busy || !selectedOwnerAccountId} onClick={onRequestLink} className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 inline-flex items-center gap-2"><Link2 className="w-4 h-4" />Request Link</button>
                </>
              )}
            </div>
            {linkToken && (
              <div className="text-xs text-gray-600 dark:text-gray-400">Share this token with the brand owner. They can approve at <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">/agency/approve</code>.</div>
            )}
            {err && <div className="text-sm text-rose-600">{err}</div>}
            {msg && <div className="text-sm text-emerald-600">{msg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
