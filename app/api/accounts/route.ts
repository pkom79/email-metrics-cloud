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
    const accounts = (data || []).map(a => {
        const id = (a as any).id as string;
        const rawCompany = (a as any).company as string | null;
        const rawName = (a as any).name as string | null;
        const clean = (s: string | null) => (s && s.trim()) || null;
        const company = clean(rawCompany);
        const name = clean(rawName);
        const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
        // Prefer non-email company/name
        let businessName: string | null = (company && !looksLikeEmail(company) && company) || (name && !looksLikeEmail(name) && name) || null;
        // If only email-like strings exist, synthesize a label
        if (!businessName) {
            businessName = `Account-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
        }
        return {
            id,
            businessName,
            ownerEmail: null,
            storeUrl: (a as any).store_url || null,
        };
    });

    return NextResponse.json({ accounts });
}
