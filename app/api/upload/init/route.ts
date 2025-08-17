import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
    try {
        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const uploadId = randomUUID();

        // Create uploads row (preauth)
        const { error: insertErr } = await supabase
            .from('uploads')
            .insert({ id: uploadId, status: 'preauth', expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
        if (insertErr) throw insertErr;

        const paths = {
            subscribers: `${uploadId}/subscribers.csv`,
            flows: `${uploadId}/flows.csv`,
            campaigns: `${uploadId}/campaigns.csv`
        } as const;

        const makeSigned = async (path: string) => {
            const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
            if (error) throw error;
            // Supabase returns a token to be used with uploadToSignedUrl
            return { path, token: (data as any).token };
        };

        const [subscribers, flows, campaigns] = await Promise.all([
            makeSigned(paths.subscribers),
            makeSigned(paths.flows),
            makeSigned(paths.campaigns)
        ]);

        return NextResponse.json({ uploadId, bucket, urls: { subscribers, flows, campaigns } });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to init upload' }, { status: 500 });
    }
}
