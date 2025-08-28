import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const token = searchParams.get('token');
        const type = searchParams.get('type');

        console.log('🔄 Direct storage CSV API called:', { token: token?.substring(0, 8) + '...', type });

        if (!token || !type) {
            console.log('❌ Missing token or type');
            return NextResponse.json({ error: 'Missing token or type parameter' }, { status: 400 });
        }

        // Create direct Supabase client with service role (bypasses RLS)
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        console.log('🔑 Using direct service role client');

        // Validate the share token
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
        console.log('✅ Valid share found, fetching CSV for snapshot:', snapshot.id);

        // Check if snapshot has upload_id
        if (!snapshot.upload_id) {
            console.log('❌ Snapshot has no upload_id');
            return NextResponse.json({ error: 'No data available for this snapshot' }, { status: 404 });
        }

        // Try both bucket patterns with direct storage access
        const fileName = `${type}.csv`;
        const filePath = `${snapshot.account_id}/${snapshot.upload_id}/${fileName}`;

        console.log('📁 Looking for file:', filePath);

        let fileData, downloadError;

        // First try: csv-uploads bucket
        console.log('🪣 Trying csv-uploads bucket directly...');
        try {
            const result1 = await supabase.storage
                .from('csv-uploads')
                .download(filePath);
            
            fileData = result1.data;
            downloadError = result1.error;

            if (!downloadError && fileData) {
                console.log('✅ Found file in csv-uploads bucket!');
            } else {
                console.log('❌ csv-uploads failed:', downloadError?.message);
                
                // Second try: uploads bucket
                console.log('🔄 Trying uploads bucket...');
                const result2 = await supabase.storage
                    .from('uploads')
                    .download(filePath);
                
                fileData = result2.data;
                downloadError = result2.error;
                
                if (!downloadError && fileData) {
                    console.log('✅ Found file in uploads bucket!');
                } else {
                    console.log('❌ uploads bucket also failed:', downloadError?.message);
                }
            }
        } catch (storageError) {
            console.log('💥 Storage API error:', storageError);
            downloadError = storageError as any;
        }

        if (downloadError || !fileData) {
            console.log('❌ All storage attempts failed');
            
            if (downloadError?.message?.includes('not found') || downloadError?.message?.includes('object not found')) {
                return NextResponse.json({ 
                    error: 'No data available for this snapshot',
                    details: `The ${type} data file was not found. This snapshot may not have ${type} data uploaded.`
                }, { status: 404 });
            }
            return NextResponse.json({ 
                error: 'Error accessing file data', 
                details: `Storage error: ${downloadError?.message || 'Unknown error'}`
            }, { status: 500 });
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
        console.error('💥 Error in direct storage CSV API:', error);
        return NextResponse.json({ 
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
