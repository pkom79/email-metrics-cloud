import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { getServerUser } from '../../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Safe batch cleanup with guardrails to protect vital user data
// SAFETY RULES:
// 1. NEVER delete uploads that have snapshots (vital processed data)
// 2. NEVER delete bound/processing/processed uploads for active accounts
// 3. ONLY delete truly orphaned data (expired preauth, deleted accounts past retention)
// 4. Always verify relationships before deletion
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
        const retentionDays = parseInt(process.env.ACCOUNT_RETENTION_DAYS || '30');
        
        const results = {
            orphanedPreauth: 0,
            oldUploads: 0,
            deletedAccounts: 0,
            orphanedSnapshots: 0,
            errors: [] as string[],
            protected: 0 // Count of uploads protected by guardrails
        };

        console.log('cleanup-batch: Starting SAFE cleanup with guardrails at', now.toISOString());

        // 0. SAFE: Clean up very old expired records (audit retention cleanup)
        try {
            console.log('cleanup-batch: Phase 0 - Old expired records cleanup');
            
            // Delete expired records older than 7 days (keep recent ones for audit)
            const expiredCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            const { data: oldExpired, error: oldExpiredError } = await supabase
                .from('uploads')
                .select('id')
                .eq('status', 'expired')
                .lt('updated_at', expiredCutoff.toISOString())
                .limit(50);
            
            if (oldExpiredError) throw oldExpiredError;
            
            console.log(`cleanup-batch: Found ${oldExpired?.length || 0} old expired records to remove`);
            
            for (const record of oldExpired || []) {
                try {
                    // These are already expired and storage files should be gone, just remove the record
                    const { error: deleteError } = await supabase
                        .from('uploads')
                        .delete()
                        .eq('id', record.id);
                    
                    if (deleteError) {
                        console.error(`cleanup-batch: Failed to delete old expired record ${record.id}:`, deleteError);
                        results.errors.push(`Failed to delete old expired record ${record.id}: ${deleteError.message}`);
                        continue;
                    }
                    
                    results.orphanedPreauth++;
                    console.log(`cleanup-batch: Removed old expired record ${record.id}`);
                } catch (error: any) {
                    console.error(`cleanup-batch: Error removing old expired record ${record.id}:`, error);
                    results.errors.push(`Failed to remove old expired record ${record.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error cleaning old expired records:', error);
            results.errors.push(`Failed to clean old expired records: ${error.message || 'Unknown error'}`);
        }

        // 1. SAFE: Clean up orphaned preauth uploads (never linked to account, expired)
        try {
            console.log('cleanup-batch: Phase 1 - Orphaned preauth uploads');
            
            const { data: orphanedRows, error: orphanedError } = await supabase
                .from('uploads')
                .select('id, expires_at, created_at, status')
                .eq('status', 'preauth')
                .is('account_id', null)
                .lt('expires_at', now.toISOString())
                .limit(100);
            
            if (orphanedError) throw orphanedError;

            console.log(`cleanup-batch: Found ${orphanedRows?.length || 0} orphaned preauth uploads`);

            for (const row of orphanedRows || []) {
                try {
                    console.log(`cleanup-batch: Cleaning orphaned preauth upload ${row.id}`);
                    
                    // Double-check: Ensure no snapshots exist (safety guardrail)
                    const { data: hasSnapshots } = await supabase
                        .from('snapshots')
                        .select('id')
                        .eq('upload_id', row.id)
                        .limit(1);
                    
                    if (hasSnapshots && hasSnapshots.length > 0) {
                        console.log(`cleanup-batch: PROTECTED - Upload ${row.id} has snapshots, skipping`);
                        results.protected++;
                        continue;
                    }
                    
                    // Safe to remove storage files
                    const { data: list } = await supabase.storage.from(bucket).list(row.id, { limit: 100 });
                    if (list && list.length) {
                        const paths = list.map((f: any) => `${row.id}/${f.name}`);
                        const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
                        if (removeError) {
                            console.error(`cleanup-batch: Storage removal failed for ${row.id}:`, removeError);
                            results.errors.push(`Storage cleanup failed for ${row.id}: ${removeError.message}`);
                            continue;
                        }
                    }
                    
                    // Mark as expired (keep record for audit)
                    const { error: updateError } = await supabase
                        .from('uploads')
                        .update({ status: 'expired' })
                        .eq('id', row.id);
                    
                    if (updateError) {
                        console.error(`cleanup-batch: Status update failed for ${row.id}:`, updateError);
                        results.errors.push(`Status update failed for ${row.id}: ${updateError.message}`);
                        continue;
                    }
                    
                    results.orphanedPreauth++;
                    console.log(`cleanup-batch: Successfully cleaned orphaned preauth upload ${row.id}`);
                } catch (error: any) {
                    console.error(`cleanup-batch: Error processing orphaned upload ${row.id}:`, error);
                    results.errors.push(`Failed to process orphaned upload ${row.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error in orphaned preauth cleanup:', error);
            results.errors.push(`Failed to clean orphaned preauth uploads: ${error.message || 'Unknown error'}`);
        }

        // 2. SAFE: Clean up old uploads for active accounts (keep most recent WITH snapshots)
        try {
            console.log('cleanup-batch: Phase 2 - Old uploads for active accounts');
            
            // Get active accounts with multiple uploads that have snapshots
            const { data: accountsWithMultipleUploads, error: accountsError } = await supabase
                .from('uploads')
                .select(`
                    account_id, 
                    id, 
                    created_at, 
                    status,
                    snapshots!inner(id)
                `)
                .not('account_id', 'is', null)
                .in('status', ['bound', 'processing', 'processed'])
                .order('account_id, created_at', { ascending: false });

            if (accountsError) throw accountsError;

            // Group uploads by account and find excess uploads
            const accountUploads = new Map<string, any[]>();
            for (const upload of accountsWithMultipleUploads || []) {
                if (!accountUploads.has(upload.account_id)) {
                    accountUploads.set(upload.account_id, []);
                }
                accountUploads.get(upload.account_id)!.push(upload);
            }

            console.log(`cleanup-batch: Found ${accountUploads.size} accounts with processed uploads`);

            // For each account, keep only the most recent upload with snapshots
            for (const [accountId, uploads] of accountUploads) {
                if (uploads.length <= 1) continue; // Keep single uploads

                // Verify account is still active (safety guardrail)
                const { data: account } = await supabase
                    .from('accounts')
                    .select('id, deleted_at')
                    .eq('id', accountId)
                    .single();

                if (!account || account.deleted_at) {
                    console.log(`cleanup-batch: PROTECTED - Account ${accountId} is deleted/missing, skipping upload cleanup`);
                    results.protected += uploads.length;
                    continue;
                }

                // Sort by created_at descending, keep first (most recent)
                uploads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                const toDelete = uploads.slice(1); // All except the first (most recent)

                console.log(`cleanup-batch: Account ${accountId} has ${uploads.length} uploads, removing ${toDelete.length} old ones`);

                for (const upload of toDelete) {
                    try {
                        // Final safety check: Ensure this isn't the only upload with snapshots
                        const { data: accountSnapshots } = await supabase
                            .from('snapshots')
                            .select('upload_id')
                            .eq('account_id', accountId);

                        const uploadsWithSnapshots = new Set(accountSnapshots?.map(s => s.upload_id));
                        
                        if (uploadsWithSnapshots.size <= 1 && uploadsWithSnapshots.has(upload.id)) {
                            console.log(`cleanup-batch: PROTECTED - Upload ${upload.id} is the only one with snapshots for account ${accountId}`);
                            results.protected++;
                            continue;
                        }

                        // Safe to remove this old upload
                        console.log(`cleanup-batch: Removing old upload ${upload.id} for account ${accountId}`);

                        // Remove storage files
                        const { data: list } = await supabase.storage.from(bucket).list(upload.id, { limit: 100 });
                        if (list && list.length) {
                            const paths = list.map((f: any) => `${upload.id}/${f.name}`);
                            await supabase.storage.from(bucket).remove(paths);
                        }

                        // Remove related snapshots
                        await supabase.from('snapshots').delete().eq('upload_id', upload.id);
                        
                        // Remove the upload record
                        await supabase.from('uploads').delete().eq('id', upload.id);
                        
                        results.oldUploads++;
                        console.log(`cleanup-batch: Successfully removed old upload ${upload.id} for account ${accountId}`);
                    } catch (error: any) {
                        console.error(`cleanup-batch: Error removing old upload ${upload.id}:`, error);
                        results.errors.push(`Failed to remove old upload ${upload.id}: ${error.message || 'Unknown error'}`);
                    }
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error cleaning old uploads:', error);
            results.errors.push(`Failed to clean old uploads: ${error.message || 'Unknown error'}`);
        }

        // 3. SAFE: Clean up data for permanently deleted accounts (past retention period)
        try {
            console.log('cleanup-batch: Phase 3 - Permanently deleted accounts');
            
            const retentionCutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
            
            const { data: deletedAccounts, error: deletedError } = await supabase
                .from('accounts')
                .select('id, deleted_at')
                .not('deleted_at', 'is', null)
                .lt('deleted_at', retentionCutoff.toISOString())
                .limit(10); // Process in small batches

            if (deletedError) throw deletedError;

            console.log(`cleanup-batch: Found ${deletedAccounts?.length || 0} accounts past retention period`);

            for (const account of deletedAccounts || []) {
                try {
                    console.log(`cleanup-batch: Permanently removing soft-deleted account ${account.id} (deleted: ${account.deleted_at})`);
                    
                    // Get all uploads for this account
                    const { data: uploads } = await supabase
                        .from('uploads')
                        .select('id')
                        .eq('account_id', account.id);

                    console.log(`cleanup-batch: Account ${account.id} has ${uploads?.length || 0} uploads to clean`);

                    // Remove storage files for all uploads
                    for (const upload of uploads || []) {
                        try {
                            const { data: list } = await supabase.storage.from(bucket).list(upload.id, { limit: 100 });
                            if (list && list.length) {
                                const paths = list.map((f: any) => `${upload.id}/${f.name}`);
                                await supabase.storage.from(bucket).remove(paths);
                                console.log(`cleanup-batch: Removed storage for upload ${upload.id}`);
                            }
                        } catch (error: any) {
                            console.error(`cleanup-batch: Error removing storage for upload ${upload.id}:`, error);
                            results.errors.push(`Storage cleanup failed for upload ${upload.id}: ${error.message}`);
                        }
                    }

                    // Use RPC to purge all related data safely
                    const { error: purgeError } = await supabase.rpc('purge_account_children', { 
                        p_account_id: account.id 
                    });
                    
                    if (purgeError) {
                        console.error(`cleanup-batch: RPC purge failed for account ${account.id}:`, purgeError);
                        results.errors.push(`RPC purge failed for account ${account.id}: ${purgeError.message}`);
                        continue;
                    }
                    
                    // Hard delete the account
                    const { error: deleteError } = await supabase
                        .from('accounts')
                        .delete()
                        .eq('id', account.id);
                    
                    if (deleteError) {
                        console.error(`cleanup-batch: Account deletion failed for ${account.id}:`, deleteError);
                        results.errors.push(`Account deletion failed for ${account.id}: ${deleteError.message}`);
                        continue;
                    }
                    
                    results.deletedAccounts++;
                    console.log(`cleanup-batch: Successfully removed account ${account.id} and all related data`);
                } catch (error: any) {
                    console.error(`cleanup-batch: Error removing deleted account ${account.id}:`, error);
                    results.errors.push(`Failed to remove deleted account ${account.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error cleaning deleted accounts:', error);
            results.errors.push(`Failed to clean deleted accounts: ${error.message || 'Unknown error'}`);
        }

        // 4. SAFE: Clean up orphaned snapshots (upload no longer exists)
        try {
            console.log('cleanup-batch: Phase 4 - Orphaned snapshots');
            
            const { data: orphanedSnapshots, error: orphanedSnapshotsError } = await supabase
                .from('snapshots')
                .select('id, upload_id, account_id')
                .not('upload_id', 'in', 
                    supabase.from('uploads').select('id')
                )
                .limit(100);

            if (orphanedSnapshotsError) throw orphanedSnapshotsError;

            console.log(`cleanup-batch: Found ${orphanedSnapshots?.length || 0} orphaned snapshots`);

            for (const snapshot of orphanedSnapshots || []) {
                try {
                    // Double-check that the upload really doesn't exist
                    const { data: uploadExists } = await supabase
                        .from('uploads')
                        .select('id')
                        .eq('id', snapshot.upload_id)
                        .single();

                    if (uploadExists) {
                        console.log(`cleanup-batch: PROTECTED - Upload ${snapshot.upload_id} exists, keeping snapshot ${snapshot.id}`);
                        results.protected++;
                        continue;
                    }

                    // Safe to remove orphaned snapshot
                    const { error: deleteError } = await supabase
                        .from('snapshots')
                        .delete()
                        .eq('id', snapshot.id);

                    if (deleteError) {
                        console.error(`cleanup-batch: Failed to delete orphaned snapshot ${snapshot.id}:`, deleteError);
                        results.errors.push(`Failed to delete orphaned snapshot ${snapshot.id}: ${deleteError.message}`);
                        continue;
                    }

                    results.orphanedSnapshots++;
                    console.log(`cleanup-batch: Removed orphaned snapshot ${snapshot.id} for missing upload ${snapshot.upload_id}`);
                } catch (error: any) {
                    console.error(`cleanup-batch: Error processing orphaned snapshot ${snapshot.id}:`, error);
                    results.errors.push(`Failed to process orphaned snapshot ${snapshot.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error cleaning orphaned snapshots:', error);
            results.errors.push(`Failed to clean orphaned snapshots: ${error.message || 'Unknown error'}`);
        }

        console.log('cleanup-batch: SAFE cleanup completed with guardrails', {
            ...results,
            summary: {
                totalCleaned: results.orphanedPreauth + results.oldUploads + results.deletedAccounts + results.orphanedSnapshots,
                totalProtected: results.protected,
                totalErrors: results.errors.length
            }
        });
        
        return NextResponse.json({ 
            ok: true, 
            ...results,
            summary: `Cleaned ${results.orphanedPreauth + results.oldUploads + results.deletedAccounts + results.orphanedSnapshots} items, protected ${results.protected} vital uploads`,
            timestamp: now.toISOString(),
            retentionDays
        });
    } catch (e: any) {
        console.error('cleanup-batch: Unexpected error:', e);
        return NextResponse.json({ error: e?.message || 'Cleanup failed' }, { status: 500 });
    }
}
