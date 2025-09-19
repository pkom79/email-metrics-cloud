import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Approve a link request using a token (service-role)
export async function POST(request: Request) {
  try {
    const { token } = await request.json().catch(() => ({}));
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: req, error } = await supabaseAdmin
      .from('link_requests')
      .select('id, agency_id, account_id, status, expires_at')
      .eq('token_hash', token_hash)
      .single();
    if (error || !req) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });

    if (req.status !== 'pending' || new Date(req.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Expired or already acted' }, { status: 400 });
    }

    // Link the brand to agency
    const { error: linkErr } = await supabaseAdmin
      .from('agency_accounts')
      .insert({ agency_id: req.agency_id, account_id: req.account_id });
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });

    await supabaseAdmin
      .from('link_requests')
      .update({ status: 'approved', acted_at: new Date().toISOString() })
      .eq('id', req.id);

    try {
      await supabaseAdmin.rpc('audit_log_event', {
        p_action: 'agency_link_approved',
        p_target_table: 'link_requests',
        p_target_id: req.id,
        p_account_id: req.account_id,
        p_details: { agency_id: req.agency_id }
      });
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Approval failed' }, { status: 500 });
  }
}
