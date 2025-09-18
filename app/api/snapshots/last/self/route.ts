import { NextRequest } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const supabase = createServiceClient();
    const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    const accountId = (acct as any)?.id as string | undefined;
    if (!accountId) return new Response(JSON.stringify({ error: 'NoAccount' }), { status: 404 });
    const { data: snap } = await supabase
      .from('snapshots')
      .select('id, created_at, last_email_date, upload_id, label')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return new Response(JSON.stringify({ latest: snap || null }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

