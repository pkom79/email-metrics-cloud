import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export async function POST() {
    try {
        const supabase = createServiceClient();

        console.log('🧹 Starting expired shares cleanup...');

        // Find expired shares
        const { data: expiredShares, error: findError } = await supabase
            .from('snapshot_shares')
            .select(`
                id,
                share_token,
                snapshot_id,
                expires_at,
                snapshots!inner(account_id)
            `)
            .not('expires_at', 'is', null)
            .lt('expires_at', new Date().toISOString());

        if (findError) {
            throw findError;
        }

        if (!expiredShares || expiredShares.length === 0) {
            console.log('✅ No expired shares found');
            return NextResponse.json({ 
                success: true, 
                message: 'No expired shares to clean up',
                cleaned: 0,
                filesRemoved: 0
            });
        }

        console.log(`🔍 Found ${expiredShares.length} expired shares`);

        let cleanedFiles = 0;
        let cleanedShares = 0;

        for (const share of expiredShares) {
            try {
                const snapshot = share.snapshots as any;
                const accountId = snapshot.account_id;
                const snapshotId = share.snapshot_id;

                // Delete CSV files from storage
                const csvTypes = ['campaigns', 'flows', 'subscribers'];
                for (const type of csvTypes) {
                    const filePath = `${accountId}/${snapshotId}/${type}.csv`;
                    
                    const { error: deleteError } = await supabase.storage
                        .from('csv-uploads')
                        .remove([filePath]);

                    if (!deleteError) {
                        cleanedFiles++;
                        console.log(`🗑️ Deleted ${filePath}`);
                    } else if (!deleteError.message?.includes('not found')) {
                        console.warn(`⚠️ Error deleting ${filePath}:`, deleteError.message);
                    }
                }

                // Delete the share record
                const { error: shareDeleteError } = await supabase
                    .from('snapshot_shares')
                    .delete()
                    .eq('id', share.id);

                if (!shareDeleteError) {
                    cleanedShares++;
                    console.log(`🗑️ Deleted expired share: ${share.share_token.substring(0, 8)}...`);
                } else {
                    console.error(`❌ Error deleting share ${share.id}:`, shareDeleteError.message);
                }

            } catch (error) {
                console.error(`❌ Error cleaning up share ${share.id}:`, error);
            }
        }

        console.log(`✅ Cleanup complete: ${cleanedShares} shares, ${cleanedFiles} files`);

        return NextResponse.json({
            success: true,
            message: `Cleaned up ${cleanedShares} expired shares and ${cleanedFiles} files`,
            cleaned: cleanedShares,
            filesRemoved: cleanedFiles
        });

    } catch (error: any) {
        console.error('💥 Expired shares cleanup error:', error);
        return NextResponse.json({ 
            error: 'Cleanup failed', 
            details: error.message 
        }, { status: 500 });
    }
}
