import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const serviceClient = createServiceClient();

        // Test the exact logic from share creation
        const dataAccountId = '19fdbfb9-33fc-47b2-83e1-6ce86d171900';
        
        console.log('Testing share creation logic...');
        
        const { data: existingSnapshots, error: existingError } = await serviceClient
            .from('snapshots')
            .select('upload_id, id, created_at, account_id')
            .eq('account_id', dataAccountId)
            .eq('status', 'ready')
            .order('created_at', { ascending: false })
            .limit(5);

        if (existingError) {
            return NextResponse.json({
                success: false,
                error: 'Database query failed',
                details: existingError.message
            });
        }

        let uploadId = null;
        let sourceAccountId = dataAccountId;
        let selectedSnapshot = null;

        if (existingSnapshots && existingSnapshots.length > 0) {
            const knownDataSnapshots = ['45b3831d-6830-4ea0-b7f4-fb943fd0c874', 
                                      '818c411a-69da-43f8-9e35-5564d4e02233',
                                      '40beef9c-d6e7-42b7-b5b4-e7f924e6cca7',
                                      'e9630299-c0f7-4de6-b046-b5aec5edf9bf'];
            
            const snapshotWithData = existingSnapshots.find(s => knownDataSnapshots.includes(s.id));
            
            if (snapshotWithData) {
                uploadId = snapshotWithData.id;
                selectedSnapshot = snapshotWithData;
            } else {
                uploadId = existingSnapshots[0].id;
                selectedSnapshot = existingSnapshots[0];
            }
        }

        // Test creating a snapshot (dry run - just prepare the data)
        const newSnapshotData = {
            account_id: sourceAccountId,
            label: `Test Dashboard Share - ${new Date().toLocaleDateString()}`,
            upload_id: uploadId,
            status: 'ready',
            last_email_date: new Date().toISOString().split('T')[0],
            metadata: {}
        };

        return NextResponse.json({
            success: true,
            dataAccountId,
            existingSnapshots: existingSnapshots?.map(s => ({
                id: s.id,
                upload_id: s.upload_id,
                account_id: s.account_id,
                created_at: s.created_at
            })),
            selectedSnapshot,
            uploadId,
            sourceAccountId,
            newSnapshotData,
            wouldWork: !!(uploadId && sourceAccountId)
        });

    } catch (error) {
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        }, { status: 500 });
    }
}
