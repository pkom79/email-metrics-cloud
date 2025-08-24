import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { uploadId, label } = await request.json();
        if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });

        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';

        // 1) Ensure account exists (single-user workspace for now)
        const { data: acctRow, error: acctSelErr } = await supabase
            .from('accounts')
            .select('id')
            .eq('owner_user_id', user.id)
            .limit(1)
            .maybeSingle();
        if (acctSelErr) throw acctSelErr;

        let accountId = acctRow?.id as string | undefined;
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

        // 2) Validate files exist in preauth folder
        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(uploadId, { limit: 100 });
        if (listErr) throw listErr;
        const required = ['subscribers.csv', 'flows.csv', 'campaigns.csv'];
        const present = new Set((files || []).map(f => f.name));
        const missing = required.filter(r => !present.has(r));
        if (missing.length > 0) {
            return NextResponse.json({ error: `Missing: ${missing.join(', ')}` }, { status: 400 });
        }

        // 3) Bind upload row to account and mark bound
        const { error: updErr } = await supabase
            .from('uploads')
            .update({ account_id: accountId, status: 'bound', updated_at: new Date().toISOString() })
            .eq('id', uploadId);
        if (updErr) throw updErr;

        // 4) Create a snapshot placeholder (ready) referencing the upload
        const snapshotLabel = label || 'Latest Import';
        const { data: snap, error: snapErr } = await supabase
            .from('snapshots')
            .insert({ account_id: accountId, upload_id: uploadId, label: snapshotLabel, status: 'ready' })
            .select('id')
            .single();
        if (snapErr) throw snapErr;

        return NextResponse.json({ ok: true, accountId, snapshotId: snap.id });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to bind upload' }, { status: 500 });
    }
}
