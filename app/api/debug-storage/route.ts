import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';
import { ingestBucketName } from '../../../lib/storage/ingest';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // List files in the configured ingest bucket
        const bucket = ingestBucketName();
        const { data: files, error } = await supabase.storage
            .from(bucket)
            .list('', {
                limit: 100,
                offset: 0
            });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ 
            bucket,
            files: files || [],
            count: files?.length || 0
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
