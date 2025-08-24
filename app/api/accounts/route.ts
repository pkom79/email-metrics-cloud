import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// Returns list of all accounts with owner email & metadata (admin only)
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin = user.app_metadata?.role === 'admin';
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Active accounts only (deleted_at IS NULL) and include store_url if present
    const { data, error } = await supabase
        .from('accounts')
        .select('id,company,store_url,deleted_at')
        .is('deleted_at', null)
        .not('company', 'is', null)
        .neq('company', '')
        .order('company', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const accounts = (data || []).map(a => ({
        id: (a as any).id,
        businessName: (a as any).company || null,
        ownerEmail: null,
        storeUrl: (a as any).store_url || null,
    }));

    return NextResponse.json({ accounts });
}
