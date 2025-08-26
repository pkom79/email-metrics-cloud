import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // Check for snapshots without corresponding accounts
        const { data: orphanedSnapshots, error: snapshotError } = await supabase
            .from('snapshots')
            .select(`
                account_id, 
                upload_id, 
                created_at,
                accounts!inner(id, owner_user_id)
            `)
            .limit(10);

        if (snapshotError) {
            console.error('Error fetching snapshots:', snapshotError);
        }

        // Get all snapshots with account info
        const { data: allSnapshots, error: allSnapshotsError } = await supabase
            .from('snapshots')
            .select('account_id, upload_id, created_at')
            .limit(20);

        // Get all accounts
        const { data: accounts, error: accountsError } = await supabase
            .from('accounts')
            .select('id, owner_user_id');

        // Get auth user for pkom79@gmail.com
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
        
        const pkomUser = authUsers?.users?.find(u => u.email === 'pkom79@gmail.com');

        const result = {
            snapshotsWithAccounts: orphanedSnapshots || [],
            allSnapshots: allSnapshots || [],
            totalSnapshots: allSnapshots?.length || 0,
            accounts: accounts || [],
            totalAccounts: accounts?.length || 0,
            pkomAuthUser: pkomUser ? {
                id: pkomUser.id,
                email: pkomUser.email,
                created_at: pkomUser.created_at
            } : null,
            snapshotError: snapshotError?.message || null,
            accountsError: accountsError?.message || null,
            authError: authError?.message || null,
            timestamp: new Date().toISOString()
        };

        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Recovery diagnostic failed' }, { status: 500 });
    }
}
