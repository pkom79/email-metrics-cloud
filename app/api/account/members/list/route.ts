import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

// GET /api/account/members/list?accountId=...
// Returns owner and member emails for a brand account (owner-only; admin allowed).
export async function GET(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId') || '';
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });

    const svc = createServiceClient();

    // Owner or admin guard
    const { data: acc } = await svc.from('accounts').select('owner_user_id, country').eq('id', accountId).single();
    const isOwner = acc?.owner_user_id === user.id;
    const { data: roles } = await (svc as any).auth.getUser();
    const isAdmin = roles?.data?.user?.app_metadata?.role === 'admin' || roles?.data?.user?.app_metadata?.app_role === 'admin';
    if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Collect members
    const members: Array<{ user_id: string; role: 'owner' | 'member' }> = [];
    if (acc?.owner_user_id) members.push({ user_id: acc.owner_user_id, role: 'owner' });
    const { data: aus } = await svc.from('account_users').select('user_id, role').eq('account_id', accountId);
    for (const r of aus || []) members.push({ user_id: (r as any).user_id, role: (r as any).role });

    // Map to emails
    const out: Array<{ user_id: string; email: string | null; role: string }> = [];
    for (const m of members) {
      try {
        const { data } = await (svc as any).auth.admin.getUserById(m.user_id);
        out.push({ user_id: m.user_id, email: data?.user?.email || null, role: m.role });
      } catch {
        out.push({ user_id: m.user_id, email: null, role: m.role });
      }
    }
    return NextResponse.json({ members: out, country: acc?.country || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

