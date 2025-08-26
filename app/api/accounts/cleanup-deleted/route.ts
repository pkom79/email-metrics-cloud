import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { getServerUser } from '../../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Permanently clean up soft-deleted accounts older than specified retention period
// Default: 30 days retention for soft-deleted accounts
export async function POST(request: Request) {
    try {
        const user = await getServerUser();
        // Allow anonymous (cron) or admin; if user present and not admin -> forbid
        if (user && user.app_metadata?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const retentionDays = body.retentionDays || 
            parseInt(process.env.DELETED_ACCOUNT_RETENTION_DAYS || '30'); // Default 30 days
        
        const supabase = createServiceClient();
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const now = new Date();
        const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
        
        console.log(`cleanup-deleted-accounts: Starting cleanup of accounts deleted before ${cutoffDate.toISOString()}`);

        // Find soft-deleted accounts older than retention period
        const { data: deletedAccounts, error: accountsError } = await supabase
            .from('accounts')
            .select('id, deleted_at, owner_user_id, name, company')
            .not('deleted_at', 'is', null)
            .lt('deleted_at', cutoffDate.toISOString())
            .limit(100); // Process in batches for safety

        if (accountsError) {
            console.error('cleanup-deleted-accounts: Error fetching deleted accounts:', accountsError);
            return NextResponse.json({ error: accountsError.message }, { status: 500 });
        }

        if (!deletedAccounts || deletedAccounts.length === 0) {
            console.log('cleanup-deleted-accounts: No accounts to clean up');
            return NextResponse.json({ 
                ok: true, 
                removedAccounts: 0, 
                message: 'No accounts to clean up',
                timestamp: now.toISOString()
            });
        }

        let removedCount = 0;
        let storageFilesRemoved = 0;
        const errors: string[] = [];

        for (const account of deletedAccounts) {
            try {
                console.log(`cleanup-deleted-accounts: Processing account ${account.id} (${account.name || account.company || 'Unnamed'}) deleted on ${account.deleted_at}`);

                // 1. Get all uploads for this account
                const { data: uploads, error: uploadsError } = await supabase
                    .from('uploads')
                    .select('id')
                    .eq('account_id', account.id);

                if (uploadsError) {
                    throw new Error(`Failed to fetch uploads: ${uploadsError.message}`);
                }

                // 2. Remove storage files for all uploads
                for (const upload of uploads || []) {
                    try {
                        const { data: fileList, error: listError } = await supabase.storage
                            .from(bucket)
                            .list(upload.id, { limit: 100 });
                        
                        if (listError) {
                            console.warn(`cleanup-deleted-accounts: Failed to list files for upload ${upload.id}: ${listError.message}`);
                            continue;
                        }

                        if (fileList && fileList.length > 0) {
                            const filePaths = fileList.map((f: any) => `${upload.id}/${f.name}`);
                            const { error: removeError } = await supabase.storage
                                .from(bucket)
                                .remove(filePaths);
                            
                            if (removeError) {
                                console.warn(`cleanup-deleted-accounts: Failed to remove storage files for upload ${upload.id}: ${removeError.message}`);
                            } else {
                                storageFilesRemoved += filePaths.length;
                                console.log(`cleanup-deleted-accounts: Removed ${filePaths.length} storage files for upload ${upload.id}`);
                            }
                        }
                    } catch (error: any) {
                        console.warn(`cleanup-deleted-accounts: Error processing storage for upload ${upload.id}: ${error.message}`);
                    }
                }

                // 3. Use RPC to purge all related data (snapshots, uploads, etc.)
                const { error: purgeError } = await supabase.rpc('purge_account_children', { 
                    p_account_id: account.id 
                });
                
                if (purgeError) {
                    throw new Error(`Failed to purge account children: ${purgeError.message}`);
                }

                // 4. Hard delete the account record
                const { error: deleteError } = await supabase
                    .from('accounts')
                    .delete()
                    .eq('id', account.id);
                
                if (deleteError) {
                    throw new Error(`Failed to delete account: ${deleteError.message}`);
                }

                // 5. Optionally delete the auth user (if single-account model)
                if (account.owner_user_id) {
                    try {
                        await (supabase as any).auth.admin.deleteUser(account.owner_user_id);
                        console.log(`cleanup-deleted-accounts: Deleted auth user ${account.owner_user_id} for account ${account.id}`);
                    } catch (error: any) {
                        console.warn(`cleanup-deleted-accounts: Failed to delete auth user ${account.owner_user_id}: ${error.message}`);
                        // Don't fail the whole operation for auth user deletion
                    }
                }

                removedCount++;
                console.log(`cleanup-deleted-accounts: Successfully removed account ${account.id}`);

            } catch (error: any) {
                const errorMsg = `Failed to remove account ${account.id}: ${error.message || 'Unknown error'}`;
                console.error('cleanup-deleted-accounts:', errorMsg);
                errors.push(errorMsg);
            }
        }

        const result = {
            ok: true,
            removedAccounts: removedCount,
            storageFilesRemoved,
            totalCandidates: deletedAccounts.length,
            retentionDays,
            errors,
            timestamp: now.toISOString()
        };

        console.log('cleanup-deleted-accounts: Cleanup completed', result);
        return NextResponse.json(result);

    } catch (e: any) {
        console.error('cleanup-deleted-accounts: Unexpected error:', e);
        return NextResponse.json({ 
            error: e?.message || 'Cleanup failed',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}
