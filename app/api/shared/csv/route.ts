import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const token = searchParams.get('token');
        const type = searchParams.get('type');

        console.log('🔄 Shared CSV API called:', { token: token?.substring(0, 8) + '...', type });

        if (!token || !type) {
            console.log('❌ Missing token or type');
            return NextResponse.json({ error: 'Missing token or type parameter' }, { status: 400 });
        }

        const supabase = createServiceClient();

        // Validate the share token with more detailed logging
        console.log('🔍 Looking up share token in database...');
        const { data: share, error: shareError } = await supabase
            .from('snapshot_shares')
            .select(`
                id,
                snapshot_id,
                is_active,
                expires_at,
                snapshots!inner(
                    id,
                    account_id,
                    upload_id,
                    label
                )
            `)
            .eq('share_token', token)
            .single();

        console.log('📊 Share lookup result:', { share: share ? 'found' : 'not found', error: shareError?.message });

        if (shareError || !share) {
            console.log('❌ Invalid share token:', shareError?.message);
            return NextResponse.json({ error: 'Invalid or expired share token' }, { status: 404 });
        }

        if (!share.is_active) {
            console.log('❌ Share is inactive');
            return NextResponse.json({ error: 'Share link is no longer active' }, { status: 404 });
        }

        // Check if share has expired
        if (share.expires_at && new Date(share.expires_at) < new Date()) {
            console.log('❌ Share token expired');
            return NextResponse.json({ error: 'Share link has expired' }, { status: 404 });
        }

        const snapshot = share.snapshots as any;
        console.log('✅ Valid share found, fetching CSV for snapshot:', snapshot.id, 'label:', snapshot.label);

        // Check if snapshot has upload_id
        if (!snapshot.upload_id) {
            console.log('❌ Snapshot has no upload_id');
            return NextResponse.json({ error: 'No data available for this snapshot' }, { status: 404 });
        }

        // Get the CSV file from storage using upload_id (like regular download API)
        const fileName = `${type}.csv`;
        const filePath = `${snapshot.account_id}/${snapshot.upload_id}/${fileName}`;

        console.log('📁 Looking for file:', filePath);
        console.log('📊 Account ID:', snapshot.account_id);
        console.log('📊 Upload ID:', snapshot.upload_id);

        // Debug: List contents of the account folder
        const { data: folderList, error: listError } = await supabase.storage
            .from('uploads')
            .list(snapshot.account_id, { limit: 100 });

        if (listError) {
            console.log('❌ Error listing account folder:', listError);
        } else {
            console.log('📁 Account folder contents:', folderList?.map(f => f.name));
        }

        // Debug: List contents of the upload folder
        const uploadFolderPath = `${snapshot.account_id}/${snapshot.upload_id}`;
        const { data: uploadList, error: uploadListError } = await supabase.storage
            .from('uploads')
            .list(uploadFolderPath, { limit: 100 });

        if (uploadListError) {
            console.log('❌ Error listing upload folder:', uploadListError);
        } else {
            console.log('📁 Upload folder contents:', uploadList?.map(f => f.name));
        }

        const { data: fileData, error: downloadError } = await supabase.storage
            .from('uploads')
            .download(filePath);

        if (downloadError) {
            console.log('❌ File download error:', downloadError.message);
            console.log('❌ Full download error:', JSON.stringify(downloadError, null, 2));
            if (downloadError.message?.includes('not found') || downloadError.message?.includes('object not found')) {
                return NextResponse.json({ 
                    error: 'No data available for this snapshot',
                    details: `The ${type} data file was not found. This snapshot may not have ${type} data uploaded.`
                }, { status: 404 });
            }
            return NextResponse.json({ 
                error: 'Error accessing file data', 
                details: `${downloadError.message || 'Unknown error'} (Full error: ${JSON.stringify(downloadError)})` 
            }, { status: 500 });
        }

        if (!fileData) {
            console.log('❌ File data is null');
            return NextResponse.json({ error: 'No data available for this snapshot' }, { status: 404 });
        }

        console.log('✅ File found, size:', fileData.size, 'bytes');

        // Convert blob to text
        const csvText = await fileData.text();

        if (!csvText.trim()) {
            console.log('❌ File is empty');
            return NextResponse.json({ error: 'Data file is empty' }, { status: 404 });
        }

        console.log('✅ Returning CSV data, length:', csvText.length);

        // Return the CSV content
        return new NextResponse(csvText, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="${fileName}"`
            }
        });

    } catch (error) {
        console.error('💥 Error in shared CSV API:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
