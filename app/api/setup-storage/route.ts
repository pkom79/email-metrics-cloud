import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export async function POST() {
    try {
        const supabase = createServiceClient();
        
        console.log('🪣 Creating csv-uploads bucket...');
        
        // Create the bucket
        const { data: bucket, error: bucketError } = await supabase.storage
            .createBucket('csv-uploads', {
                public: false, // Private bucket - only accessible via API
                allowedMimeTypes: ['text/csv', 'text/plain'],
                fileSizeLimit: 50 * 1024 * 1024 // 50MB limit
            });
        
        if (bucketError) {
            console.error('❌ Failed to create bucket:', bucketError);
            // If bucket already exists, that's okay
            if (bucketError.message?.includes('already exists')) {
                console.log('✅ Bucket already exists, continuing...');
            } else {
                return NextResponse.json({ 
                    success: false, 
                    error: bucketError.message,
                    step: 'create_bucket'
                });
            }
        } else {
            console.log('✅ Bucket created:', bucket);
        }
        
        // Test upload
        const testCsv = "email,revenue\ntest@example.com,100";
        const testPath = "test-account/test-snapshot/campaigns.csv";
        
        console.log('🧪 Testing upload after bucket creation...');
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('csv-uploads')
            .upload(testPath, testCsv, {
                contentType: 'text/csv',
                upsert: true
            });
        
        if (uploadError) {
            console.error('❌ Upload test failed:', uploadError);
            return NextResponse.json({ 
                success: false, 
                bucketCreated: true,
                uploadError: uploadError.message,
                step: 'test_upload'
            });
        }
        
        console.log('✅ Upload test successful:', uploadData);
        
        // Test download
        const { data: downloadData, error: downloadError } = await supabase.storage
            .from('csv-uploads')
            .download(testPath);
            
        if (downloadError) {
            return NextResponse.json({ 
                success: false, 
                bucketCreated: true,
                uploadSuccessful: true,
                downloadError: downloadError.message,
                step: 'test_download'
            });
        }
        
        const downloadedText = await downloadData.text();
        
        // Clean up test file
        await supabase.storage
            .from('csv-uploads')
            .remove([testPath]);
        
        return NextResponse.json({ 
            success: true, 
            bucketCreated: true,
            uploadTest: 'passed',
            downloadTest: 'passed',
            testContent: downloadedText,
            message: 'csv-uploads bucket is ready!'
        });
        
    } catch (error: any) {
        console.error('💥 Setup error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
}
