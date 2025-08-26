import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Debug endpoint to check orphaned accounts detection
export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // Get all accounts from database
        const { data: dbAccounts, error: accountsError } = await supabase
            .from('accounts')
            .select('id, owner_user_id, deleted_at');
        
        if (accountsError) {
            return NextResponse.json({ error: 'Failed to get accounts', details: accountsError }, { status: 500 });
        }

        // Try to get auth users
        const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
        
        const result = {
            dbAccounts: dbAccounts?.length || 0,
            dbAccountsList: dbAccounts || [],
            authUsersSuccess: !authError,
            authUsersCount: authData?.users?.length || 0,
            authError: authError ? authError.message : null,
            authUsers: authData?.users || [],
            timestamp: new Date().toISOString()
        };

        if (authError) {
            console.error('Auth admin access error:', authError);
        }

        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Debug failed' }, { status: 500 });
    }
}
