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

    const out: Array<{ id: string; name: string | null; company: string | null; role: string | null }> = [];
    const seen = new Set<string>();

    // Owner brands
    const { data: own } = await supabase
      .from('accounts')
      .select('id, name, company')
      .eq('owner_user_id', uid);
    for (const r of own || []) {
      if (!seen.has(r.id)) {
        out.push({ id: r.id, name: r.name || null, company: r.company || null, role: 'owner' });
        seen.add(r.id);
      }
    }

    // Explicit memberships
    const { data: mem } = await supabase
      .from('account_users')
      .select('account_id, role, accounts!inner(id, name, company)')
      .eq('user_id', uid);
    for (const r of (mem as any) || []) {
      const acc = r.accounts; if (!acc || seen.has(acc.id)) continue;
      out.push({ id: acc.id, name: acc.name || null, company: acc.company || null, role: r.role || null });
      seen.add(acc.id);
    }

    let result = out;
    if (result.length > 1) {
      const looksLikeEmail = (s: string | null) => !!s && /@/.test(s);
      result = result.filter(a => !(looksLikeEmail(a.name) && !a.company));
      if (result.length === 0) result = out;
    }

    return NextResponse.json({ accounts: result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
