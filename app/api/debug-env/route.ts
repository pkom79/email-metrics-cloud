import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Check environment variables
        const envCheck = {
            hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            supabaseUrlLength: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
            hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
            serviceKeyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...',
        };

        console.log('🔍 Environment check:', envCheck);

        // Test database connection
        const supabase = createServiceClient();
        const { data: dbTest, error: dbError } = await supabase
            .from('snapshots')
            .select('count')
            .limit(1);

        // Test storage bucket access
        const { data: buckets, error: storageError } = await supabase.storage.listBuckets();

        return NextResponse.json({
            success: true,
            environment: envCheck,
            database: {
                connected: !dbError,
                error: dbError?.message,
            },
            storage: {
                connected: !storageError,
                error: storageError?.message,
                buckets: buckets?.map(b => b.name) || [],
            }
        });

    } catch (error) {
        console.error('Debug env error:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        }, { status: 500 });
    }
}
