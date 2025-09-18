import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export async function POST() {
  try {
    const user = await getServerUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const supabase = createServiceClient();
    const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    const accountId = (acct as any)?.id as string | undefined;
    if (!accountId) return new Response(JSON.stringify({ error: 'NoAccount' }), { status: 404 });
    // Either delete the row or mark disabled; use delete for clarity
    const { error } = await supabase
      .from('account_integrations')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'klaviyo');
    if (error) return new Response(JSON.stringify({ error: 'DeleteFailed', details: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

