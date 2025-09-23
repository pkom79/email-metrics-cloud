import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    if (!accountId) {
      return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
    }

    const svc = createServiceClient();
    const { data, error } = await svc
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message || 'Failed to resolve role' }, { status: 500 });
    }
    const isOwner = data?.owner_user_id === user.id;
    return NextResponse.json({ role: isOwner ? 'owner' : null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
