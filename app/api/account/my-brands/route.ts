import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const uid = user.id;
    const supabase = createServiceClient();

    let out: Array<{ id: string; name: string | null; company: string | null }> = [];
    const seen = new Set<string>();

    // 1) Owner brands
    const { data: own } = await supabase
      .from('accounts')
      .select('id, name, company')
      .eq('owner_user_id', uid);
    for (const r of own || []) {
      if (!seen.has(r.id)) { out.push(r as any); seen.add(r.id); }
    }

    // 2) Member brands
    const { data: mem } = await supabase
      .from('account_users')
      .select('account_id, accounts!inner(id, name, company)')
      .eq('user_id', uid);
    for (const r of (mem as any) || []) {
      const acc = r.accounts; if (acc && !seen.has(acc.id)) { out.push(acc); seen.add(acc.id); }
    }

    // 3) Agency-entitled brands
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

    // If user has multiple entries and one of them looks like a personal placeholder account (name looks like an email and no company), hide it
    if (out.length > 1) {
      const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
      out = out.filter(a => !(looksLikeEmail(a.name) && !a.company));
      // If we filtered everything by mistake, fall back to original
      if (out.length === 0) out = [];
    }
    return NextResponse.json({ accounts: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
