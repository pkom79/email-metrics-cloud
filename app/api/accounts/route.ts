import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceClient } from '../../../lib/supabase/server';

type AdminAccount = {
    id: string;
    businessName: string | null;
    ownerEmail: string | null;
    storeUrl: string | null;
    country: string | null;
    adminContactLabel: string | null;
    billingMode: 'standard' | 'admin_free';
    isAdminFree: boolean;
};

// Returns list of all accounts with owner email & metadata (admin only)
export async function GET() {
    const cookieStore = await cookies();
    const userClient = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Use service client to also fetch owner emails via Auth Admin API
    const service = createServiceClient();
    const { data, error } = await service
        .from('accounts')
        .select('id,name,company,country,store_url,deleted_at,created_at,owner_user_id,admin_contact_label,billing_mode')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Collect unique owner user IDs and fetch emails in parallel (fixes N+1 query)
    const ownerIds = Array.from(new Set((data || []).map((r: any) => (r as any).owner_user_id).filter(Boolean))) as string[];
    const emailMap: Record<string, string> = {};
    
    // Batch fetch all user emails in parallel instead of sequential loop
    const userPromises = ownerIds.map(async (oid) => {
        try {
            const { data: usr } = await (service as any).auth.admin.getUserById(oid);
            return { oid, email: usr?.user?.email || null };
        } catch {
            return { oid, email: null };
        }
    });
    const userResults = await Promise.all(userPromises);
    for (const { oid, email } of userResults) {
        if (email) emailMap[oid] = email;
    }
    
    const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
    const trimmed = (s: string | null | undefined) => (s && s.trim()) || null;
    const derived = (data || []).map((a: {
        id: string;
        owner_user_id: string | null;
        company: string | null;
        name: string | null;
        store_url: string | null;
        country: string | null;
        admin_contact_label?: string | null;
        billing_mode?: string | null;
    }) => {
        const ownerUserId = a.owner_user_id;
        let businessName: string | null = null;
        const company = trimmed(a.company);
        const name = trimmed(a.name);
        if (company && !looksLikeEmail(company)) {
            businessName = company;
        } else if (name && !looksLikeEmail(name)) {
            businessName = name;
        }

        return {
            id: a.id,
            businessName,
            storeUrl: a.store_url || null,
            ownerEmail: ownerUserId ? emailMap[ownerUserId] || null : null,
            country: trimmed(a.country),
            adminContactLabel: trimmed(a.admin_contact_label),
            billingMode: (a.billing_mode === 'admin_free' ? 'admin_free' : 'standard') as 'standard' | 'admin_free',
            isAdminFree: a.billing_mode === 'admin_free',
        };
    });

    const accounts = derived.map((a: AdminAccount) => ({
        ...a,
        businessName: a.businessName || `Account-${a.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
    }));

    return NextResponse.json({ accounts });
}

// Create a new admin-comped account (admin only)
export async function POST(request: Request) {
    try {
        const cookieStore = await cookies();
        const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
        if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const { businessName, contactLabel, storeUrl, country } = await request.json().catch(() => ({}));
        const trimmedName = (businessName || '').trim();
        if (!trimmedName) {
            return NextResponse.json({ error: 'Business name is required' }, { status: 400 });
        }
        const trimmedLabel = (contactLabel || '').trim();
        if (trimmedLabel.length > 80) {
            return NextResponse.json({ error: 'Contact label must be 80 characters or fewer' }, { status: 400 });
        }
        const normalizedStore = typeof storeUrl === 'string' ? storeUrl.trim() || null : null;
        const normalizedCountry = typeof country === 'string' ? country.trim() || null : null;

        const service = createServiceClient();
        const payload: any = {
            owner_user_id: user.id,
            company: trimmedName,
            name: trimmedName,
            store_url: normalizedStore,
            country: normalizedCountry,
            billing_mode: 'admin_free',
            admin_created_by: user.id,
            admin_contact_label: trimmedLabel || null,
        };

        const { data: created, error } = await service
            .from('accounts')
            .insert(payload)
            .select('id, company, store_url, country, admin_contact_label, billing_mode')
            .single();
        if (error || !created) {
            console.error('Create admin account failed', error);
            return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
        }

        const response: AdminAccount = {
            id: created.id,
            businessName: payload.company,
            storeUrl: created.store_url || null,
            ownerEmail: user.email || null,
            country: created.country || null,
            adminContactLabel: created.admin_contact_label || null,
            billingMode: 'admin_free',
            isAdminFree: true,
        };

        return NextResponse.json({ account: response }, { status: 201 });
    } catch (e: any) {
        console.error('Create admin account error', e);
        return NextResponse.json({ error: e?.message || 'Failed to create account' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const cookieStore = await cookies();
        const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
        if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const { accountId, businessName, contactLabel, storeUrl, country } = await request.json().catch(() => ({}));
        if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) {
            return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
        }

        const updatePayload: Record<string, any> = {};
        if (typeof businessName === 'string') {
            const trimmedName = businessName.trim();
            if (!trimmedName) return NextResponse.json({ error: 'Business name is required' }, { status: 400 });
            updatePayload.company = trimmedName;
            updatePayload.name = trimmedName;
        }
        if (typeof contactLabel === 'string') {
            const trimmedContact = contactLabel.trim();
            if (trimmedContact.length > 80) {
                return NextResponse.json({ error: 'Contact label must be 80 characters or fewer' }, { status: 400 });
            }
            updatePayload.admin_contact_label = trimmedContact || null;
        }
        if (typeof storeUrl === 'string') {
            const normalized = storeUrl.trim();
            updatePayload.store_url = normalized ? normalized : null;
        }
        if (typeof country === 'string') {
            const trimmedCountry = country.trim();
            updatePayload.country = trimmedCountry || null;
        }
        if (!Object.keys(updatePayload).length) {
            return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
        }

        const service = createServiceClient();
        const { data, error } = await service
            .from('accounts')
            .update(updatePayload)
            .eq('id', accountId)
            .select('id, company, store_url, country, admin_contact_label, billing_mode, owner_user_id')
            .single();
        if (error || !data) {
            console.error('Update admin account failed', error);
            return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
        }

        let ownerEmail: string | null = null;
        if (data.owner_user_id) {
            try {
                const { data: owner } = await (service as any).auth.admin.getUserById(data.owner_user_id);
                ownerEmail = owner?.user?.email || null;
            } catch { /* noop */ }
        }

        const response: AdminAccount = {
            id: data.id,
            businessName: data.company || '',
            storeUrl: data.store_url || null,
            ownerEmail,
            country: data.country || null,
            adminContactLabel: data.admin_contact_label || null,
            billingMode: data.billing_mode === 'admin_free' ? 'admin_free' : 'standard',
            isAdminFree: data.billing_mode === 'admin_free',
        };

        return NextResponse.json({ account: response });
    } catch (e: any) {
        console.error('Update admin account error', e);
        return NextResponse.json({ error: e?.message || 'Failed to update account' }, { status: 500 });
    }
}

// Soft delete an account (admin only). Body: { accountId: string, hard?: boolean }
// Force rebuild - ensuring DELETE handler is included in deployment
export async function DELETE(request: Request) {
    console.log('[DELETE /api/accounts] Request received');
    try {
        const cookieStore = await cookies();
        const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
        const { data: { user } } = await supabase.auth.getUser();
        console.log('[DELETE /api/accounts] User:', user?.id, 'Admin:', user?.app_metadata?.role, user?.app_metadata?.app_role);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
        if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const { accountId, hard } = await request.json().catch(() => ({}));
        console.log('[DELETE /api/accounts] accountId:', accountId, 'hard:', hard);
        if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) {
            return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
        }
        if (accountId === user.id) {
            return NextResponse.json({ error: 'Cannot delete admin root account' }, { status: 400 });
        }

        // Ensure account exists
        const { data: acct, error: acctErr } = await supabase
            .from('accounts')
            .select('id, deleted_at, owner_user_id, billing_mode')
            .eq('id', accountId)
            .maybeSingle();
        if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
        if (!acct) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const ownerMatches = (acct as any).owner_user_id === user.id;
        const isAdminFree = (acct as any).billing_mode === 'admin_free';
        if (ownerMatches && !isAdminFree) {
            return NextResponse.json({ error: 'Cannot delete account you own via admin API' }, { status: 400 });
        }

        if (hard) {
            // Hard delete: rely on ON DELETE CASCADE for children
            const { error: delErr } = await supabase.from('accounts').delete().eq('id', accountId);
            if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
            return NextResponse.json({ status: 'hard-deleted' });
        }

        // Soft delete: set deleted_at and purge children manually for immediate cleanup
        const { error: updErr } = await supabase
            .from('accounts')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', accountId);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

        // Call helper function to purge children (service role needed; fallback: direct deletes)
        // Using RPC would require exposing function; for now attempt direct deletes since RLS allows admin.
        const { error: snapsErr } = await supabase.from('snapshots').delete().eq('account_id', accountId);
        if (snapsErr) return NextResponse.json({ error: snapsErr.message }, { status: 500 });
        const { error: uploadsErr } = await supabase.from('uploads').delete().eq('account_id', accountId);
        if (uploadsErr) return NextResponse.json({ error: uploadsErr.message }, { status: 500 });

        return NextResponse.json({ status: 'soft-deleted' });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 });
    }
}
