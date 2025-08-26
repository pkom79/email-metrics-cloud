import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { getServerUser } from '../../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Enhanced batch cleanup for expired preauth uploads and general housekeeping
// - Cleans up expired preauth uploads (>24h or past expires_at)
// - Cleans up old uploads for active accounts (keeps only most recent per account)
// - Cleans up soft-deleted accounts older than 30 days
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
        
        const results = {
            expiredPreauth: 0,
            oldUploads: 0,
            deletedAccounts: 0,
            errors: [] as string[]
        };

        console.log('cleanup-batch: Starting comprehensive cleanup at', now.toISOString());

        // 1. Clean up expired preauth uploads (older than expires_at or >24h)
        try {
            const { data: expiredRows, error: expiredError } = await supabase
                .from('uploads')
                .select('id,expires_at,created_at')
                .eq('status', 'preauth')
                .lt('expires_at', now.toISOString())
                .limit(100);
            
            if (expiredError) throw expiredError;

            for (const row of expiredRows || []) {
                try {
                    console.log(`cleanup-batch: Cleaning expired preauth upload ${row.id}`);
                    
                    // Remove storage files
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
                    
                    // Mark as expired
                    const { error: updateError } = await supabase
                        .from('uploads')
                        .update({ status: 'expired' })
                        .eq('id', row.id);
                    
                    if (updateError) {
                        console.error(`cleanup-batch: Status update failed for ${row.id}:`, updateError);
                        results.errors.push(`Status update failed for ${row.id}: ${updateError.message}`);
                        continue;
                    }
                    
                    results.expiredPreauth++;
                    console.log(`cleanup-batch: Successfully cleaned expired preauth upload ${row.id}`);
                } catch (error: any) {
                    console.error(`cleanup-batch: Error processing expired upload ${row.id}:`, error);
                    results.errors.push(`Failed to process expired upload ${row.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error fetching expired preauth uploads:', error);
            results.errors.push(`Failed to fetch expired uploads: ${error.message || 'Unknown error'}`);
        }

        // 2. Clean up old uploads for active accounts (keep only most recent upload per account)
        try {
            // Get accounts with multiple uploads
            const { data: accountsWithUploads, error: accountsError } = await supabase
                .from('uploads')
                .select('account_id, id, created_at, status')
                .not('account_id', 'is', null)
                .in('status', ['bound', 'processing', 'processed'])
                .order('account_id, created_at', { ascending: false });

            if (accountsError) throw accountsError;

            const accountUploads = new Map<string, any[]>();
            for (const upload of accountsWithUploads || []) {
                if (!accountUploads.has(upload.account_id)) {
                    accountUploads.set(upload.account_id, []);
                }
                accountUploads.get(upload.account_id)!.push(upload);
            }

            // For each account, keep only the most recent upload
            for (const [accountId, uploads] of accountUploads) {
                if (uploads.length <= 1) continue; // Keep single uploads

                // Sort by created_at descending, keep first (most recent)
                uploads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                const toDelete = uploads.slice(1); // All except the first (most recent)

                console.log(`cleanup-batch: Account ${accountId} has ${uploads.length} uploads, removing ${toDelete.length} old ones`);

                for (const upload of toDelete) {
                    try {
                        // Remove storage files
                        const { data: list } = await supabase.storage.from(bucket).list(upload.id, { limit: 100 });
                        if (list && list.length) {
                            const paths = list.map((f: any) => `${upload.id}/${f.name}`);
                            await supabase.storage.from(bucket).remove(paths);
                        }

                        // Remove related snapshots and their data
                        await supabase.from('snapshots').delete().eq('upload_id', upload.id);
                        
                        // Remove the upload record
                        await supabase.from('uploads').delete().eq('id', upload.id);
                        
                        results.oldUploads++;
                        console.log(`cleanup-batch: Removed old upload ${upload.id} for account ${accountId}`);
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

        // 3. Clean up soft-deleted accounts older than 30 days
        try {
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            
            const { data: deletedAccounts, error: deletedError } = await supabase
                .from('accounts')
                .select('id, deleted_at')
                .not('deleted_at', 'is', null)
                .lt('deleted_at', thirtyDaysAgo.toISOString())
                .limit(50);

            if (deletedError) throw deletedError;

            for (const account of deletedAccounts || []) {
                try {
                    console.log(`cleanup-batch: Permanently removing soft-deleted account ${account.id}`);
                    
                    // Get uploads for this account
                    const { data: uploads } = await supabase
                        .from('uploads')
                        .select('id')
                        .eq('account_id', account.id);

                    // Remove storage files for all uploads
                    for (const upload of uploads || []) {
                        try {
                            const { data: list } = await supabase.storage.from(bucket).list(upload.id, { limit: 100 });
                            if (list && list.length) {
                                const paths = list.map((f: any) => `${upload.id}/${f.name}`);
                                await supabase.storage.from(bucket).remove(paths);
                            }
                        } catch (error: any) {
                            console.error(`cleanup-batch: Error removing storage for upload ${upload.id}:`, error);
                        }
                    }

                    // Use RPC to purge all related data
                    await supabase.rpc('purge_account_children', { p_account_id: account.id });
                    
                    // Hard delete the account
                    await supabase.from('accounts').delete().eq('id', account.id);
                    
                    results.deletedAccounts++;
                    console.log(`cleanup-batch: Permanently removed account ${account.id}`);
                } catch (error: any) {
                    console.error(`cleanup-batch: Error removing deleted account ${account.id}:`, error);
                    results.errors.push(`Failed to remove deleted account ${account.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-batch: Error cleaning deleted accounts:', error);
            results.errors.push(`Failed to clean deleted accounts: ${error.message || 'Unknown error'}`);
        }

        console.log('cleanup-batch: Cleanup completed', results);
        return NextResponse.json({ 
            ok: true, 
            ...results,
            timestamp: now.toISOString()
        });
    } catch (e: any) {
        console.error('cleanup-batch: Unexpected error:', e);
        return NextResponse.json({ error: e?.message || 'Cleanup failed' }, { status: 500 });
    }
}
