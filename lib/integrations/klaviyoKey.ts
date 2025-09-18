import { createServiceClient } from '../supabase/server';
import { decryptSecret } from './crypto';

export async function getAccountKlaviyoApiKey(accountId: string): Promise<string | null> {
  if (!accountId) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('account_integrations')
    .select('encrypted_api_key, enabled')
    .eq('account_id', accountId)
    .eq('provider', 'klaviyo')
    .maybeSingle();
  if (error || !data || (data as any).enabled === false) return null;
  try {
    return decryptSecret((data as any).encrypted_api_key as string);
  } catch {
    return null;
  }
}

