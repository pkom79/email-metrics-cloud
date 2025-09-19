import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';
import { ingestBucketName } from '../../../lib/storage/ingest';

export async function POST() {
    try {
        const supabase = createServiceClient();
        
        // Test CSV content
        const testCsv = "email,revenue\ntest@example.com,100\nuser@example.com,200";
        const testPath = "test-account/test-snapshot/test.csv";
        
        console.log('🧪 Testing storage upload to:', testPath);
        console.log('📄 CSV content length:', testCsv.length);
        
        // Try to upload test file
        const bucket = ingestBucketName();
        const { data, error } = await supabase.storage
            .from(bucket)
            .upload(testPath, testCsv, {
                contentType: 'text/csv',
                upsert: true
            });
        
        if (error) {
            console.error('❌ Upload failed:', error);
            return NextResponse.json({ 
                success: false, 
                error: error.message,
                details: error
            });
        }
        
        console.log('✅ Upload successful:', data);
        
        // Try to download it back
        const { data: downloadData, error: downloadError } = await supabase.storage
            .from(bucket)
            .download(testPath);
            
        if (downloadError) {
            return NextResponse.json({ 
                success: true, 
                upload: data,
                downloadError: downloadError.message
            });
        }
        
        const downloadedText = await downloadData.text();
        
        return NextResponse.json({ 
            success: true, 
            upload: data,
            downloadedContent: downloadedText,
            matches: downloadedText === testCsv,
            bucket
        });
        
    } catch (error: any) {
        console.error('💥 Test storage error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
}
