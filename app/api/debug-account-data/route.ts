import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // Check for snapshots under the account that has actual data
        const accountWithData = '19fdbfb9-33fc-47b2-83e1-6ce86d171900';
        
        const { data: snapshotsWithData, error: dataError } = await supabase
            .from('snapshots')
            .select('*')
            .eq('account_id', accountWithData);
            
        // Also check what accounts exist
        const { data: allAccounts, error: accountsError } = await supabase
            .from('accounts')
            .select('id, owner_user_id, name, company');
            
        // And check all unique account_ids in snapshots
        const { data: snapshotAccounts, error: snapError } = await supabase
            .from('snapshots')
            .select('account_id')
            .not('account_id', 'is', null);
            
        const uniqueSnapshotAccounts = [...new Set(snapshotAccounts?.map(s => s.account_id) || [])];
        
        return NextResponse.json({
            success: true,
            accountWithData,
            snapshotsInDataAccount: snapshotsWithData?.length || 0,
            snapshotsInDataAccountDetails: snapshotsWithData,
            dataAccountError: dataError?.message,
            allAccounts,
            accountsError: accountsError?.message,
            uniqueSnapshotAccounts,
            analysis: {
                hasSnapshotsForDataAccount: (snapshotsWithData?.length || 0) > 0,
                dataAccountExistsInDB: allAccounts?.some(a => a.id === accountWithData),
                snapshotAccountsCount: uniqueSnapshotAccounts.length
            }
        });
        
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
