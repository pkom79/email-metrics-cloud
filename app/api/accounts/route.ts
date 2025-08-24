import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// Returns list of all accounts with owner email & metadata (admin only)
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = user.app_metadata?.role === 'admin';
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Join accounts with owner user info
  const { data, error } = await supabase
    .from('accounts')
    .select('id,name,owner_user_id,owner:owner_user_id(email,raw_app_meta_data)')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const accounts = (data || []).map(a => ({
    id: a.id,
    name: a.name,
    ownerEmail: (a as any).owner?.email || null,
    businessName: (a as any).owner?.raw_app_meta_data?.businessName || null,
    storeUrl: (a as any).owner?.raw_app_meta_data?.storeUrl || null,
  }));

  return NextResponse.json({ accounts });
}
