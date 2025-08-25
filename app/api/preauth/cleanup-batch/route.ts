import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { getServerUser } from '../../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Batch cleanup expired preauth uploads (older than expires_at or >24h) – intended for cron.
export async function POST() {
    try {
        const user = await getServerUser();
        // Allow anonymous (cron) or admin; if user present and not admin -> forbid
        if (user && user.app_metadata?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const now = new Date();
        // Fetch expired preauth uploads (limit batch size for safety)
        const { data: rows, error } = await supabase
            .from('uploads')
            .select('id,expires_at')
            .eq('status', 'preauth')
            .lt('expires_at', now.toISOString())
            .limit(50);
        if (error) throw error;
        let removed = 0;
        for (const r of rows || []) {
            try {
                const { data: list } = await supabase.storage.from(bucket).list(r.id, { limit: 100 });
                if (list && list.length) {
                    const paths = list.map((f: any) => `${r.id}/${f.name}`);
                    await supabase.storage.from(bucket).remove(paths);
                }
                await supabase.from('uploads').update({ status: 'expired' }).eq('id', r.id);
                removed++;
            } catch { /* continue */ }
        }
        return NextResponse.json({ ok: true, removed });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Cleanup failed' }, { status: 500 });
    }
}
