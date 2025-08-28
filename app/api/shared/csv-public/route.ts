import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const token = searchParams.get('token');
        const type = searchParams.get('type');

        console.log('🔄 Public CSV API called:', { token: token?.substring(0, 8) + '...', type });

        if (!token || !type) {
            console.log('❌ Missing token or type');
            return NextResponse.json({ error: 'Missing token or type parameter' }, { status: 400 });
        }

        const supabase = createServiceClient();

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

        // Since csv-uploads bucket is public, try accessing via public URL
        const fileName = `${type}.csv`;
        const filePath = `${snapshot.account_id}/${snapshot.upload_id}/${fileName}`;

        console.log('📁 Trying public URL access for file:', filePath);

        // Try public URL first (since bucket is public)
        const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/csv-uploads/${filePath}`;
        console.log('🌐 Public URL:', publicUrl);

        try {
            const response = await fetch(publicUrl);
            console.log('📡 Public URL response status:', response.status);

            if (response.ok) {
                const csvText = await response.text();
                if (csvText.trim()) {
                    console.log('✅ Got CSV data via public URL, length:', csvText.length);
                    return new NextResponse(csvText, {
                        status: 200,
                        headers: {
                            'Content-Type': 'text/csv',
                            'Content-Disposition': `attachment; filename="${fileName}"`
                        }
                    });
                } else {
                    console.log('❌ Public URL returned empty content');
                }
            } else {
                console.log('❌ Public URL failed:', response.status, response.statusText);
            }
        } catch (fetchError) {
            console.log('❌ Public URL fetch error:', fetchError);
        }

        // Fallback: try uploads bucket public URL
        const uploadsPublicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/${filePath}`;
        console.log('🔄 Trying uploads bucket public URL:', uploadsPublicUrl);

        try {
            const response = await fetch(uploadsPublicUrl);
            console.log('📡 Uploads URL response status:', response.status);

            if (response.ok) {
                const csvText = await response.text();
                if (csvText.trim()) {
                    console.log('✅ Got CSV data via uploads public URL, length:', csvText.length);
                    return new NextResponse(csvText, {
                        status: 200,
                        headers: {
                            'Content-Type': 'text/csv',
                            'Content-Disposition': `attachment; filename="${fileName}"`
                        }
                    });
                }
            }
        } catch (fetchError) {
            console.log('❌ Uploads URL fetch error:', fetchError);
        }

        // If both public URLs fail, return error
        console.log('❌ All access methods failed');
        return NextResponse.json({ 
            error: 'No data available for this snapshot',
            details: `The ${type} data file was not found. This snapshot may not have ${type} data uploaded.`
        }, { status: 404 });

    } catch (error) {
        console.error('💥 Error in public CSV API:', error);
        return NextResponse.json({ 
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
