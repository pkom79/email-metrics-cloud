import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Request a link to an existing brand. Only agency owner can request.
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { agencyId, accountId } = await request.json().catch(() => ({}));
    if (!agencyId || !accountId) {
      return NextResponse.json({ error: 'Missing agencyId or accountId' }, { status: 400 });
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

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const { data: lr, error } = await supabase
      .from('link_requests')
      .insert({ agency_id: agencyId, account_id: accountId, token_hash, requested_by: user.id })
      .select('id, account_id')
      .single();
    if (error) throw error;

    // Audit (non-fatal)
    await supabase.rpc('audit_log_event', {
      p_action: 'agency_link_requested',
      p_target_table: 'link_requests',
      p_target_id: lr.id,
      p_account_id: lr.account_id,
      p_details: { agency_id: agencyId }
    }).catch(() => {});

    return NextResponse.json({ ok: true, token: rawToken });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to request link' }, { status: 500 });
  }
}

