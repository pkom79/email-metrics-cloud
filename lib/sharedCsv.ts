import { supabaseAdmin, CSV_BUCKETS, ALLOWED_FILES, type AllowedFile } from './supabaseAdmin';

type ShareRow = {
  snapshot_id: string;
  expires_at: string | null;
  is_active: boolean;
  snapshots: { id: string; account_id: string; upload_id: string | null } | null;
};

export type ShareResolved = {
  token: string;
  snapshotId: string;
  accountId: string;
  uploadId: string;
};

export async function resolveShareStrict(token: string): Promise<ShareResolved> {
  const { data, error } = await supabaseAdmin
    .from('snapshot_shares')
    .select('snapshot_id, expires_at, is_active, snapshots!inner(id,account_id,upload_id)')
    .eq('share_token', token)
    .limit(1)
    .maybeSingle<ShareRow>();

  if (error) throw new Error(`DB lookup failed: ${error.message}`);
  if (!data) throw new Error('Share not found');
  if (!data.is_active) throw new Error('Share inactive');
  if (data.expires_at && Date.parse(data.expires_at) < Date.now()) throw new Error('Share expired');

  const snap = data.snapshots;
  if (!snap) throw new Error('Share missing snapshot join');
  if (!snap.upload_id) throw new Error('Snapshot has no upload_id (cannot locate CSV folder)');

  return { token, snapshotId: data.snapshot_id, accountId: snap.account_id, uploadId: snap.upload_id };
}

export async function findBucketWithFile(
  accountId: string,
  uploadId: string,
  file: AllowedFile
): Promise<{ bucket: string; path: string } | null> {
  const path = `${accountId}/${uploadId}/${file}`;
  for (const bucket of CSV_BUCKETS) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
    if (data && !error) return { bucket, path };
  }
  return null;
}

export async function listAvailableFiles(
  accountId: string,
  uploadId: string
): Promise<Record<string, { bucket: string; path: string }>> {
  const out: Record<string, { bucket: string; path: string }> = {};
  for (const name of ALLOWED_FILES as readonly AllowedFile[]) {
    const found = await findBucketWithFile(accountId, uploadId, name);
    if (found) out[name] = found;
  }
  return out;
}
// Strict share resolution utilities (account/upload based)

