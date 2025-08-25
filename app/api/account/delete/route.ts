import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Full account deletion for current user – removes storage objects, purges child data, soft-deletes (marks deleted_at)
// then hard deletes the account row and finally deletes the auth user (if they are the sole owner / single-account model).
// Idempotent-ish: re-running after partial failure will attempt any remaining steps.
export async function POST() {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const supabase = createServiceClient();

        // 1. Locate owned account (single-owner model assumed)
        const { data: acct, error: acctErr } = await supabase
            .from('accounts')
            .select('id, deleted_at')
            .eq('owner_user_id', user.id)
            .maybeSingle();
        if (acctErr) throw acctErr;
        if (!acct?.id) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

        const accountId = acct.id as string;

        // 2. Collect upload IDs for storage cleanup (preauth bucket only; account-specific bucket paths not used yet)
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

        // 3. Soft delete marker (if not already) so any background jobs / UI know it's gone
        if (!acct.deleted_at) {
            await supabase.from('accounts').update({ deleted_at: new Date().toISOString() }).eq('id', accountId);
        }

        // 4. Purge child rows explicitly (snapshots, uploads). Leave tombstone until end for audit.
        try {
            await supabase.rpc('purge_account_children', { p_account_id: accountId });
        } catch (e) {
            return NextResponse.json({ error: 'Failed to purge account data' }, { status: 500 });
        }

        // 5. Hard delete account row (policies allow owner); ignore if already removed.
        await supabase.from('accounts').delete().eq('id', accountId);

        // 6. Delete auth user (single-account model). Ignore error but report if failure.
        try {
            await (supabase as any).auth.admin.deleteUser(user.id);
        } catch (e) {
            // If auth deletion fails we still consider account data purged.
            return NextResponse.json({ ok: true, warning: 'Account data removed but auth user deletion failed – remove manually.' });
        }

        return NextResponse.json({ ok: true, purged: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 });
    }
}
