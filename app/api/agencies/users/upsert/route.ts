import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Upsert an agency user and optionally scope to selected brands.
// POST { agencyId, userEmail, role: 'admin'|'member', allAccounts: boolean, accountIds?: string[] }
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { agencyId, userEmail, role, allAccounts, accountIds } = await request.json().catch(() => ({}));
    if (!agencyId || !userEmail || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    if (!['admin','member'].includes(String(role))) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    const svc = createServiceClient();

    // Caller must be agency owner or admin
    let isAllowed = false;
    try {
      const { data: ag } = await svc.from('agencies').select('owner_user_id').eq('id', agencyId).single();
      if (ag?.owner_user_id === user.id) isAllowed = true;
    } catch {}
    if (!isAllowed) {
      const { data: au } = await svc.from('agency_users').select('role').eq('agency_id', agencyId).eq('user_id', user.id).maybeSingle();
      if (au && (au as any).role === 'admin') isAllowed = true;
    }
    if (!isAllowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Resolve target user by email
    const email = String(userEmail).trim().toLowerCase();
    // Look up by email (list and filter)
    let targetId: string | null = null;
    try {
      for (let page = 1; page <= 10 && !targetId; page++) {
        const { data: list, error: listErr } = await (svc as any).auth.admin.listUsers({ page, perPage: 200 });
        if (listErr) break;
        const hit = (list?.users || []).find((u: any) => (u.email || '').toLowerCase() === email);
        if (hit) { targetId = hit.id; break; }
        if ((list?.users || []).length < 200) break;
      }
    } catch {}
    if (!targetId) {
      // Auto-invite user and return
      try { await (svc as any).auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ''}/signup?mode=signin` }); } catch {}
      return NextResponse.json({ ok: true, invited: true });
    }

    // Upsert agency_users
    await svc.from('agency_users').upsert({ agency_id: agencyId, user_id: targetId, role, all_accounts: !!allAccounts } as any);

    // If scoped, validate accounts belong to agency and upsert agency_user_accounts
    if (!allAccounts) {
      const ids: string[] = Array.isArray(accountIds) ? accountIds : [];
      // Ensure these accounts are linked to the agency
      const { data: linked } = await svc.from('agency_accounts').select('account_id').eq('agency_id', agencyId);
      const valid = new Set((linked || []).map((x: any) => x.account_id));
      const chosen = ids.filter(id => valid.has(id));
      // Replace scoping rows
      await svc.from('agency_user_accounts').delete().eq('agency_id', agencyId).eq('user_id', targetId);
      if (chosen.length) {
        const rows = chosen.map(id => ({ agency_id: agencyId, user_id: targetId, account_id: id }));
        await svc.from('agency_user_accounts').insert(rows as any);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
