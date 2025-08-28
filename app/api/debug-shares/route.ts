import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export async function GET() {
    try {
        const supabase = createServiceClient();
        
        // Get all active shares for debugging
        const { data: shares, error } = await supabase
            .from('snapshot_shares')
            .select(`
                id,
                share_token,
                title,
                is_active,
                created_at,
                expires_at,
                snapshots!inner(
                    id,
                    label
                )
            `)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ 
            shares: shares?.map((share: any) => ({
                token: share.share_token?.substring(0, 8) + '...',
                title: share.title,
                created: share.created_at,
                expires: share.expires_at,
                snapshot: (share.snapshots as any)?.label
            })) || [],
            count: shares?.length || 0
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
