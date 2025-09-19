import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';
import { ingestBucketName } from '../../../lib/storage/ingest';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // List all files in csv-uploads with detailed info
        const bucket = ingestBucketName();
        const { data: files, error } = await supabase.storage
            .from(bucket)
            .list('', { 
                limit: 100, 
                sortBy: { column: 'name', order: 'asc' },
                search: ''
            });
            
        if (error) {
            return NextResponse.json({
                success: false,
                error: error.message,
                details: JSON.stringify(error)
            });
        }
        
        // Get more detailed structure
        const structure: any = {};
        for (const file of files || []) {
            if (file.name) {
                // Try to list subdirectories
                const { data: subFiles, error: subError } = await supabase.storage
                    .from(bucket)
                    .list(file.name, { limit: 100 });
                    
                structure[file.name] = {
                    isFolder: !file.name.includes('.'),
                    size: file.metadata?.size,
                    lastModified: file.updated_at,
                    subFiles: subError ? `Error: ${subError.message}` : subFiles?.map((sf: any) => sf.name)
                };
            }
        }
        
        return NextResponse.json({
            success: true,
            totalFiles: files?.length || 0,
            files: files?.map((f: any) => ({
                name: f.name,
                id: f.id,
                size: f.metadata?.size,
                lastModified: f.updated_at,
                isFolder: !f.name.includes('.')
            })),
            bucket,
            detailedStructure: structure
        });
        
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
