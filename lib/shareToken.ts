import { supabaseAdmin } from './supabaseAdmin';

export interface ShareResolution {
  token: string;
  snapshotId: string;
  accountId: string;
  uploadId: string;
  expiresAt: string | null;
  rangeStart?: string;
  rangeEnd?: string;
}

type ShareRow = {
  snapshot_id: string;
  share_token: string;
  is_active: boolean;
  expires_at: string | null;
  snapshots: { id: string; account_id: string; upload_id: string | null; range_start?: string | null; range_end?: string | null } | null;
};

export async function resolveShareTokenStrict(token: string): Promise<ShareResolution> {
  // Primary query including optional range columns (new migration). Falls back if columns absent.
  let query = supabaseAdmin
    .from('snapshot_shares')
    .select('snapshot_id, share_token, is_active, expires_at, snapshots!inner(id,account_id,upload_id,range_start,range_end)')
    .eq('share_token', token)
    .limit(1);

  let { data, error } = await query.maybeSingle<ShareRow>();
  if (error && /range_start|range_end/i.test(error.message || '')) {
    // Fallback without range columns for environments missing migration
    const fallback = await supabaseAdmin
      .from('snapshot_shares')
      .select('snapshot_id, share_token, is_active, expires_at, snapshots!inner(id,account_id,upload_id)')
      .eq('share_token', token)
      .limit(1)
      .maybeSingle<ShareRow>();
    data = fallback.data;
    error = fallback.error;
  }

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
    uploadId: (data.snapshots as any).upload_id,
    expiresAt: data.expires_at,
    rangeStart: (data.snapshots as any).range_start || undefined,
    rangeEnd: (data.snapshots as any).range_end || undefined,
  };
}