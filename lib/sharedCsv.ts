/**
 * Shared CSV utilities:
 *  - Allowed file set
 *  - Filename sanitizers
 *  - Robust helpers to locate CSVs even when each file sits in a different folder
 *
 * We search across candidate buckets, trying:
 *   1) {accountId}/{uploadId}/{file}
 *   2) {accountId}/{snapshotId}/{file}
 *   3) one-level scan under {accountId}/
 *   4) DB fallback: SELECT name FROM storage.objects WHERE bucket_id = ? AND name ILIKE 'accountId/%file'
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

/**
 * List names in a path and check if filename exists.
 */
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
 * DB fallback: search storage.objects for any depth under accountId.
 * Requires service role (we use supabaseAdmin when calling).
 */
async function dbSearchForFile(
  client: SupabaseClient,
  bucket: string,
  accountId: string,
  filename: string
): Promise<string | null> {
  // name examples: "acc123/xyz/campaigns.csv" or "acc123/2024/08/xyz/flows.csv"
  // We match anything that starts with "accountId/" and ends with filename.
  const pattern = `${accountId}/%${filename}`
  // @ts-ignore - storage.objects is a real table accessible with service role
  const { data, error } = await (client as any)
    .from('storage.objects')
    .select('name')
    .eq('bucket_id', bucket)
    .ilike('name', pattern)
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0].name as string
}

/**
 * Try to locate a specific CSV path across candidate buckets.
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
    // 1) Direct candidates
    for (const parent of directParents) {
      const exists = await containsFile(client, bucket, parent, filename)
      if (exists) return { bucket, path: `${parent}${filename}` }
    }

    // 2) One-level scan under account root
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

    // 3) DB fallback: any depth
    const dbPath = await dbSearchForFile(client, bucket, accountId, filename)
    if (dbPath) return { bucket, path: dbPath }
  }

  return null
}

/**
 * Discover CSV paths for all allowed files. Returns map of filename -> {bucket, path}
 */
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

