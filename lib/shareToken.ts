import { supabaseAdmin } from './supabaseAdmin';

export interface ShareResolution {
  token: string;
  snapshotId: string;
  accountId: string;
  uploadId: string;
  expiresAt: string | null;
}

type ShareRow = {
  snapshot_id: string;
  share_token: string;
  is_active: boolean;
  expires_at: string | null;
  snapshots: { id: string; account_id: string; upload_id: string | null } | null;
};

export async function resolveShareTokenStrict(token: string): Promise<ShareResolution> {
  const { data, error } = await supabaseAdmin
    .from('snapshot_shares')
    .select('snapshot_id, share_token, is_active, expires_at, snapshots!inner(id,account_id,upload_id)')
    .eq('share_token', token)
    .limit(1)
    .maybeSingle<ShareRow>();

  if (error) throw new Error(`share lookup failed: ${error.message}`);
  if (!data) throw new Error('share not found');
  if (!data.is_active) throw new Error('share inactive');
  if (data.expires_at && Date.parse(data.expires_at) < Date.now()) throw new Error('share expired');
  if (!data.snapshots) throw new Error('snapshot join missing');
  if (!data.snapshots.upload_id) throw new Error('snapshot missing upload_id');

  return {
    token,
    snapshotId: data.snapshot_id,
    accountId: data.snapshots.account_id,
    uploadId: data.snapshots.upload_id,
    expiresAt: data.expires_at,
  };
}