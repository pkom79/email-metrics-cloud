import { NextRequest } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function bearerOk(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.VERCEL_CRON_SECRET || '';
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  return auth === expected;
}

export async function GET(req: NextRequest) {
  try {
    if (!bearerOk(req)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }

    const supabase = createServiceClient();
    const { data: intRows, error: intErr } = await supabase
      .from('account_integrations')
      .select('account_id, enabled')
      .eq('provider', 'klaviyo')
      .eq('enabled', true);
    if (intErr) throw intErr;
    const accountIds: string[] = Array.from(new Set((intRows || []).map((r: any) => String(r.account_id || '')))).filter(Boolean) as string[];

    const originUrl = new URL(req.url); originUrl.pathname = ''; originUrl.search = ''; const origin = originUrl.origin;
    const today = new Date();
    const idempotency = `nightly-${today.toISOString().slice(0,10)}`;
    const maxAccounts = Math.max(1, Math.min(Number(process.env.CRON_MAX_ACCOUNTS || '10'), 100));
    const delayMs = Math.max(0, Math.min(Number(process.env.CRON_ACCOUNT_SPACING_MS || '1000'), 10000));

    const results: Array<{ accountId: string; ran: boolean; skipped: string | null; status?: number; }> = [];

    for (let i = 0; i < accountIds.length && results.filter(r => r.ran).length < maxAccounts; i++) {
      const accountId = accountIds[i];
      // Check account not deleted
      const { data: acc, error: accErr } = await supabase.from('accounts').select('deleted_at').eq('id', accountId).maybeSingle();
      if (accErr) { results.push({ accountId, ran: false, skipped: 'account_lookup_error' }); continue; }
      if ((acc as any)?.deleted_at) { results.push({ accountId, ran: false, skipped: 'deleted' }); continue; }

      // Find latest snapshot and staleness
      const { data: snap, error: snapErr } = await supabase
        .from('snapshots')
        .select('last_email_date')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snapErr) { results.push({ accountId, ran: false, skipped: 'snapshot_lookup_error' }); continue; }
      const lastEmailDateVal = (snap as any)?.last_email_date as string | null | undefined;
      const last = lastEmailDateVal ? new Date(String(lastEmailDateVal) + 'T00:00:00Z') : null;
      if (!last) { results.push({ accountId, ran: false, skipped: 'no_last_email_date' }); continue; }
      const ageDays = Math.floor((Date.now() - last.getTime()) / 86400000);
      if (ageDays > 7) { results.push({ accountId, ran: false, skipped: 'stale_over_7_days' }); continue; }

      // Compute start/end window (cap 30 days). Overlap last 7 days to refresh attribution changes.
      const start = new Date(last.getTime() - (6 * 86400000));
      const end = new Date();
      const spanDays = Math.max(1, Math.min(Math.floor((end.getTime() - start.getTime()) / 86400000) + 1, 30));
      const startStr = start.toISOString().slice(0,10);
      const endStr = end.toISOString().slice(0,10);

      const res = await fetch(`${origin}/api/dashboard/update`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-job-secret': process.env.ADMIN_JOB_SECRET || '',
          'x-idempotency-key': idempotency,
        },
        body: JSON.stringify({ mode: 'live', accountId, start: startStr, end: endStr, days: spanDays }),
      });
      results.push({ accountId, ran: true, skipped: null, status: res.status });
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }

    const summary = {
      considered: accountIds.length,
      ran: results.filter(r => r.ran).length,
      skipped: results.filter(r => !r.ran).length,
      results,
    };
    return new Response(JSON.stringify(summary), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
