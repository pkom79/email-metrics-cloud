import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Create a new brand owned by specified user (defaults to creator) and link to agency
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { agencyId, brandName, ownerUserId } = await request.json().catch(() => ({}));
    if (!agencyId || !brandName) {
      return NextResponse.json({ error: 'Missing agencyId or brandName' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify requester is the agency owner
    const { data: ag, error: agErr } = await supabase
      .from('agencies')
      .select('id')
      .eq('id', agencyId)
      .eq('owner_user_id', user.id)
      .single();
    if (agErr || !ag) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const owner = ownerUserId || user.id;
    // Create account
    const { data: acc, error: e1 } = await supabase
      .from('accounts')
      .insert({ name: brandName, owner_user_id: owner })
      .select('id')
      .single();
    if (e1) throw e1;

    // Link to agency
    const { error: e2 } = await supabase
      .from('agency_accounts')
      .insert({ agency_id: agencyId, account_id: acc.id });
    if (e2) throw e2;

    try {
      await supabase.rpc('audit_log_event', {
        p_action: 'agency_link_approved',
        p_target_table: 'agency_accounts',
        p_target_id: acc.id,
        p_account_id: acc.id,
        p_details: { agency_id: agencyId }
      });
    } catch {}

    return NextResponse.json({ ok: true, accountId: acc.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create brand' }, { status: 500 });
  }
}
