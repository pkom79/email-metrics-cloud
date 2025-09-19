import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
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
    return NextResponse.json({ isOwnerAny });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
