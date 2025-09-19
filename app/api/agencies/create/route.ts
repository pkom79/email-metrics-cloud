import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Create a new Agency owned by the current user, and add owner seat
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, limits } = await request.json().catch(() => ({}));
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const owner_user_id = user.id;

    const { data: agency, error } = await supabase
      .from('agencies')
      .insert({ name, owner_user_id, ...(limits || {}) })
      .select('id')
      .single();
    if (error) throw error;

    // Ensure owner seat exists
    const { error: seatErr } = await supabase
      .from('agency_users')
      .insert({ agency_id: agency.id, user_id: owner_user_id, role: 'owner', all_accounts: true });
    if (seatErr) throw seatErr;

    return NextResponse.json({ ok: true, agencyId: agency.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create agency' }, { status: 500 });
  }
}

