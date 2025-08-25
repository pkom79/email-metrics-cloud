import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

// DELETE current user's account (hard delete) – irreversible.
// Removes account row (cascades to snapshots/uploads/etc) then best-effort deletes storage objects.
// Storage cleanup done first so if it fails we abort before irreversible DB delete.
export async function POST() {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const supabase = createServiceClient();

        // Find user's account id
        const { data: acct, error: acctErr } = await supabase
            .from('accounts')
            .select('id')
            .eq('owner_user_id', user.id)
            .maybeSingle();
        if (acctErr) throw acctErr;
        if (!acct?.id) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

        const accountId = acct.id as string;

        // Collect upload IDs for storage cleanup (preauth bucket only; account-specific bucket paths not used yet)
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const { data: uploads, error: uploadsErr } = await supabase
            .from('uploads')
            .select('id')
            .eq('account_id', accountId);
        if (uploadsErr) throw uploadsErr;

        // Remove storage folders for each upload (best-effort)
        for (const u of uploads || []) {
            try {
                const { data: list, error: listErr } = await supabase.storage.from(bucket).list(u.id, { limit: 100 });
                if (listErr) throw listErr;
                if (list && list.length) {
                    const paths = list.map((f: any) => `${u.id}/${f.name}`);
                    const { error: remErr } = await supabase.storage.from(bucket).remove(paths);
                    if (remErr) throw remErr;
                }
            } catch (e) {
                return NextResponse.json({ error: `Storage cleanup failed for upload ${u.id}` }, { status: 500 });
            }
        }

        // Hard delete account (cascades handle children)
        const { error: delErr } = await supabase.from('accounts').delete().eq('id', accountId);
        if (delErr) throw delErr;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 });
    }
}
