import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// GET /api/account/is-owner?accountId=optional
// - When accountId provided: returns { isOwnerOf: boolean }
// - When omitted: returns { ownsAny: boolean, firstAccountId?: string }
export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    const svc = createServiceClient();

    if (accountId) {
      const { data, error } = await svc
        .from('accounts')
        .select('owner_user_id')
        .eq('id', accountId)
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
      }
      return NextResponse.json({ isOwnerOf: data?.owner_user_id === user.id });
    }

    const { data } = await svc
      .from('accounts')
      .select('id')
      .eq('owner_user_id', user.id)
      .limit(1);
    const ownsAny = Array.isArray(data) && data.length > 0;
    return NextResponse.json({ ownsAny, firstAccountId: ownsAny ? data![0].id : undefined });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
