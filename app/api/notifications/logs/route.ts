import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

// Admin-only: list recent notifications_outbox rows
// GET /api/notifications/logs?limit=50&status=all|pending|processing|sent|error|dead
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const userClient = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin = user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin';
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const status = url.searchParams.get('status') || 'all';

    const svc = createServiceClient();
    let q = svc.from('notifications_outbox').select('id, created_at, topic, account_id, recipient_user_id, recipient_email, status, attempts, last_error').order('created_at', { ascending: false }).limit(limit);
    if (status && status !== 'all') q = q.eq('status', status as any);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ logs: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 });
  }
}

