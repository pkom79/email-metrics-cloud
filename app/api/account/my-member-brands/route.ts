import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = createServiceClient();
    const { data, error } = await svc
      .from('accounts')
      .select('id, name, company')
      .eq('owner_user_id', user.id);
    if (error) {
      return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
    }

    const accounts = (data || []).map((row: any) => ({
      id: row.id,
      name: row.name || null,
      company: row.company || null,
    }));

    return NextResponse.json({ accounts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}
