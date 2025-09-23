import { NextResponse } from 'next/server';
import { getServerUser } from '../../../lib/supabase/auth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

// Master cleanup endpoint that orchestrates all cleanup operations
// This can be called by a single cron job to handle all maintenance
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

        const body = await request.json().catch(() => ({}));
        const {
            skipExpiredPreauth = false,
            skipOldUploads = false, 
            skipDeletedAccounts = false,
            retentionDays = parseInt(process.env.DELETED_ACCOUNT_RETENTION_DAYS || '30')
        } = body;

        const baseUrl = new URL(request.url).origin;
        const results = {
            timestamp: new Date().toISOString(),
            operations: {} as Record<string, any>
        };

        console.log('cleanup-master: Starting comprehensive cleanup operations');

        // 1. Clean up expired preauth uploads
        if (!skipExpiredPreauth) {
            try {
                console.log('cleanup-master: Running expired preauth cleanup');
                const response = await fetch(new URL('/api/preauth/cleanup-batch', baseUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(ADMIN_SECRET ? { 'x-admin-job-secret': ADMIN_SECRET } : {}) }
                });
                
                if (response.ok) {
                    results.operations.expiredPreauth = await response.json();
                } else {
                    const error = await response.text().catch(() => 'Unknown error');
                    results.operations.expiredPreauth = { 
                        error: `HTTP ${response.status}: ${error}` 
                    };
                }
            } catch (error: any) {
                console.error('cleanup-master: Expired preauth cleanup failed:', error);
                results.operations.expiredPreauth = { 
                    error: error.message || 'Cleanup failed' 
                };
            }
        }

        // 2. Clean up old uploads for active accounts
        if (!skipOldUploads) {
            try {
                console.log('cleanup-master: Running old uploads cleanup');
                const response = await fetch(new URL('/api/uploads/cleanup-old', baseUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(ADMIN_SECRET ? { 'x-admin-job-secret': ADMIN_SECRET } : {}) }
                });
                
                if (response.ok) {
                    results.operations.oldUploads = await response.json();
                } else {
                    const error = await response.text().catch(() => 'Unknown error');
                    results.operations.oldUploads = { 
                        error: `HTTP ${response.status}: ${error}` 
                    };
                }
            } catch (error: any) {
                console.error('cleanup-master: Old uploads cleanup failed:', error);
                results.operations.oldUploads = { 
                    error: error.message || 'Cleanup failed' 
                };
            }
        }

        // 3. Clean up soft-deleted accounts
        if (!skipDeletedAccounts) {
            try {
                console.log('cleanup-master: Running deleted accounts cleanup');
                const response = await fetch(new URL('/api/accounts/cleanup-deleted', baseUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(ADMIN_SECRET ? { 'x-admin-job-secret': ADMIN_SECRET } : {}) },
                    body: JSON.stringify({ retentionDays })
                });
                
                if (response.ok) {
                    results.operations.deletedAccounts = await response.json();
                } else {
                    const error = await response.text().catch(() => 'Unknown error');
                    results.operations.deletedAccounts = { 
                        error: `HTTP ${response.status}: ${error}` 
                    };
                }
            } catch (error: any) {
                console.error('cleanup-master: Deleted accounts cleanup failed:', error);
                results.operations.deletedAccounts = { 
                    error: error.message || 'Cleanup failed' 
                };
            }
        }

        // 4. Clean up expired shares
        if (!body.skipExpiredShares) {
            try {
                console.log('cleanup-master: Running expired shares cleanup');
                const response = await fetch(new URL('/api/cleanup/expired-shares', baseUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(ADMIN_SECRET ? { 'x-admin-job-secret': ADMIN_SECRET } : {}) }
                });
                
                if (response.ok) {
                    results.operations.expiredShares = await response.json();
                } else {
                    const error = await response.text().catch(() => 'Unknown error');
                    results.operations.expiredShares = { 
                        error: `HTTP ${response.status}: ${error}` 
                    };
                }
            } catch (error: any) {
                console.error('cleanup-master: Expired shares cleanup failed:', error);
                results.operations.expiredShares = { 
                    error: error.message || 'Cleanup failed' 
                };
            }
        }

        // 5. Admin diagnostics and notifications outbox cleanup (server RPCs)
        try {
            const DIAG_DAYS = Number(process.env.DIAG_RETENTION_DAYS || 90);
            const OUTBOX_DAYS = Number(process.env.OUTBOX_RETENTION_DAYS || 30);
            const { data: d1, error: e1 } = await supabaseAdmin.rpc('purge_admin_diagnostics', { retention_days: DIAG_DAYS });
            const { data: d2, error: e2 } = await supabaseAdmin.rpc('purge_notifications_outbox', { retention_days: OUTBOX_DAYS });
            results.operations.diagnosticsPurge = e1 ? { error: e1.message } : { deleted: d1 ?? 0 };
            results.operations.outboxPurge = e2 ? { error: e2.message } : { deleted: d2 ?? 0 };
        } catch (error: any) {
            results.operations.diagnosticsPurge = { error: error?.message || 'RPC failed' };
            results.operations.outboxPurge = { error: error?.message || 'RPC failed' };
        }

        // Calculate summary
        const summary = {
            totalExpiredPreauth: results.operations.expiredPreauth?.orphanedPreauth || 0,
            totalOldUploads: results.operations.oldUploads?.removedUploads || 0,
            totalDeletedAccounts: results.operations.deletedAccounts?.removedAccounts || 0,
            totalExpiredShares: results.operations.expiredShares?.cleaned || 0,
            totalDiagnosticsPurged: results.operations.diagnosticsPurge?.deleted || 0,
            totalOutboxPurged: results.operations.outboxPurge?.deleted || 0,
            totalOrphanedSnapshots: results.operations.expiredPreauth?.orphanedSnapshots || 0,
            totalProtected: (results.operations.expiredPreauth?.protected || 0) + 
                           (results.operations.oldUploads?.protected || 0),
            totalErrors: [
                ...(results.operations.expiredPreauth?.errors || []),
                ...(results.operations.oldUploads?.errors || []),
                ...(results.operations.deletedAccounts?.errors || []),
                ...(results.operations.expiredShares?.error ? [results.operations.expiredShares.error] : []),
                ...(results.operations.diagnosticsPurge?.error ? [results.operations.diagnosticsPurge.error] : []),
                ...(results.operations.outboxPurge?.error ? [results.operations.outboxPurge.error] : [])
            ]
        };

        console.log('cleanup-master: All cleanup operations completed', summary);

        return NextResponse.json({
            ok: true,
            summary,
            details: results,
            config: {
                skipExpiredPreauth,
                skipOldUploads,
                skipDeletedAccounts,
                skipExpiredShares: body.skipExpiredShares,
                retentionDays
            }
        });

    } catch (e: any) {
        console.error('cleanup-master: Unexpected error:', e);
        return NextResponse.json({ 
            error: e?.message || 'Master cleanup failed',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}

// Also support GET for health check / status
export async function GET() {
    return NextResponse.json({ 
        service: 'Email Metrics Cleanup Service',
        version: '1.0.0',
        endpoints: [
            'POST /api/cleanup - Master cleanup (all operations)',
            'POST /api/preauth/cleanup-batch - Expired preauth uploads',
            'POST /api/uploads/cleanup-old - Old uploads for active accounts', 
            'POST /api/accounts/cleanup-deleted - Soft-deleted accounts',
            'POST /api/cleanup/expired-shares - Expired dashboard shares'
        ],
        timestamp: new Date().toISOString()
    });
}
