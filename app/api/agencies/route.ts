import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceClient } from '../../../lib/supabase/server';

export const runtime = 'nodejs';

// Admin-only: list agencies with owner email, limits, users and linked brands
export async function GET() {
  const supaUser = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supaUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = createServiceClient();
  const { data: ags, error } = await svc.from('agencies').select('id,name,owner_user_id,brand_limit,seat_limit,created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const out: any[] = [];
  for (const ag of (ags || [])) {
    // Owner email
    let ownerEmail: string | null = null;
    try { const { data } = await (svc as any).auth.admin.getUserById((ag as any).owner_user_id); ownerEmail = data?.user?.email || null; } catch {}

    // Users
    const users: Array<{ userId: string; email: string | null; role: string; allAccounts: boolean; brandIds?: string[] }> = [];
    try {
      const { data: aus } = await svc.from('agency_users').select('user_id, role, all_accounts').eq('agency_id', (ag as any).id);
      for (const r of (aus || []) as any[]) {
        let email: string | null = null; try { const { data } = await (svc as any).auth.admin.getUserById(r.user_id); email = data?.user?.email || null; } catch {}
        const u: any = { userId: r.user_id, email, role: r.role, allAccounts: r.all_accounts };
        if (!r.all_accounts) {
          try { const { data: sc } = await svc.from('agency_user_accounts').select('account_id').eq('agency_id', (ag as any).id).eq('user_id', r.user_id); u.brandIds = (sc || []).map((x: any) => x.account_id); } catch {}
        }
        users.push(u);
      }
    } catch {}

    // Linked brands
    const brands: Array<{ id: string; label: string }> = [];
    try {
      const { data: aa } = await svc.from('agency_accounts').select('accounts(id,name,company)').eq('agency_id', (ag as any).id);
      for (const row of (aa || []) as any[]) {
        const a = row.accounts; if (a) brands.push({ id: a.id, label: a.company || a.name || a.id });
      }
    } catch {}

    out.push({ id: (ag as any).id, name: (ag as any).name, ownerEmail, brandLimit: (ag as any).brand_limit, seatLimit: (ag as any).seat_limit, createdAt: (ag as any).created_at, users, brands });
  }

  return NextResponse.json({ agencies: out });
}

