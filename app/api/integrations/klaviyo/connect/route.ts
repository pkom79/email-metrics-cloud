import { NextRequest } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';
import { encryptSecret } from '../../../../../lib/integrations/crypto';

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const { apiKey } = await req.json().catch(() => ({}));
    if (!apiKey || typeof apiKey !== 'string') return new Response(JSON.stringify({ error: 'apiKey required' }), { status: 400 });

    const supabase = createServiceClient();
    const { data: acct, error: acctErr } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    if (acctErr) throw acctErr;
    const accountId = (acct as any)?.id as string | undefined;
    if (!accountId) return new Response(JSON.stringify({ error: 'NoAccount' }), { status: 404 });

    const blob = encryptSecret(apiKey);
    const { error: upErr } = await supabase
      .from('account_integrations')
      .upsert({ account_id: accountId, provider: 'klaviyo', encrypted_api_key: blob, enabled: true } as any, { onConflict: 'account_id,provider' });
    if (upErr) return new Response(JSON.stringify({ error: 'UpsertFailed', details: upErr.message }), { status: 500 });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}

