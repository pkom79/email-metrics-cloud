import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Test helper: seeds a subscription and enqueues an audit event, then triggers the worker.
// Guarded by ADMIN_JOB_SECRET via header x-admin-job-secret or token query param.
// POST body: { accountId: string, email?: string, userId?: string }
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

    const { accountId, email, userId } = await request.json().catch(() => ({}));
    if (!accountId || (!email && !userId)) {
      return NextResponse.json({ error: 'accountId and recipient (email or userId) required' }, { status: 400 });
    }
    const supabase = createServiceClient();

    // Ensure a subscription exists for csv_uploaded
    if (email) {
      await supabase
        .from('account_notification_subscriptions')
        .upsert({ account_id: accountId, topic: 'csv_uploaded', recipient_email: email, enabled: true } as any);
    } else if (userId) {
      await supabase
        .from('account_notification_subscriptions')
        .upsert({ account_id: accountId, topic: 'csv_uploaded', recipient_user_id: userId, enabled: true } as any);
    }

    // Emit an audit event to enqueue into outbox
    await supabase.rpc('audit_log_event', {
      p_action: 'csv_uploaded',
      p_target_table: 'csv_files',
      p_target_id: null,
      p_account_id: accountId,
      p_details: { test: true }
    });

    // Kick worker (same origin)
    try {
      const origin = `${url.protocol}//${url.host}`;
      const res = await fetch(`${origin}/api/cron/notifications`);
      const info = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: res.ok, worker: info });
    } catch (e: any) {
      return NextResponse.json({ ok: true, worker: { error: e?.message || 'Worker not invoked' } });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Test failed' }, { status: 500 });
  }
}
