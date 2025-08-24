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

    // Simpler select only from accounts to avoid cross-schema joins (previous nested join caused 500)
    const { data, error } = await supabase
        .from('accounts')
        .select('id,name,company')
        .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Map to unified shape expected by client (placeholders for now until impersonation implemented)
    const accounts = (data || []).map(a => ({
        id: (a as any).id,
        name: (a as any).name,
        businessName: (a as any).company || null,
        ownerEmail: null,
        storeUrl: null,
    }));

    return NextResponse.json({ accounts });
}
