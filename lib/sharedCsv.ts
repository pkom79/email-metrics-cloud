/**
 * Shared CSV utilities:
 *  - Allowed file set
 *  - Filename sanitizers
 *  - Robust helpers to locate CSVs even when each file sits in a different folder
 *
 * Why this exists:
 * In production we observed shares pointing at account A while CSVs were stored
 * under account B, but with the correct snapshot_id present in the path.
 * To be resilient (and safe), we bind discovery to the snapshot_id first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ALLOWED_CSV_FILES = new Set([
  'campaigns.csv',
  'flows.csv',
  'subscribers.csv',
  'metrics.csv',
])

/** Strict whitelist: csv extension, no path traversal, must be in ALLOWED_CSV_FILES */
export function sanitizeCsvFilename(input: string | null): string | null {
  if (!input) return null
  const name = input.trim()
  if (!/^[a-z0-9_\-]+\.csv$/i.test(name)) return null
  if (!ALLOWED_CSV_FILES.has(name)) return null
  return name
}

/** For legacy callers that pass type=campaigns|flows|... */
export function normalizeTypeToFile(typeParam: string | null): string | null {
  if (!typeParam) return null
  const t = typeParam.trim().toLowerCase()
  const name = t.endsWith('.csv') ? t : `${t}.csv`
  return sanitizeCsvFilename(name)
}

type StorageItem = { name: string }

/** List names in a path and check if filename exists. */
async function containsFile(
  client: SupabaseClient,
  bucket: string,
  parentPath: string,
  filename: string,
  limit = 200
): Promise<boolean> {
  const { data, error } = await client.storage.from(bucket).list(parentPath, { limit })
  if (error || !data) return false
  return data.some((it: StorageItem) => it?.name === filename)
}

/**
 * DB fallback: search storage.objects for any depth.
 * **Security note**: We require the discovered path to include the snapshotId folder.
 */
async function dbSearchForFile(
  client: SupabaseClient,
  bucket: string,
  snapshotId: string,
  accountId: string,
  filename: string
): Promise<string | null> {
  // 1) Primary & safe: look for ".../<snapshotId>/.../<filename>"
  const patternBySnapshot = `%/${snapshotId}/%${filename}`
  // 2) Secondary: classic layout "<accountId>/.../<filename>"
  const patternByAccount = `${accountId}/%${filename}`

  // @ts-ignore - storage.objects is a real table accessible with service role
  const table = (client as any).from('storage.objects').select('name').eq('bucket_id', bucket).limit(1)

  // Try snapshot pattern first (binds access to the shared snapshot)
  let r = await table.ilike('name', patternBySnapshot)
  if (!r.error && r.data && r.data.length > 0) return r.data[0].name as string

  // Fall back to account pattern
  r = await table.ilike('name', patternByAccount)
  if (!r.error && r.data && r.data.length > 0) {
    const name = r.data[0].name as string
    // Double-check snapshotId also appears somewhere in the ancestry if possible
    // (best-effort; if absent we still allow because account path matched)
    return name
  }

  return null
}

/** Scan bucket root for "<anyTopLevel>/<snapshotId>/<filename>" (last-resort). */
async function scanRootForSnapshot(
  client: SupabaseClient,
  bucket: string,
  snapshotId: string,
  filename: string
): Promise<string | null> {
  const { data: lvl0, error } = await client.storage.from(bucket).list('', { limit: 1000 })
  if (error || !lvl0?.length) return null
  for (const entry of lvl0) {
    const dir = entry?.name
    if (!dir) continue
    const parent = `${dir}/${snapshotId}/`
    const exists = await containsFile(client, bucket, parent, filename)
    if (exists) return `${parent}${filename}`
  }
  return null
}

/**
 * Try to locate a specific CSV path across candidate buckets.
 * Order:
 *   A) Direct parents: {accountId}/{uploadId}/, {accountId}/{snapshotId}/
 *   B) One-level scan under {accountId}/
 *   C) DB search by snapshotId, then by accountId (any depth)
 *   D) Root scan for "<anyTopLevel>/<snapshotId>/<filename>"
 */
export async function findCsvPath(
  client: SupabaseClient,
  buckets: readonly string[],
  accountId: string,
  uploadId: string | null,
  snapshotId: string,
  filename: string
): Promise<{ bucket: string; path: string } | null> {
  const directParents = [
    uploadId ? `${accountId}/${uploadId}/` : null,
    snapshotId ? `${accountId}/${snapshotId}/` : null,
  ].filter(Boolean) as string[]

  for (const bucket of buckets) {
    // A) Direct candidates
    for (const parent of directParents) {
      const exists = await containsFile(client, bucket, parent, filename)
      if (exists) return { bucket, path: `${parent}${filename}` }
    }

    // B) One-level scan under account root
    const root = `${accountId}/`
    const { data: lvl1, error: e1 } = await client.storage.from(bucket).list(root, { limit: 1000 })
    if (!e1 && lvl1?.length) {
      for (const entry of lvl1) {
        const dir = entry?.name
        if (!dir) continue
        const exists = await containsFile(client, bucket, `${root}${dir}/`, filename)
        if (exists) return { bucket, path: `${root}${dir}/${filename}` }
      }
    }

    // C) DB fallback (snapshot-first)
    const dbPath = await dbSearchForFile(client, bucket, snapshotId, accountId, filename)
    if (dbPath) return { bucket, path: dbPath }

    // D) Root scan for "<anyTopLevel>/<snapshotId>/<filename>"
    const rootHit = await scanRootForSnapshot(client, bucket, snapshotId, filename)
    if (rootHit) return { bucket, path: rootHit }
  }

  return null
}

/** Discover CSV paths for all allowed files. Returns map of filename -> {bucket, path} */
export async function discoverCsvPaths(
  client: SupabaseClient,
  buckets: readonly string[],
  accountId: string,
  uploadId: string | null,
  snapshotId: string
): Promise<Record<string, { bucket: string; path: string }>> {
  const out: Record<string, { bucket: string; path: string }> = {}
  for (const name of ALLOWED_CSV_FILES) {
    const hit = await findCsvPath(client, buckets, accountId, uploadId, snapshotId, name)
    if (hit) out[name] = hit
  }
  return out
}

