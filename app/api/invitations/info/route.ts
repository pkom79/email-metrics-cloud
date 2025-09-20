import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Public: returns minimal info for an invitation by token (email + brand name)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || '';
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    const supabase = createServiceClient();
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: inv, error } = await supabase
      .from('invitations')
      .select('id, email, status, expires_at, account_id, accounts!inner(name, company)')
      .eq('token_hash', token_hash)
      .single();
    if (error || !inv) return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    // Check if a Supabase auth user already exists for this email
    let userExists = false;
    try {
      const { data } = await (supabase as any).auth.admin.getUserByEmail(inv.email);
      userExists = !!data?.user?.id;
    } catch {}
    return NextResponse.json({
      email: inv.email,
      accountId: inv.account_id,
      brand: inv.accounts?.company || inv.accounts?.name || 'Brand',
      status: inv.status,
      expiresAt: inv.expires_at,
      userExists,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
