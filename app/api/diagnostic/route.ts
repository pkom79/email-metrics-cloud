import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // Check what data still exists
        const results = {
            uploads: {},
            snapshots: {},
            accounts: {},
            authUsers: {},
            orphanedData: {},
            timestamp: new Date().toISOString()
        };

        // Count uploads by status
        const { data: uploadCounts } = await supabase
            .from('uploads')
            .select('id, status, account_id');
        
        results.uploads = {
            total: uploadCounts?.length || 0,
            withAccounts: uploadCounts?.filter(u => u.account_id).length || 0,
            withoutAccounts: uploadCounts?.filter(u => !u.account_id).length || 0,
            byStatus: uploadCounts?.reduce((acc: any, u) => {
                acc[u.status] = (acc[u.status] || 0) + 1;
                return acc;
            }, {}) || {}
        };

        // Count snapshots by account
        const { data: snapshotCounts } = await supabase
            .from('snapshots')
            .select('account_id, upload_id');
            
        results.snapshots = {
            total: snapshotCounts?.length || 0,
            uniqueAccounts: new Set(snapshotCounts?.map(s => s.account_id)).size || 0,
            uniqueUploads: new Set(snapshotCounts?.map(s => s.upload_id)).size || 0
        };

        // Count accounts in public.accounts
        const { data: accountCounts } = await supabase
            .from('accounts')
            .select('id, owner_user_id, deleted_at, created_at');
            
        results.accounts = {
            total: accountCounts?.length || 0,
            active: accountCounts?.filter(a => !a.deleted_at).length || 0,
            deleted: accountCounts?.filter(a => a.deleted_at).length || 0,
            list: accountCounts?.map(a => ({
                id: a.id,
                owner_user_id: a.owner_user_id,
                deleted_at: a.deleted_at,
                created_at: a.created_at
            })) || []
        };

        // Count auth users
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
        
        if (authError) {
            results.authUsers = { error: authError.message };
        } else {
            results.authUsers = {
                total: authUsers.users?.length || 0,
                list: authUsers.users?.map(u => ({
                    id: u.id,
                    email: u.email,
                    created_at: u.created_at,
                    role: u.app_metadata?.role
                })) || []
            };
        }

        // Find orphaned data
        const orphaned = {
            accountsWithoutAuthUsers: [] as any[],
            authUsersWithoutAccounts: [] as any[],
            snapshotsWithoutUploads: 0,
            snapshotsWithoutAccounts: 0
        };

        if (!authError && accountCounts && authUsers.users) {
            const authUserIds = new Set(authUsers.users.map(u => u.id));
            const accountUserIds = new Set(accountCounts.map(a => a.owner_user_id));

            // Find accounts without corresponding auth users
            orphaned.accountsWithoutAuthUsers = accountCounts.filter(
                a => !authUserIds.has(a.owner_user_id)
            );

            // Find auth users without corresponding accounts
            orphaned.authUsersWithoutAccounts = authUsers.users.filter(
                u => !accountUserIds.has(u.id)
            );
        }

        // Find snapshots without uploads
        if (snapshotCounts && uploadCounts) {
            const uploadIds = new Set(uploadCounts.map(u => u.id));
            const accountIds = new Set(accountCounts?.map(a => a.id));
            
            orphaned.snapshotsWithoutUploads = snapshotCounts.filter(
                s => !uploadIds.has(s.upload_id)
            ).length;
            
            orphaned.snapshotsWithoutAccounts = snapshotCounts.filter(
                s => !accountIds.has(s.account_id)
            ).length;
        }

        results.orphanedData = orphaned;

        return NextResponse.json(results);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Diagnostic failed' }, { status: 500 });
    }
}
