import { NextResponse } from 'next/server';
import { getServerUser } from '../../../lib/supabase/auth';

export const runtime = 'nodejs';

// Master cleanup endpoint that orchestrates all cleanup operations
// This can be called by a single cron job to handle all maintenance
export async function POST(request: Request) {
    try {
        const user = await getServerUser();
        // Allow anonymous (cron) or admin; if user present and not admin -> forbid
        if (user && user.app_metadata?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
                    headers: { 'Content-Type': 'application/json' }
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
                    headers: { 'Content-Type': 'application/json' }
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
                    headers: { 'Content-Type': 'application/json' },
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
                    headers: { 'Content-Type': 'application/json' }
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

        // Calculate summary
        const summary = {
            totalExpiredPreauth: results.operations.expiredPreauth?.orphanedPreauth || 0,
            totalOldUploads: results.operations.oldUploads?.removedUploads || 0,
            totalDeletedAccounts: results.operations.deletedAccounts?.removedAccounts || 0,
            totalExpiredShares: results.operations.expiredShares?.cleaned || 0,
            totalOrphanedSnapshots: results.operations.expiredPreauth?.orphanedSnapshots || 0,
            totalProtected: (results.operations.expiredPreauth?.protected || 0) + 
                           (results.operations.oldUploads?.protected || 0),
            totalErrors: [
                ...(results.operations.expiredPreauth?.errors || []),
                ...(results.operations.oldUploads?.errors || []),
                ...(results.operations.deletedAccounts?.errors || []),
                ...(results.operations.expiredShares?.error ? [results.operations.expiredShares.error] : [])
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
