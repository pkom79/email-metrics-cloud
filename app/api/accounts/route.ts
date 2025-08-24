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
        .select('id,name,company,store_url,deleted_at,created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
    const trimmed = (s: string | null) => (s && s.trim()) || null;
    const rawAccounts = (data || []).map(a => ({
        id: (a as any).id as string,
        company: trimmed((a as any).company as string | null),
        name: trimmed((a as any).name as string | null),
        storeUrl: (a as any).store_url || null,
    }));

    let derived = rawAccounts.map(a => {
        let businessName: string | null = null;
        if (a.company && !looksLikeEmail(a.company)) businessName = a.company;
        else if (a.name && !looksLikeEmail(a.name)) businessName = a.name;
        return { id: a.id, businessName, storeUrl: a.storeUrl, ownerEmail: null };
    });

    // Keep only those with a businessName initially
    let withNames = derived.filter(a => a.businessName);

    if (withNames.length === 0) {
        // Fallback: synthesize labels from id fragments to avoid blank dropdown
        withNames = derived.map(a => ({
            ...a,
            businessName: a.businessName || `Account-${a.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`
        }));
    } else {
        // Ensure admin's own account appears even if lacks business name
        if (!withNames.find(a => a.id === user.id)) {
            const self = derived.find(a => a.id === user.id);
            if (self) withNames.unshift({ ...self, businessName: 'Your Account' });
        }
    }

    const accounts = withNames;

    return NextResponse.json({ accounts });
}
