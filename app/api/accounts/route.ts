import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceClient } from '../../../lib/supabase/server';

// Returns list of all accounts with owner email & metadata (admin only)
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin = user.app_metadata?.role === 'admin';
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Use service client to also fetch owner emails via Auth Admin API
    const service = createServiceClient();
    const { data, error } = await supabase
        .from('accounts')
        .select('id,name,company,store_url,deleted_at,created_at,owner_user_id')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Collect unique owner user IDs
    const ownerIds = Array.from(new Set((data || []).map(r => (r as any).owner_user_id).filter(Boolean)));
    const emailMap: Record<string, string> = {};
    for (const oid of ownerIds) {
        try {
            const { data: usr } = await (service as any).auth.admin.getUserById(oid);
            if (usr?.user?.email) emailMap[oid] = usr.user.email;
        } catch { /* ignore individual failures */ }
    }
    const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
    const trimmed = (s: string | null) => (s && s.trim()) || null;
    const rawAccounts = (data || []).map(a => ({
        id: (a as any).id as string,
        ownerUserId: (a as any).owner_user_id as string | null,
        company: trimmed((a as any).company as string | null),
        name: trimmed((a as any).name as string | null),
        storeUrl: (a as any).store_url || null,
    }));

    let derived = rawAccounts.map(a => {
        let businessName: string | null = null;
        if (a.company && !looksLikeEmail(a.company)) businessName = a.company;
        else if (a.name && !looksLikeEmail(a.name)) businessName = a.name;
        return { id: a.id, businessName, storeUrl: a.storeUrl, ownerEmail: a.ownerUserId ? emailMap[a.ownerUserId] || null : null };
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

// Soft delete an account (admin only). Body: { accountId: string, hard?: boolean }
export async function DELETE(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const isAdmin = user.app_metadata?.role === 'admin';
        if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const { accountId, hard } = await request.json().catch(() => ({}));
        if (!accountId || !/^[0-9a-fA-F-]{36}$/.test(accountId)) {
            return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
        }
        if (accountId === user.id) {
            return NextResponse.json({ error: 'Cannot delete admin root account' }, { status: 400 });
        }

        // Ensure account exists
        const { data: acct, error: acctErr } = await supabase
            .from('accounts')
            .select('id, deleted_at, owner_user_id')
            .eq('id', accountId)
            .maybeSingle();
        if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });
        if (!acct) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if ((acct as any).owner_user_id === user.id) {
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
