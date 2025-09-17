import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';
import { getServerUser } from '../../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Clean up orphaned accounts (accounts in database without corresponding auth users)
export async function POST() {
    try {
        const user = await getServerUser();
        // Allow anonymous (cron) or admin; if user present and not admin -> forbid
        if (user && user.app_metadata?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const supabase = createServiceClient();
        const now = new Date();
        
        const results = {
            orphanedAccounts: 0,
            removedUploads: 0,
            removedSnapshots: 0,
            errors: [] as string[]
        };

        console.log('cleanup-orphaned: Starting orphaned accounts cleanup at', now.toISOString());

        try {
            // Get all accounts from database
            const { data: dbAccounts, error: accountsError } = await supabase
                .from('accounts')
                .select('id, owner_user_id, deleted_at');
            
            if (accountsError) throw accountsError;

            // Get all auth users
            const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
            if (authError) throw authError;

            const authUserIds = new Set(authUsers.users.map((u: any) => u.id));
            
            // Find accounts without corresponding auth users
            const orphanedAccounts = dbAccounts.filter(
                (account: any) => !authUserIds.has(account.owner_user_id)
            );

            console.log(`cleanup-orphaned: Found ${orphanedAccounts.length} orphaned accounts`);

            for (const account of orphanedAccounts) {
                try {
                    console.log(`cleanup-orphaned: Removing orphaned account ${account.id} (auth user: ${account.owner_user_id})`);
                    
                    // Get uploads for this account
                    const { data: uploads } = await supabase
                        .from('uploads')
                        .select('id')
                        .eq('account_id', account.id);

                    // Remove storage files for all uploads
                    const bucket = ingestBucketName();
                    for (const upload of uploads || []) {
                        try {
                            const { data: list } = await supabase.storage.from(bucket).list(upload.id, { limit: 100 });
                            if (list && list.length) {
                                const paths = list.map((f: any) => `${upload.id}/${f.name}`);
                                await supabase.storage.from(bucket).remove(paths);
                            }
                        } catch (error: any) {
                            console.error(`cleanup-orphaned: Error removing storage for upload ${upload.id}:`, error);
                        }
                    }

                    // Remove snapshots for this account
                    const { data: snapshots, error: snapshotDeleteError } = await supabase
                        .from('snapshots')
                        .delete()
                        .eq('account_id', account.id)
                        .select('id');
                    
                    if (snapshotDeleteError) {
                        console.error(`cleanup-orphaned: Error removing snapshots for account ${account.id}:`, snapshotDeleteError);
                        results.errors.push(`Failed to remove snapshots for account ${account.id}: ${snapshotDeleteError.message}`);
                    } else {
                        results.removedSnapshots += snapshots?.length || 0;
                    }

                    // Remove uploads for this account
                    const { data: deletedUploads, error: uploadDeleteError } = await supabase
                        .from('uploads')
                        .delete()
                        .eq('account_id', account.id)
                        .select('id');
                    
                    if (uploadDeleteError) {
                        console.error(`cleanup-orphaned: Error removing uploads for account ${account.id}:`, uploadDeleteError);
                        results.errors.push(`Failed to remove uploads for account ${account.id}: ${uploadDeleteError.message}`);
                    } else {
                        results.removedUploads += deletedUploads?.length || 0;
                    }

                    // Remove the account itself
                    const { error: accountDeleteError } = await supabase
                        .from('accounts')
                        .delete()
                        .eq('id', account.id);
                    
                    if (accountDeleteError) {
                        console.error(`cleanup-orphaned: Error removing account ${account.id}:`, accountDeleteError);
                        results.errors.push(`Failed to remove account ${account.id}: ${accountDeleteError.message}`);
                        continue;
                    }
                    
                    results.orphanedAccounts++;
                    console.log(`cleanup-orphaned: Successfully removed orphaned account ${account.id}`);
                } catch (error: any) {
                    console.error(`cleanup-orphaned: Error processing orphaned account ${account.id}:`, error);
                    results.errors.push(`Failed to process orphaned account ${account.id}: ${error.message || 'Unknown error'}`);
                }
            }
        } catch (error: any) {
            console.error('cleanup-orphaned: Error during orphaned accounts cleanup:', error);
            results.errors.push(`Orphaned accounts cleanup failed: ${error.message || 'Unknown error'}`);
        }

        console.log('cleanup-orphaned: Cleanup completed', results);
        return NextResponse.json({ 
            ok: true, 
            ...results,
            timestamp: now.toISOString()
        });
    } catch (e: any) {
        console.error('cleanup-orphaned: Unexpected error:', e);
        return NextResponse.json({ error: e?.message || 'Orphaned cleanup failed' }, { status: 500 });
    }
}
