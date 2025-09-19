import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

// Look up brand accounts by owner email (service-role)
// POST body: { ownerEmail: string }
export async function POST(request: Request) {
  try {
    const { ownerEmail } = await request.json().catch(() => ({}));
    if (!ownerEmail || typeof ownerEmail !== 'string') {
      return NextResponse.json({ error: 'Missing ownerEmail' }, { status: 400 });
    }
    const emailLc = ownerEmail.trim().toLowerCase();

    // Find auth user by email (scan limited pages to find a match)
    let ownerId: string | null = null;
    for (let page = 1; page <= 5 && !ownerId; page++) {
      const { data, error } = await (supabaseAdmin as any).auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const hit = (data?.users || []).find((u: any) => (u.email || '').toLowerCase() === emailLc);
      if (hit) ownerId = hit.id;
      if ((data?.users || []).length < 200) break; // last page
    }
    if (!ownerId) return NextResponse.json({ accounts: [] });

    const { data: accounts, error: accErr } = await supabaseAdmin
      .from('accounts')
      .select('id, name, company')
      .eq('owner_user_id', ownerId);
    if (accErr) throw accErr;
    return NextResponse.json({ accounts: accounts || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Lookup failed' }, { status: 500 });
  }
}

