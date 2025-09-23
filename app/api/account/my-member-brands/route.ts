import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Returns only brands where the user is an added member (account_users)
// and agency-scoped brands (agency_users -> agency_accounts or agency_user_accounts).
// Intentionally excludes brands owned by the user (accounts.owner_user_id = uid)
// to support manager-only gating on the dashboard.
export async function GET() {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const uid = user.id;
    const supabase = createServiceClient();

    const seen = new Set<string>();
    const out: Array<{ id: string; name: string | null; company: string | null }> = [];

    // 1) Member brands via account_users
    const { data: mem } = await supabase
      .from('account_users')
      .select('account_id, accounts!inner(id, name, company)')
      .eq('user_id', uid);
    for (const r of (mem as any) || []) {
      const acc = r.accounts; if (acc && !seen.has(acc.id)) { out.push(acc); seen.add(acc.id); }
    }

    // 2) Agency-entitled brands
    const { data: ag } = await supabase
      .from('agency_users')
      .select('agency_id, all_accounts')
      .eq('user_id', uid);
    for (const au of ag || []) {
      if (au.all_accounts) {
        const { data: accs } = await supabase
          .from('agency_accounts')
          .select('accounts(id, name, company)')
          .eq('agency_id', au.agency_id);
        for (const r of (accs as any) || []) {
          const acc = r.accounts; if (acc && !seen.has(acc.id)) { out.push(acc); seen.add(acc.id); }
        }
      } else {
        const { data: scoped } = await supabase
          .from('agency_user_accounts')
          .select('account_id, accounts!inner(id, name, company)')
          .eq('agency_id', au.agency_id)
          .eq('user_id', uid);
        for (const r of (scoped as any) || []) {
          const acc = r.accounts; if (acc && !seen.has(acc.id)) { out.push(acc); seen.add(acc.id); }
        }
      }
    }

    return NextResponse.json({ accounts: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

