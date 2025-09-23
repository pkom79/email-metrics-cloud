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

    const { data: own, error } = await supabase
      .from('accounts')
      .select('id, name, company')
      .eq('owner_user_id', uid);

    if (error) {
      return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
    }

    const accounts = (own || []).map((r: { id: string; name: string | null; company: string | null }) => ({
      id: r.id,
      name: r.name ?? null,
      company: r.company ?? null,
      role: 'owner' as const,
    }));

    return NextResponse.json({ accounts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
