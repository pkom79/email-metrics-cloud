import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId') || '';
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
    const supabase = createServiceClient();

    // Owner check (agency cannot manage members)
    const { data: acct } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('owner_user_id', user.id)
      .single();
    if (!acct) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabase
      .from('invitations')
      .select('id,email,status,created_at')
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ invitations: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

