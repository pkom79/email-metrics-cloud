#!/usr/bin/env ts-node
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../lib/integrations/crypto';

async function main() {
  const [,, accountId, apiKey] = process.argv;
  if (!accountId || !apiKey) {
    console.error('Usage: ts-node scripts/set-klaviyo-key.ts <accountId> <klaviyoApiKey>');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');
  const enc = encryptSecret(apiKey);
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await supabase
    .from('account_integrations')
    .upsert({ account_id: accountId, provider: 'klaviyo', encrypted_api_key: enc, enabled: true })
    .select('account_id')
    .maybeSingle();
  if (error) throw error;
  console.log('Saved key for', accountId);
}

main().catch(err => { console.error(err); process.exit(1); });

