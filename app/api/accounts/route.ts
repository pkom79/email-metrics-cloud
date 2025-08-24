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

    let accounts = (data || []).map(a => ({
        id: (a as any).id,
        name: (a as any).name,
        businessName: (a as any).company || null,
        ownerEmail: null,
        storeUrl: null,
    }));

    // Fallback: include any distinct account_ids present in snapshots but missing from accounts (defensive if seeds incomplete)
    try {
        const { data: snaps } = await supabase.from('snapshots').select('account_id').limit(500);
        const distinct = Array.from(new Set((snaps || []).map(s => (s as any).account_id).filter(Boolean)));
        for (const id of distinct) {
            if (!accounts.find(a => a.id === id)) {
                accounts.push({ id, name: null as any, businessName: null, ownerEmail: null, storeUrl: null });
            }
        }
    } catch { /* ignore */ }

    accounts.sort((a, b) => (a.name || a.businessName || a.id).localeCompare(b.name || b.businessName || b.id));

    return NextResponse.json({ accounts });
}
