import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        const { uploadId } = await request.json();
        if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });

        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const required = ['subscribers.csv', 'flows.csv', 'campaigns.csv'];

        const { data: list, error: listErr } = await supabase.storage.from(bucket).list(uploadId, { limit: 100 });
        if (listErr) throw listErr;

        const present = new Set((list || []).map((f) => f.name));
        const missing = required.filter((r) => !present.has(r));

        if (missing.length > 0) {
            return NextResponse.json({ ok: false, missing }, { status: 400 });
        }
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Validation failed' }, { status: 500 });
    }
}
