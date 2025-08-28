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

        // Get the share data
        const { data: share, error: shareError } = await supabase
            .from('snapshot_shares')
            .select(`
                id,
                snapshot_id,
                is_active,
                expires_at,
                snapshots!inner(
                    id,
                    account_id,
                    upload_id,
                    label,
                    status
                )
            `)
            .eq('share_token', token)
            .single();

        if (shareError || !share) {
            return NextResponse.json({ 
                error: 'Invalid share token',
                details: shareError?.message 
            }, { status: 404 });
        }

        const snapshot = share.snapshots as any;
        
        // Test if the specific file exists
        const testPath = `${snapshot.account_id}/${snapshot.upload_id}/campaigns.csv`;
        
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('csv-uploads')
            .download(testPath);
            
        // Also check what files exist in this account/upload combo
        const { data: uploadFiles, error: listError } = await supabase.storage
            .from('csv-uploads')
            .list(`${snapshot.account_id}/${snapshot.upload_id}`, { limit: 100 });

        return NextResponse.json({
            shareValid: true,
            snapshot: {
                id: snapshot.id,
                account_id: snapshot.account_id,
                upload_id: snapshot.upload_id,
                label: snapshot.label,
                status: snapshot.status
            },
            testPath,
            fileExists: !downloadError,
            downloadError: downloadError?.message,
            filesInUploadFolder: uploadFiles?.map((f: any) => f.name) || [],
            listError: listError?.message
        });
        
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
