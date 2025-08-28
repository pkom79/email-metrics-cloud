import { supabaseAdmin, CSV_BUCKETS, ALLOWED_FILES, KEYWORDS, type AllowedFile } from './supabaseAdmin';

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

function prefixOf(accountId: string, uploadId: string) {
  return `${accountId}/${uploadId}`;
}

async function tryExact(bucket: string, accountId: string, uploadId: string, file: AllowedFile) {
  const path = `${prefixOf(accountId, uploadId)}/${file}`;
  const res = await supabaseAdmin.storage.from(bucket).download(path);
  if (res.data && !res.error) return { bucket, path, hit: 'exact' as const };
  return null;
}

async function listUnder(bucket: string, accountId: string, uploadId: string) {
  const pfx = prefixOf(accountId, uploadId);
  const { data, error } = await supabaseAdmin.storage.from(bucket).list(pfx, { limit: 1000, offset: 0 });
  if (error) return { bucket, prefix: pfx, items: [] as { name: string }[], error: error.message };
  return { bucket, prefix: pfx, items: (data ?? []).map(x => ({ name: x.name })) };
}

function chooseBest(canonical: AllowedFile, list: { name: string }[]) {
  const lowered = list.map(x => x.name.toLowerCase());
  const exactIdx = lowered.findIndex(n => n === canonical);
  if (exactIdx >= 0) return list[exactIdx].name;
  const words = KEYWORDS[canonical];
  const keywordHit = lowered.find(n => n.endsWith('.csv') && words.some(w => n.includes(w)));
  if (keywordHit) return keywordHit;
  const anyCsv = lowered.find(n => n.endsWith('.csv'));
  return anyCsv ?? null;
}

export async function locateFile(
  accountId: string,
  uploadId: string,
  file: AllowedFile
): Promise<{ bucket: string; path: string; hit: 'exact' | 'fuzzy' } | null> {
  for (const bucket of CSV_BUCKETS) {
    const exact = await tryExact(bucket, accountId, uploadId, file);
    if (exact) return exact;
  }
  for (const bucket of CSV_BUCKETS) {
    const listing = await listUnder(bucket, accountId, uploadId);
    const chosen = chooseBest(file, listing.items);
    if (chosen) return { bucket, path: `${listing.prefix}/${chosen}`, hit: 'fuzzy' };
  }
  return null;
}

export async function listAvailableFiles(
  accountId: string,
  uploadId: string
): Promise<{
  found: Record<string, { bucket: string; path: string; hit: 'exact' | 'fuzzy' }>;
  listings: Array<{ bucket: string; prefix: string; items: string[]; error?: string }>;
}> {
  const found: Record<string, { bucket: string; path: string; hit: 'exact' | 'fuzzy' }> = {};
  const listings: Array<{ bucket: string; prefix: string; items: string[]; error?: string }> = [];
  const perBucket = await Promise.all(CSV_BUCKETS.map(b => listUnder(b, accountId, uploadId)));
  for (const lb of perBucket) {
    listings.push({ bucket: lb.bucket, prefix: lb.prefix, items: lb.items.map(i => i.name), error: (lb as any).error });
  }
  for (const name of ALLOWED_FILES) {
    let located: { bucket: string; path: string; hit: 'exact' | 'fuzzy' } | null = null;
    for (const bucket of CSV_BUCKETS) {
      const exact = await tryExact(bucket, accountId, uploadId, name);
      if (exact) { located = exact; break; }
    }
    if (!located) {
      for (const lb of perBucket) {
        const chosen = chooseBest(name, lb.items);
        if (chosen) { located = { bucket: lb.bucket, path: `${lb.prefix}/${chosen}`, hit: 'fuzzy' }; break; }
      }
    }
    if (located) found[name] = located;
  }
  return { found, listings };
}

