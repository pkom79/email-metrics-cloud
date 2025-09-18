import { createServiceClient } from '../../../../../lib/supabase/server';
import { getServerUser } from '../../../../../lib/supabase/auth';

export async function GET() {
  try {
    const user = await getServerUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const supabase = createServiceClient();
    const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    const accountId = (acct as any)?.id as string | undefined;
    if (!accountId) return new Response(JSON.stringify({ error: 'NoAccount' }), { status: 404 });
    const { data: ai } = await supabase
      .from('account_integrations')
      .select('id, enabled')
      .eq('account_id', accountId)
      .eq('provider', 'klaviyo')
      .maybeSingle();
    const hasKey = !!ai && (ai as any).enabled !== false;
    return new Response(JSON.stringify({ hasKey }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

