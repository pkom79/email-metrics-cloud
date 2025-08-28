import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // List files in csv-uploads bucket
        const { data: files, error } = await supabase.storage
            .from('csv-uploads')
            .list('', {
                limit: 100,
                offset: 0
            });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ 
            files: files || [],
            count: files?.length || 0
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
