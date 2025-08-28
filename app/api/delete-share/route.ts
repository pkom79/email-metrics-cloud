import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';
import { getServerUser } from '../../../lib/supabase/auth';

export async function POST(request: Request) {
    try {
        const supabase = createServiceClient();
        
        // Authenticate user
        const user = await getServerUser();
        if (!user) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }
        
        const { shareId } = await request.json();
        
        if (!shareId) {
            return NextResponse.json({ error: 'Share ID required' }, { status: 400 });
        }
        
        // Get share info and verify ownership
        const { data: share, error: shareError } = await supabase
            .from('snapshot_shares')
            .select(`
                id,
                snapshot_id,
                share_token,
                snapshots!inner(
                    id,
                    account_id,
                    accounts!inner(
                        id,
                        user_id
                    )
                )
            `)
            .eq('id', shareId)
            .single();
            
        if (shareError || !share) {
            return NextResponse.json({ error: 'Share not found' }, { status: 404 });
        }
        
        const snapshot = share.snapshots as any;
        const account = snapshot.accounts;
        
        // Verify user owns this share
        if (account.user_id !== user.id) {
            return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
        }
        
        const accountId = snapshot.account_id;
        const snapshotId = snapshot.id;
        
        console.log(`🗑️ Deleting share ${share.share_token.substring(0, 8)}... for user ${user.id}`);
        
        // Delete CSV files from storage
        const csvTypes = ['campaigns', 'flows', 'subscribers'];
        const deletedFiles = [];
        const failedFiles = [];
        
        for (const type of csvTypes) {
            const filePath = `${accountId}/${snapshotId}/${type}.csv`;
            const { error: deleteError } = await supabase.storage
                .from('csv-uploads')
                .remove([filePath]);
                
            if (!deleteError) {
                deletedFiles.push(filePath);
                console.log(`🗑️ Deleted ${filePath}`);
            } else if (!deleteError.message?.includes('not found')) {
                failedFiles.push({ path: filePath, error: deleteError.message });
                console.warn(`⚠️ Failed to delete ${filePath}:`, deleteError.message);
            }
        }
        
        // Delete the share record
        const { error: deleteShareError } = await supabase
            .from('snapshot_shares')
            .delete()
            .eq('id', shareId);
            
        if (deleteShareError) {
            console.error(`❌ Failed to delete share record:`, deleteShareError.message);
            return NextResponse.json({ error: 'Failed to delete share' }, { status: 500 });
        }
        
        console.log(`✅ Successfully deleted share ${share.share_token.substring(0, 8)}...`);
        
        return NextResponse.json({ 
            success: true,
            deletedFiles,
            failedFiles,
            message: `Share deleted successfully. Removed ${deletedFiles.length} files from storage.`
        });
        
    } catch (error: any) {
        console.error('💥 Delete share error:', error);
        return NextResponse.json({ 
            error: error.message 
        }, { status: 500 });
    }
}
