import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        console.log('🧪 Storage test starting...');
        
        const supabase = createServiceClient();
        
        // Test 1: List buckets
        console.log('🧪 Test 1: List buckets');
        const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
        
        if (bucketError) {
            console.log('❌ Bucket list failed:', bucketError);
            return NextResponse.json({
                success: false,
                test: 'listBuckets',
                error: bucketError.message,
                details: JSON.stringify(bucketError)
            });
        }
        
        console.log('✅ Buckets found:', buckets?.map((b: any) => b.name));
        
        // Test 2: Try to list files in csv-uploads
        console.log('🧪 Test 2: List files in csv-uploads');
        const { data: csvFiles, error: csvError } = await supabase.storage
            .from('csv-uploads')
            .list('', { limit: 5 });
            
        if (csvError) {
            console.log('❌ CSV-uploads list failed:', csvError);
            return NextResponse.json({
                success: false,
                test: 'listCsvUploads',
                error: csvError.message,
                details: JSON.stringify(csvError),
                buckets: buckets?.map((b: any) => b.name)
            });
        }
        
        // Test 3: Try to list files in uploads (if it exists)
        console.log('🧪 Test 3: List files in uploads');
        const { data: uploadFiles, error: uploadError } = await supabase.storage
            .from('uploads')
            .list('', { limit: 5 });
            
        return NextResponse.json({
            success: true,
            buckets: buckets?.map((b: any) => b.name),
            csvUploadsFiles: csvFiles?.length || 0,
            uploadsFiles: uploadFiles?.length || 0,
            uploadsError: uploadError?.message,
            environment: {
                hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
                serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
                url: process.env.NEXT_PUBLIC_SUPABASE_URL
            }
        });
        
    } catch (error) {
        console.error('🧪 Storage test error:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        }, { status: 500 });
    }
}
