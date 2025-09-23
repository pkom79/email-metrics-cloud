import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';
import { getServerUser } from '../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Recover missing account records for users who have orphaned snapshots
export async function POST(request: Request) {
    try {
        const url = new URL(request.url);
        const ADMIN_SECRET = (globalThis as any).process?.env?.ADMIN_JOB_SECRET || process.env.ADMIN_JOB_SECRET;
        const provided = (request.headers.get('x-admin-job-secret') || '').trim();
        const bearer = (request.headers.get('authorization') || '').trim();
        const bearerToken = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
        const token = url.searchParams.get('token') || '';
        const user = await getServerUser();
        const isAdmin = !!user && (user as any).app_metadata?.role === 'admin';
        const hasSecret = !!ADMIN_SECRET && (provided === ADMIN_SECRET || token === ADMIN_SECRET || bearerToken === ADMIN_SECRET);
        if (!isAdmin && !hasSecret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = createServiceClient();
        
        const results = {
            recoveredAccounts: 0,
            orphanedSnapshots: 0,
            errors: [] as string[]
        };

        console.log('data-recovery: Starting data recovery process');

        // Get all snapshots
        const { data: snapshots, error: snapshotsError } = await supabase
            .from('snapshots')
            .select('account_id, upload_id, created_at')
            .limit(100);

        if (snapshotsError) {
            results.errors.push(`Failed to fetch snapshots: ${snapshotsError.message}`);
            return NextResponse.json(results, { status: 500 });
        }

        // Get unique account IDs from snapshots
    const snapshotAccountIds = new Set(snapshots?.map((s: any) => s.account_id) || []);
        
        // Get existing accounts
        const { data: existingAccounts, error: accountsError } = await supabase
            .from('accounts')
            .select('id');

        if (accountsError) {
            results.errors.push(`Failed to fetch accounts: ${accountsError.message}`);
            return NextResponse.json(results, { status: 500 });
        }

    const existingAccountIds = new Set(existingAccounts?.map((a: any) => a.id) || []);

        // Find orphaned snapshots (account_id not in accounts table)
        const orphanedAccountIds = Array.from(snapshotAccountIds).filter(
            (accountId: any) => !existingAccountIds.has(accountId)
        );

        console.log(`data-recovery: Found ${orphanedAccountIds.length} orphaned account IDs`);
        results.orphanedSnapshots = orphanedAccountIds.length;

        // Get auth users to match with orphaned accounts
        const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
        
        if (authError) {
            results.errors.push(`Failed to fetch auth users: ${authError.message}`);
            return NextResponse.json(results, { status: 500 });
        }

        const authUsers = authData?.users || [];

        // For each orphaned account ID, try to find the corresponding auth user
        for (const orphanedAccountId of orphanedAccountIds) {
            try {
                console.log(`data-recovery: Processing orphaned account ${orphanedAccountId}`);
                
                // Get uploads for this account ID to see when it was created and by whom
                const { data: uploads, error: uploadsError } = await supabase
                    .from('uploads')
                    .select('id, created_at, status')
                    .eq('account_id', orphanedAccountId)
                    .order('created_at', { ascending: true })
                    .limit(1);

                if (uploadsError) {
                    console.error(`data-recovery: Error fetching uploads for ${orphanedAccountId}:`, uploadsError);
                    continue;
                }

                // If no uploads found, check if this is a recent auth user without account
                if (!uploads || uploads.length === 0) {
                    // Try to match by checking recent auth users
                    const pkomUser = authUsers.find((u: any) => u.email === 'pkom79@gmail.com');
                    
                    if (pkomUser) {
                        console.log(`data-recovery: Creating missing account for ${pkomUser.email}`);
                        
                        const { error: createError } = await supabase
                            .from('accounts')
                            .insert({
                                id: orphanedAccountId,
                                owner_user_id: pkomUser.id,
                                name: pkomUser.user_metadata?.businessName || 'Recovered Account',
                                company: pkomUser.user_metadata?.businessName || null,
                                country: pkomUser.user_metadata?.country || null,
                                created_at: new Date().toISOString()
                            });

                        if (createError) {
                            console.error(`data-recovery: Failed to create account for ${pkomUser.email}:`, createError);
                            results.errors.push(`Failed to create account for ${pkomUser.email}: ${createError.message}`);
                        } else {
                            results.recoveredAccounts++;
                            console.log(`data-recovery: Successfully recovered account for ${pkomUser.email}`);
                        }
                    }
                }
            } catch (error: any) {
                console.error(`data-recovery: Error processing orphaned account ${orphanedAccountId}:`, error);
                results.errors.push(`Failed to process orphaned account ${orphanedAccountId}: ${error.message || 'Unknown error'}`);
            }
        }

        console.log('data-recovery: Recovery completed', results);
        return NextResponse.json({ 
            ok: true, 
            ...results,
            timestamp: new Date().toISOString()
        });
    } catch (e: any) {
        console.error('data-recovery: Unexpected error:', e);
        return NextResponse.json({ error: e?.message || 'Data recovery failed' }, { status: 500 });
    }
}
