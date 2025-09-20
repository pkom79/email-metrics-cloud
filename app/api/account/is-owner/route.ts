import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId');
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_user_id', user.id)
      .limit(1);
    if (error) throw error;
    const isOwnerAny = Array.isArray(data) && data.length > 0;
    let isOwnerOf = null as boolean | null;
    if (accountId) {
      const { data: acc } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', accountId)
        .eq('owner_user_id', user.id)
        .limit(1);
      isOwnerOf = !!(acc && (Array.isArray(acc) ? acc.length : 0));
    }
    return NextResponse.json({ isOwnerAny, isOwnerOf });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
