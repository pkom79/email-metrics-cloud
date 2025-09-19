import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Seed default csv_uploaded subscriptions for all account owners.
// Guarded by ADMIN_JOB_SECRET via Authorization: Bearer, x-admin-job-secret, or token query param.
export async function POST(request: Request) {
  try {
    const ADMIN_SECRET = (globalThis as any).process?.env?.ADMIN_JOB_SECRET || process.env.ADMIN_JOB_SECRET;
    const provided = (request.headers.get('x-admin-job-secret') || '').trim();
    const bearer = (request.headers.get('authorization') || '').trim();
    const bearerToken = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || '';
    if (!ADMIN_SECRET || (provided !== ADMIN_SECRET && token !== ADMIN_SECRET && bearerToken !== ADMIN_SECRET)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: accounts, error: aErr } = await supabase
      .from('accounts')
      .select('id, owner_user_id')
      .is('deleted_at', null);
    if (aErr) throw aErr;

    const owners = (accounts || []).filter((a: any) => a.owner_user_id);
    if (!owners.length) {
      return NextResponse.json({ ok: true, inserted: 0, skipped: 0, totalAccounts: (accounts || []).length });
    }

    const { data: existing, error: eErr } = await supabase
      .from('account_notification_subscriptions')
      .select('account_id, recipient_user_id')
      .eq('topic', 'csv_uploaded');
    if (eErr) throw eErr;

    const existingSet = new Set<string>();
    for (const r of existing || []) {
      if (r.account_id && r.recipient_user_id) {
        existingSet.add(`${r.account_id}:${r.recipient_user_id}`);
      }
    }

    const toInsert: Array<{ account_id: string; topic: 'csv_uploaded'; recipient_user_id: string; enabled: boolean }> = [];
    for (const a of owners) {
      const key = `${a.id}:${a.owner_user_id}`;
      if (!existingSet.has(key)) {
        toInsert.push({ account_id: a.id, topic: 'csv_uploaded', recipient_user_id: a.owner_user_id, enabled: true });
      }
    }

    let inserted = 0;
    const BATCH = 500;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      if (!chunk.length) continue;
      const { error: insErr, count } = await supabase
        .from('account_notification_subscriptions')
        .insert(chunk, { count: 'exact' });
      if (insErr) throw insErr;
      inserted += count || chunk.length;
    }

    return NextResponse.json({ ok: true, inserted, skipped: owners.length - inserted, totalAccounts: owners.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Seed failed' }, { status: 500 });
  }
}

