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

    // Owner accounts
    const { data: own, error: ownErr } = await supabase
      .from('accounts')
      .select('id, name, company')
      .eq('owner_user_id', uid);

    if (ownErr) {
      return NextResponse.json({ error: ownErr.message || 'Failed' }, { status: 500 });
    }

    // Membership accounts (manager/owner rows)
    const { data: memberRows, error: memberErr } = await supabase
      .from('account_users')
      .select('account_id, role')
      .eq('user_id', uid);
    if (memberErr) {
      return NextResponse.json({ error: memberErr.message || 'Failed' }, { status: 500 });
    }

    const memberIds = Array.from(new Set((memberRows || []).map((r: any) => r.account_id).filter(Boolean)));
    let memberAccounts: Array<{ id: string; name: string | null; company: string | null; role: string }> = [];
    if (memberIds.length) {
      const { data: acctRows, error: acctErr } = await supabase
        .from('accounts')
        .select('id, name, company')
        .in('id', memberIds);
      if (acctErr) {
        return NextResponse.json({ error: acctErr.message || 'Failed' }, { status: 500 });
      }
      const roleMap = new Map<string, string>();
      for (const row of memberRows || []) {
        if (row?.account_id) {
          roleMap.set(row.account_id, (row as any).role || 'manager');
        }
      }
      memberAccounts = (acctRows || []).map((r: any) => ({
        id: r.id,
        name: r.name ?? null,
        company: r.company ?? null,
        role: (roleMap.get(r.id) as 'owner' | 'manager') || 'manager',
      }));
    }

    // Merge owner + member (dedupe by id, prefer owner role)
    const mergedMap = new Map<string, { id: string; name: string | null; company: string | null; role: 'owner' | 'manager' }>();
    for (const r of own || []) {
      mergedMap.set((r as any).id, {
        id: (r as any).id,
        name: (r as any).name ?? null,
        company: (r as any).company ?? null,
        role: 'owner',
      });
    }
    for (const r of memberAccounts) {
      if (!mergedMap.has(r.id)) {
        mergedMap.set(r.id, { id: r.id, name: r.name ?? null, company: r.company ?? null, role: (r.role as any) === 'owner' ? 'owner' : 'manager' });
      }
    }

    const accounts = Array.from(mergedMap.values());

    return NextResponse.json({ accounts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
