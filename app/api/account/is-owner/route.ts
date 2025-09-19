import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const supabase = createServiceClient();
    const { data, error } = await supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id);
    if (error) throw error;
    const isOwnerAny = (data as any)?.length !== undefined ? (data as any).length > 0 : (data as any) === null && (error as any) === null ? false : (typeof (data as any)?.count === 'number' ? (data as any).count > 0 : true);
    return NextResponse.json({ isOwnerAny });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

