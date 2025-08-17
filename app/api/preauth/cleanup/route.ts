import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        const { uploadId } = await request.json();
        if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });

        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';

        // Remove files under the folder
        const { data: list, error: listErr } = await supabase.storage.from(bucket).list(uploadId, { limit: 100 });
        if (listErr) throw listErr;
        if (list && list.length) {
            const toRemove = list.map((f) => `${uploadId}/${f.name}`);
            const { error: removeErr } = await supabase.storage.from(bucket).remove(toRemove);
            if (removeErr) throw removeErr;
        }

        // Mark upload as expired
        const { error: updateErr } = await supabase
            .from('uploads')
            .update({ status: 'expired' })
            .eq('id', uploadId);
        if (updateErr) throw updateErr;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to cleanup' }, { status: 500 });
    }
}
