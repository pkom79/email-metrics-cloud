import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        console.log('link-upload: Starting single upload link process');
        const user = await getServerUser();
        if (!user) {
            console.log('link-upload: No authenticated user');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.log('link-upload: User authenticated:', user.id);

        const { uploadId, label, pendingUploadIds, accountId: requestedAccountId } = await request.json();
        console.log('link-upload: Request payload:', { uploadId, label, pendingUploadIds, accountId: requestedAccountId });
        if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });

        const supabase = createServiceClient();
        const bucket = ingestBucketName();

        // 1) Ensure account exists (single-user workspace for now)
        const isAdmin = (user.app_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.app_role === 'admin';
        let accountId: string | undefined = requestedAccountId;
        if (accountId) {
            const { data: candidate, error: acctErr } = await supabase
                .from('accounts')
                .select('id, owner_user_id')
                .eq('id', accountId)
                .maybeSingle();
            if (acctErr) throw acctErr;
            if (!candidate) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
            if (!isAdmin && candidate.owner_user_id !== user.id) {
                const { data: membership } = await supabase
                    .from('account_users')
                    .select('role')
                    .eq('account_id', accountId)
                    .eq('user_id', user.id)
                    .limit(1)
                    .maybeSingle();
                if (!membership) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            }
            accountId = candidate.id;
        } else {
            const { data: acctRow, error: acctSelErr } = await supabase
                .from('accounts')
                .select('id')
                .eq('owner_user_id', user.id)
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (acctSelErr) throw acctSelErr;
            accountId = acctRow?.id as string | undefined;
            if (!accountId) {
                const { data: memberRow } = await supabase
                    .from('account_users')
                    .select('account_id')
                    .eq('user_id', user.id)
                    .limit(1);
                if (memberRow && memberRow.length) {
                    accountId = (memberRow as any)[0].account_id;
                }
            }
        }

        if (!accountId) {
            const md = (user.user_metadata as any) || {};
            const rawBusiness = (md.businessName as string | undefined) || '';
            const businessName = rawBusiness.trim();
            const name = (md.name as string | undefined)?.trim() || user.email || 'My Account';
            const country = (md.country as string | undefined)?.trim() || null;
            const storeUrlRaw = (md.storeUrl as string | undefined) || '';
            const normalizeStoreUrl = (value: string) => {
                if (!value) return '';
                let v = value.trim();
                v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
                return v.toLowerCase();
            };
            const store_url = normalizeStoreUrl(storeUrlRaw) || null;
            const insertPayload: any = { owner_user_id: user.id, name };
            if (businessName) insertPayload.company = businessName;
            if (country) insertPayload.country = country;
            if (store_url) insertPayload.store_url = store_url;
            const { data: created, error: createErr } = await supabase
                .from('accounts')
                .insert(insertPayload)
                .select('id')
                .single();
            if (createErr) throw createErr;
            accountId = created.id;
        }

        // Helper to verify storage files exist
        const verifyUploadComplete = async (candidateId: string) => {
            const { data: files, error: listErr } = await supabase.storage.from(bucket).list(candidateId, { limit: 100 });
            if (listErr) throw listErr;
            const required = ['subscribers.csv', 'flows.csv', 'campaigns.csv'];
            const present = new Set((files || []).map((f: any) => f.name));
            const missing = required.filter(r => !present.has(r));
            return missing.length === 0;
        };

        // 2) Core upload (the one explicitly requested)
        const coreComplete = await verifyUploadComplete(uploadId);
        if (!coreComplete) {
            return NextResponse.json({ error: 'Missing required files for main upload' }, { status: 400 });
        }

        // 2b) Continuity Gate (compare with recent fingerprints when available)
        try {
            // Load CSVs text for sampling
            const bucket = ingestBucketName();
            const dl = async (path: string) => {
                const { data } = await supabase.storage.from(bucket).download(`${uploadId}/${path}`);
                return data ? await (data as Blob).text() : '';
            };
            const [csvSubs, csvFlows, csvCamps] = await Promise.all([
                dl('subscribers.csv'), dl('flows.csv'), dl('campaigns.csv')
            ]);
            const parseCsv = (csv: string): any[] => {
                try { const rows = (csv || '').split(/\r?\n/); if (!rows.length) return []; const header = rows[0].split(',').map(s => s.trim()); const out: any[] = []; for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const cols = r.split(','); const obj: any = {}; header.forEach((h, idx) => obj[h] = cols[idx]); out.push(obj); } return out; } catch { return []; }
            };
            const subs = parseCsv(csvSubs);
            const flows = (() => {
                // flows are not headered reliably; fallback to Papa-like header probing
                const lines = (csvFlows || '').split(/\r?\n/).filter(Boolean);
                if (lines.length < 4) return [] as any[];
                let headerIdx = 2; // default to row 3
                for (let i = 0; i < Math.min(10, lines.length); i++) { if (lines[i].startsWith('Day,')) { headerIdx = i; break; } }
                const header = lines[headerIdx].split(',');
                const out: any[] = [];
                for (let i = headerIdx + 1; i < lines.length; i++) { const cols = lines[i].split(','); const obj: any = {}; header.forEach((h, idx) => obj[h] = cols[idx]); out.push(obj); }
                return out;
            })();
            const camps = parseCsv(csvCamps);

            const pickLast10 = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).slice(-10);
            const normDate = (s?: string) => { try { const d = new Date(String(s)); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10); } catch { return ''; } };
            const profiles10 = pickLast10(subs.map(r => String(r['Klaviyo ID'] || r['KlaviyoID'] || r['Klaviyo_Id'] || '').trim()).filter(Boolean));
            const campaigns10 = (() => {
                const id = (r: any) => String(r['Campaign ID'] || r['CampaignId'] || '').trim();
                const name = (r: any) => String(r['Campaign Name'] || r['Campaign name'] || r['Name'] || '').trim();
                const when = (r: any) => normDate(String(r['Send Time'] || r['Send Date'] || r['Sent At'] || ''));
                const keys = camps.map(r => (id(r) || `${name(r)}@${when(r)}`)).filter(Boolean);
                return pickLast10(keys);
            })();
            const flows10 = (() => {
                const fid = (r: any) => String(r['Flow ID'] || '').trim();
                const mid = (r: any) => String(r['Flow Message ID'] || '').trim();
                const keys = flows.map(r => (fid(r) && mid(r)) ? `${fid(r)}_${mid(r)}` : '').filter(Boolean);
                return pickLast10(keys);
            })();

            // Load fingerprint if exists
            const { data: fpRow } = await supabase
                .from('accounts_fingerprint')
                .select('last10_profiles,last10_campaigns,last10_flows')
                .eq('account_id', accountId)
                .maybeSingle();
            if (fpRow) {
                const set = (a: any) => new Set<string>(Array.isArray(a) ? a : []);
                const profSet = set(fpRow.last10_profiles);
                const campSet = set(fpRow.last10_campaigns);
                const flowSet = set(fpRow.last10_flows);
                const count = (arr: string[], s: Set<string>) => arr.reduce((n, x) => n + (s.has(x) ? 1 : 0), 0);
                const matches = {
                    profiles: count(profiles10, profSet),
                    campaigns: count(campaigns10, campSet),
                    flows: count(flows10, flowSet)
                };

                const pass = (() => {
                    const cats = ['profiles','campaigns','flows'] as const;
                    const atLeast5 = cats.filter(k => (matches as any)[k] >= 5);
                    if (atLeast5.length >= 2) return true;
                    const one5 = atLeast5.length === 1;
                    const near4 = (k: string) => (matches as any)[k] >= 4;
                    if (one5 && (near4('campaigns') || near4('flows'))) return true;
                    return false;
                })();

                if (!pass) {
                    // Log and fail
                    try { await supabase.from('account_ingests').insert({ account_id: accountId, result: 'fail', matches, reason: 'continuity_gate' } as any); } catch {}
                    return NextResponse.json({ error: "CSVs don’t match this account’s recent history.", matches }, { status: 409 });
                }
            }

            // If no fingerprint row, accept silently (first import)
            // Also seed/update fingerprint now using parsed keys so the row exists immediately
            try {
                await supabase
                    .from('accounts_fingerprint')
                    .upsert({ account_id: accountId, last10_profiles: profiles10, last10_campaigns: campaigns10, last10_flows: flows10, updated_at: new Date().toISOString() as any } as any, { onConflict: 'account_id' });
            } catch { /* ignore fingerprint update errors */ }
        } catch { /* ignore gating errors */ }

        // 3) Bind core upload row to account and mark bound
        const { error: updErr } = await supabase
            .from('uploads')
            .update({ account_id: accountId, status: 'bound', updated_at: new Date().toISOString() })
            .eq('id', uploadId);
        if (updErr) throw updErr;

        // 4) Create snapshot placeholder referencing the core upload
        const snapshotLabel = label || 'Latest Import';
        const { data: snap, error: snapErr } = await supabase
            .from('snapshots')
            .insert({ account_id: accountId, upload_id: uploadId, label: snapshotLabel, status: 'ready' })
            .select('id')
            .single();
        if (snapErr) throw snapErr;
        // 5) Opportunistically bind any additional preauth uploads supplied (bulk claim) – ignore errors
        if (Array.isArray(pendingUploadIds)) {
            const others = pendingUploadIds.filter((id: string) => id && id !== uploadId);
            if (others.length) {
                for (const otherId of others) {
                    try {
                        const complete = await verifyUploadComplete(otherId);
                        if (!complete) continue;
                        await supabase
                            .from('uploads')
                            .update({ account_id: accountId, status: 'bound', updated_at: new Date().toISOString() })
                            .eq('id', otherId)
                            .eq('status', 'preauth');
                        await supabase
                            .from('snapshots')
                            .insert({ account_id: accountId, upload_id: otherId, label: 'Imported Dataset', status: 'ready' });
                    } catch { /* continue */ }
                }
            }
        }

        // 6) Kick off server-side processing for core snapshot (non-blocking) + any others
        fetch('/api/snapshots/process', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId })
        }).catch(() => {});
        if (Array.isArray(pendingUploadIds)) {
            for (const otherId of pendingUploadIds) {
                if (otherId === uploadId) continue;
                fetch('/api/snapshots/process', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: otherId })
                }).catch(() => {});
            }
        }

        return NextResponse.json({ ok: true, accountId, snapshotId: snap.id });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to bind upload' }, { status: 500 });
    }
}
