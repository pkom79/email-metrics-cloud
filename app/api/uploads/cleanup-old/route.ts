import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';
import { getServerUser } from '../../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Clean up old uploads for active accounts, keeping only the most recent upload per account
// This is safer to run more frequently than the full batch cleanup
export async function POST() {
    try {
        const user = await getServerUser();
        // Allow anonymous (cron) or admin; if user present and not admin -> forbid
        if (user && user.app_metadata?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const supabase = createServiceClient();
        const bucket = ingestBucketName();
        const maxUploadsPerAccount = parseInt(process.env.MAX_UPLOADS_PER_ACCOUNT || '1');
        const now = new Date();
        
        console.log('cleanup-old-uploads: Starting old upload cleanup at', now.toISOString());

        // Get all uploads for active accounts, grouped by account
        const { data: uploads, error: uploadsError } = await supabase
            .from('uploads')
            .select(`
                id, 
                account_id, 
                created_at, 
                status,
                accounts!inner(id, deleted_at)
            `)
            .not('account_id', 'is', null)
            .in('status', ['bound', 'processing', 'processed'])
            .is('accounts.deleted_at', null) // Only active accounts
            .order('account_id, created_at', { ascending: false });

        if (uploadsError) {
            console.error('cleanup-old-uploads: Error fetching uploads:', uploadsError);
            return NextResponse.json({ error: uploadsError.message }, { status: 500 });
        }

        // Group uploads by account
        const accountUploads = new Map<string, any[]>();
        for (const upload of uploads || []) {
            if (!accountUploads.has(upload.account_id)) {
                accountUploads.set(upload.account_id, []);
            }
            accountUploads.get(upload.account_id)!.push(upload);
        }

        let removedCount = 0;
        const errors: string[] = [];

        // For each account, keep only the most recent N uploads (configurable)
        for (const [accountId, accountUploadList] of accountUploads) {
            if (accountUploadList.length <= maxUploadsPerAccount) {
                console.log(`cleanup-old-uploads: Account ${accountId} has only ${accountUploadList.length} upload(s), within limit of ${maxUploadsPerAccount}, skipping`);
                continue;
            }

            // Sort by created_at descending (most recent first)
            accountUploadList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const toKeep = accountUploadList.slice(0, maxUploadsPerAccount);
            const toDelete = accountUploadList.slice(maxUploadsPerAccount);

            console.log(`cleanup-old-uploads: Account ${accountId} has ${accountUploadList.length} uploads. Keeping ${toKeep.length} most recent, removing ${toDelete.length} older ones`);

            for (const upload of toDelete) {
                try {
                    console.log(`cleanup-old-uploads: Removing old upload ${upload.id} from account ${accountId}`);

                    // 1. Remove storage files
                    const { data: fileList, error: listError } = await supabase.storage
                        .from(bucket)
                        .list(upload.id, { limit: 100 });
                    
                    if (listError) {
                        throw new Error(`Failed to list files: ${listError.message}`);
                    }

                    if (fileList && fileList.length > 0) {
                        const filePaths = fileList.map((f: any) => `${upload.id}/${f.name}`);
                        const { error: removeError } = await supabase.storage
                            .from(bucket)
                            .remove(filePaths);
                        
                        if (removeError) {
                            throw new Error(`Failed to remove storage files: ${removeError.message}`);
                        }
                        console.log(`cleanup-old-uploads: Removed ${filePaths.length} storage files for upload ${upload.id}`);
                    }

                    // 2. Remove related snapshots (which will cascade to snapshot_totals and snapshot_series)
                    const { error: snapshotError } = await supabase
                        .from('snapshots')
                        .delete()
                        .eq('upload_id', upload.id);
                    
                    if (snapshotError) {
                        throw new Error(`Failed to remove snapshots: ${snapshotError.message}`);
                    }

                    // 3. Remove the upload record
                    const { error: uploadError } = await supabase
                        .from('uploads')
                        .delete()
                        .eq('id', upload.id);
                    
                    if (uploadError) {
                        throw new Error(`Failed to remove upload record: ${uploadError.message}`);
                    }

                    removedCount++;
                    console.log(`cleanup-old-uploads: Successfully removed old upload ${upload.id}`);

                } catch (error: any) {
                    const errorMsg = `Failed to remove old upload ${upload.id}: ${error.message || 'Unknown error'}`;
                    console.error('cleanup-old-uploads:', errorMsg);
                    errors.push(errorMsg);
                }
            }
        }

        const result = {
            ok: true,
            removedUploads: removedCount,
            processedAccounts: accountUploads.size,
            errors: errors,
            timestamp: now.toISOString()
        };

        console.log('cleanup-old-uploads: Cleanup completed', result);
        return NextResponse.json(result);

    } catch (e: any) {
        console.error('cleanup-old-uploads: Unexpected error:', e);
        return NextResponse.json({ 
            error: e?.message || 'Cleanup failed',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}
