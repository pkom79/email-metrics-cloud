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
            orphanedSnapshots: 0,
            timestamp: new Date().toISOString()
        };

        // Count uploads by status
        const { data: uploadCounts } = await supabase
            .from('uploads')
            .select('status, account_id')
            .neq('account_id', null);
        
        results.uploads = {
            total: uploadCounts?.length || 0,
            withAccounts: uploadCounts?.filter(u => u.account_id).length || 0,
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

        // Count accounts
        const { data: accountCounts } = await supabase
            .from('accounts')
            .select('id, deleted_at');
            
        results.accounts = {
            total: accountCounts?.length || 0,
            active: accountCounts?.filter(a => !a.deleted_at).length || 0,
            deleted: accountCounts?.filter(a => a.deleted_at).length || 0
        };

        // Check for orphaned data
        const { data: orphanedSnapshots } = await supabase
            .from('snapshots')
            .select('upload_id, account_id')
            .not('upload_id', 'in', 
                supabase.from('uploads').select('id')
            );

        results.orphanedSnapshots = orphanedSnapshots?.length || 0;

        return NextResponse.json(results);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Diagnostic failed' }, { status: 500 });
    }
}
