import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export async function POST(request: Request) {
    try {
        const supabase = createServiceClient();
        const { action } = await request.json();
        
        if (action === 'check') {
            // Check existing shares and their CSV files
            const { data: shares, error } = await supabase
                .from('snapshot_shares')
                .select(`
                    id,
                    share_token,
                    title,
                    snapshot_id,
                    snapshots!inner(
                        id,
                        account_id,
                        label
                    )
                `)
                .limit(10);
                
            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
            
            const results = [];
            
            for (const share of shares || []) {
                const snapshot = share.snapshots as any;
                const accountId = snapshot.account_id;
                const snapshotId = snapshot.id;
                
                // Check if CSV files exist for this share
                const csvTypes = ['campaigns', 'flows', 'subscribers'];
                const csvStatus: Record<string, any> = {};
                
                for (const type of csvTypes) {
                    const filePath = `${accountId}/${snapshotId}/${type}.csv`;
                    const { data, error: downloadError } = await supabase.storage
                        .from('csv-uploads')
                        .download(filePath);
                        
                    csvStatus[type] = {
                        exists: !downloadError,
                        error: downloadError?.message,
                        size: data ? (await data.text()).length : 0
                    };
                }
                
                results.push({
                    shareId: share.id,
                    title: share.title,
                    token: share.share_token.substring(0, 8) + '...',
                    csvFiles: csvStatus
                });
            }
            
            return NextResponse.json({ shares: results });
        }
        
        if (action === 'delete_orphaned') {
            // Delete shares that have no CSV files
            const { data: shares, error } = await supabase
                .from('snapshot_shares')
                .select(`
                    id,
                    snapshot_id,
                    snapshots!inner(
                        id,
                        account_id
                    )
                `);
                
            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
            
            const orphanedShares = [];
            
            for (const share of shares || []) {
                const snapshot = share.snapshots as any;
                const filePath = `${snapshot.account_id}/${snapshot.id}/campaigns.csv`;
                
                const { error: downloadError } = await supabase.storage
                    .from('csv-uploads')
                    .download(filePath);
                    
                if (downloadError) {
                    orphanedShares.push(share.id);
                }
            }
            
            if (orphanedShares.length > 0) {
                const { error: deleteError } = await supabase
                    .from('snapshot_shares')
                    .delete()
                    .in('id', orphanedShares);
                    
                if (deleteError) {
                    return NextResponse.json({ error: deleteError.message }, { status: 500 });
                }
            }
            
            return NextResponse.json({ 
                deleted: orphanedShares.length,
                shareIds: orphanedShares
            });
        }
        
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        
    } catch (error: any) {
        console.error('💥 Share cleanup error:', error);
        return NextResponse.json({ 
            error: error.message 
        }, { status: 500 });
    }
}
