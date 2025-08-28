import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export async function GET() {
    try {
        const serviceClient = createServiceClient();

        // Test the logic I added to the share creation
        console.log('Testing snapshot search logic...');
        
        const { data: existingSnapshots, error: existingError } = await serviceClient
            .from('snapshots')
            .select('upload_id, id, created_at, account_id')
            .eq('status', 'ready')
            .not('upload_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(10);

        console.log('Found snapshots:', existingSnapshots?.length);

        if (existingError) {
            return NextResponse.json({
                success: false,
                error: 'Database query failed',
                details: existingError.message
            });
        }

        let uploadId = null;
        let sourceAccountId = null;
        const testResults = [];

        if (existingSnapshots && existingSnapshots.length > 0) {
            // Test each snapshot
            for (const snapshot of existingSnapshots.slice(0, 3)) { // Test first 3 only
                const testPath = `${snapshot.account_id}/${snapshot.upload_id}/campaigns.csv`;
                
                try {
                    const { error: testError } = await serviceClient.storage
                        .from('csv-uploads')
                        .download(testPath);
                        
                    const hasData = !testError;
                    testResults.push({
                        snapshot_id: snapshot.id,
                        account_id: snapshot.account_id,
                        upload_id: snapshot.upload_id,
                        test_path: testPath,
                        has_data: hasData,
                        error: testError?.message
                    });
                    
                    if (hasData && !uploadId) {
                        uploadId = snapshot.upload_id;
                        sourceAccountId = snapshot.account_id;
                    }
                } catch (storageError) {
                    testResults.push({
                        snapshot_id: snapshot.id,
                        account_id: snapshot.account_id,
                        upload_id: snapshot.upload_id,
                        test_path: testPath,
                        has_data: false,
                        error: `Storage error: ${storageError}`
                    });
                }
            }
        }

        return NextResponse.json({
            success: true,
            snapshots_found: existingSnapshots?.length || 0,
            test_results: testResults,
            found_data: {
                upload_id: uploadId,
                source_account_id: sourceAccountId
            }
        });

    } catch (error) {
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        }, { status: 500 });
    }
}
