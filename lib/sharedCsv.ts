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

// ---------- NEW: DB search fallback against storage.objects ----------

type StorageObjectRow = { name: string; bucket_id: string };

async function dbSearchBySubstr(substr: string): Promise<StorageObjectRow[]> {
  // Query internal storage.objects via fully-qualified table name allowed by PostgREST.
  const { data, error } = await supabaseAdmin
    .from('storage.objects')
    .select('name,bucket_id')
    .in('bucket_id', [...CSV_BUCKETS])
    .ilike('name', `%${substr}%`)
    .limit(500);
  if (error) throw new Error(`storage.objects search failed: ${error.message}`);
  return data ?? [];
}

function scoreObjectName(name: string, canonical: AllowedFile): number {
  const n = name.toLowerCase();
  let s = 0;
  if (n.endsWith(`/${canonical}`) || n.endsWith(canonical)) s += 100;
  if (KEYWORDS[canonical].some(w => n.includes(w))) s += 20;
  if (n.endsWith('.csv')) s += 5;
  return s;
}

function pickBestFromDbHits(hits: StorageObjectRow[], canonical: AllowedFile, uploadId?: string, snapshotId?: string) {
  const filtered = hits.filter(h => h.name.toLowerCase().endsWith('.csv'));
  if (filtered.length === 0) return null;
  const withUpload = uploadId ? filtered.filter(h => h.name.includes(uploadId)) : [];
  const withSnap = snapshotId ? filtered.filter(h => h.name.includes(snapshotId)) : [];
  const pool = (withUpload.length ? withUpload : (withSnap.length ? withSnap : filtered));
  let best: StorageObjectRow | null = null;
  let bestScore = -1;
  for (const h of pool) {
    const sc = scoreObjectName(h.name, canonical);
    if (sc > bestScore) { best = h; bestScore = sc; }
  }
  return best;
}

export async function locateFile(
  accountId: string,
  uploadId: string,
  file: AllowedFile,
  snapshotId?: string
): Promise<{
  bucket: string;
  path: string;
  hit: 'exact' | 'fuzzy' | 'db-search';
  debug: Record<string, any>;
} | null> {
  const debug: Record<string, any> = { tried_exact: [], tried_list: [], tried_db_search: [] };
  for (const bucket of CSV_BUCKETS) {
    debug.tried_exact.push(`${bucket}/${accountId}/${uploadId}/${file}`);
    const exact = await tryExact(bucket, accountId, uploadId, file);
    if (exact) return { ...exact, debug };
  }
  const listings = await Promise.all(CSV_BUCKETS.map(b => listUnder(b, accountId, uploadId)));
  debug.tried_list = listings.map(l => ({ bucket: l.bucket, prefix: l.prefix, count: l.items.length, error: (l as any).error }));
  for (const l of listings) {
    const chosen = chooseBest(file, l.items);
    if (chosen) {
      const path = `${l.prefix}/${chosen}`;
      return { bucket: l.bucket, path, hit: 'fuzzy', debug };
    }
  }
  const uploadHits = await dbSearchBySubstr(uploadId);
  debug.tried_db_search.push({ term: uploadId, hitCount: uploadHits.length, sample: uploadHits.slice(0, 5) });
  let picked = pickBestFromDbHits(uploadHits, file, uploadId, snapshotId);
  if (!picked && snapshotId) {
    const snapHits = await dbSearchBySubstr(snapshotId);
    debug.tried_db_search.push({ term: snapshotId, hitCount: snapHits.length, sample: snapHits.slice(0, 5) });
    picked = pickBestFromDbHits(snapHits, file, uploadId, snapshotId);
  }
  if (picked) return { bucket: picked.bucket_id, path: picked.name, hit: 'db-search', debug };
  // Forensic spill: gather sample csv-looking objects containing the uploadId (and snapshotId) for troubleshooting.
  try {
    const spillSamples: any[] = [];
    for (const b of CSV_BUCKETS) {
      // pattern search limited to 25 rows to avoid large responses
      const { data: spill1 } = await supabaseAdmin
        .from('storage.objects')
        .select('name,bucket_id')
        .eq('bucket_id', b)
        .ilike('name', `%${uploadId}%csv`)
        .limit(25);
      if (spill1 && spill1.length) spillSamples.push({ bucket: b, upload_pattern: true, results: spill1 });
      if (snapshotId) {
        const { data: spill2 } = await supabaseAdmin
          .from('storage.objects')
          .select('name,bucket_id')
          .eq('bucket_id', b)
          .ilike('name', `%${snapshotId}%csv`)
          .limit(25);
        if (spill2 && spill2.length) spillSamples.push({ bucket: b, snapshot_pattern: true, results: spill2 });
      }
    }
    if (spillSamples.length) debug.spills = spillSamples;
  } catch (e: any) {
    debug.spills_error = String(e?.message || e);
  }
  return null;
}

export async function listAvailableFiles(
  accountId: string,
  uploadId: string,
  snapshotId?: string
): Promise<{
  found: Record<string, { bucket: string; path: string; hit: 'exact' | 'fuzzy' | 'db-search' }>;
  listings: Array<{ bucket: string; prefix: string; items: string[]; error?: string }>;
  db_hits: Array<{ term: string; results: Array<{ bucket_id: string; name: string }> }>;
}> {
  const found: Record<string, { bucket: string; path: string; hit: 'exact' | 'fuzzy' | 'db-search' }> = {};
  const listings: Array<{ bucket: string; prefix: string; items: string[]; error?: string }> = [];
  const db_hits: Array<{ term: string; results: Array<{ bucket_id: string; name: string }> }> = [];
  const perBucket = await Promise.all(CSV_BUCKETS.map(b => listUnder(b, accountId, uploadId)));
  for (const lb of perBucket) {
    listings.push({ bucket: lb.bucket, prefix: lb.prefix, items: lb.items.map(i => i.name), error: (lb as any).error });
  }
  const hitsUpload = await dbSearchBySubstr(uploadId);
  db_hits.push({ term: uploadId, results: hitsUpload.slice(0, 50) });
  const hitsSnap = snapshotId ? await dbSearchBySubstr(snapshotId) : [];
  if (snapshotId) db_hits.push({ term: snapshotId, results: hitsSnap.slice(0, 50) });
  for (const name of ALLOWED_FILES) {
    let located: { bucket: string; path: string; hit: 'exact' | 'fuzzy' | 'db-search' } | null = null;
    for (const bucket of CSV_BUCKETS) {
      const exact = await tryExact(bucket, accountId, uploadId, name);
      if (exact) { located = { ...exact }; break; }
    }
    if (!located) {
      for (const lb of perBucket) {
        const chosen = chooseBest(name, lb.items);
        if (chosen) { located = { bucket: lb.bucket, path: `${lb.prefix}/${chosen}`, hit: 'fuzzy' }; break; }
      }
    }
    if (!located) {
      const candidate = pickBestFromDbHits(hitsUpload, name, uploadId, snapshotId) ?? pickBestFromDbHits(hitsSnap, name, uploadId, snapshotId);
      if (candidate) located = { bucket: candidate.bucket_id, path: candidate.name, hit: 'db-search' };
    }
    if (located) found[name] = located;
  }
  return { found, listings, db_hits };
}

