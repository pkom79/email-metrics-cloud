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
        .select('id,company,store_url,deleted_at,created_at')
        .is('deleted_at', null)
        .not('company', 'is', null)
        .neq('company', '')
        .order('company', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
    let accounts = (data || [])
        .map(a => ({
            id: (a as any).id as string,
            rawCompany: ((a as any).company as string | null) || null,
            storeUrl: (a as any).store_url || null,
        }))
        .filter(a => a.rawCompany && a.rawCompany.trim() && !looksLikeEmail(a.rawCompany.trim()))
        .map(a => ({ id: a.id, businessName: a.rawCompany!.trim(), storeUrl: a.storeUrl, ownerEmail: null }));

    // If admin's own account not present because it lacks company, include placeholder
    if (!accounts.find(a => a.id === user.id)) {
        // Attempt to fetch admin's own account row (may have empty company)
        const { data: selfRow } = await supabase.from('accounts').select('id').eq('id', user.id).maybeSingle();
        if (selfRow) {
            accounts.unshift({ id: user.id, businessName: 'Your Account', storeUrl: null, ownerEmail: null });
        }
    }

    return NextResponse.json({ accounts });
}
