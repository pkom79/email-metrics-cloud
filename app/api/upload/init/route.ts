import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServiceClient } from '../../../../lib/supabase/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST() {
    try {
        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const uploadId = randomUUID();

        // Create uploads row (preauth)
        // TTL extended to 24h (was 1h) per requirements so preauth uploads persist for a day before cleanup
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const { error: insertErr } = await supabase
            .from('uploads')
            .insert({ id: uploadId, status: 'preauth', expires_at: expiresAt, updated_at: new Date().toISOString() });
        if (insertErr) throw insertErr;

        // Store upload ID in cookie for later linking during email confirmation
        const cookieStore = cookies();
        const existingCookie = cookieStore.get('pending-upload-ids')?.value;
        let pendingIds: string[] = [];
        
        if (existingCookie) {
            try {
                const parsed = JSON.parse(existingCookie);
                pendingIds = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                pendingIds = [existingCookie];
            }
        }
        
        // Add new upload ID if not already present
        if (!pendingIds.includes(uploadId)) {
            pendingIds.push(uploadId);
        }
        
        // Keep only the last 5 upload IDs to prevent cookie bloat
        if (pendingIds.length > 5) {
            pendingIds = pendingIds.slice(-5);
        }
        
        cookieStore.set('pending-upload-ids', JSON.stringify(pendingIds), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 // 24 hours
        });

        console.log(`upload/init: Created upload ${uploadId}, updated pending cookie:`, pendingIds);

        const paths = {
            subscribers: `${uploadId}/subscribers.csv`,
            flows: `${uploadId}/flows.csv`,
            campaigns: `${uploadId}/campaigns.csv`
        } as const;

        const makeSigned = async (path: string) => {
            const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
            if (error) throw error;
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
