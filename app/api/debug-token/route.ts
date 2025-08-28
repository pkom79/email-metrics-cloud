import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const token = searchParams.get('token');

        if (!token) {
            return NextResponse.json({ error: 'Missing token parameter' }, { status: 400 });
        }

        const supabase = createServiceClient();

        console.log('🔍 Debugging token:', token);

        // Look up the share token
        const { data: share, error: shareError } = await supabase
            .from('snapshot_shares')
            .select(`
                id,
                snapshot_id,
                share_token,
                is_active,
                expires_at,
                created_at,
                snapshots!inner(
                    id,
                    account_id,
                    upload_id,
                    label,
                    data
                )
            `)
            .eq('share_token', token)
            .single();

        if (shareError || !share) {
            return NextResponse.json({ 
                error: 'Share token not found',
                token,
                shareError: shareError?.message,
                debug: 'Token lookup failed'
            });
        }

        const snapshot = share.snapshots as any;

        // Test file access for each CSV type
        const testResults: Record<string, any> = {};
        const csvTypes = ['campaigns', 'flows', 'subscribers'];

        for (const type of csvTypes) {
            const fileName = `${type}.csv`;
            const filePath = `${snapshot.account_id}/${snapshot.upload_id}/${fileName}`;
            
            // Test csv-uploads bucket
            const result1 = await supabase.storage
                .from('csv-uploads')
                .download(filePath);
            
            // Test uploads bucket
            const result2 = await supabase.storage
                .from('uploads')
                .download(filePath);

            testResults[type] = {
                filePath,
                csvUploadsResult: {
                    success: !result1.error,
                    error: result1.error?.message || null,
                    size: result1.data?.size || 0
                },
                uploadsResult: {
                    success: !result2.error,
                    error: result2.error?.message || null,
                    size: result2.data?.size || 0
                }
            };
        }

        return NextResponse.json({
            shareFound: true,
            share: {
                id: share.id,
                snapshot_id: share.snapshot_id,
                is_active: share.is_active,
                expires_at: share.expires_at,
                created_at: share.created_at
            },
            snapshot: {
                id: snapshot.id,
                account_id: snapshot.account_id,
                upload_id: snapshot.upload_id,
                label: snapshot.label,
                hasData: !!snapshot.data
            },
            fileTests: testResults
        });

    } catch (error) {
        console.error('Debug token error:', error);
        return NextResponse.json({ 
            error: 'Debug failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
