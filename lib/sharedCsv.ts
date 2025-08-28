/**
 * Shared CSV utilities
 *
 * Goal: resolve a CSV path even when:
 *  - snapshot.upload_id is null
 *  - files live directly under a different account folder
 *  - some accounts store "<accountId>/<filename>" with NO snapshot folder
 *  - or files are inside "<anyTopLevel>/<snapshotId>/<filename>"
 *
 * Search order (safe → permissive):
 *  A) Explicit parents: {accountId}/{uploadId}/, {accountId}/{snapshotId}/
 *  B) One-level scan under {accountId}/<single-folder>/<filename>
 *  C) Snapshot-first DB search: "%/{snapshotId}/%{filename}"
 *  D) Root scan for "<anyTopLevel>/<snapshotId>/<filename>"
 *  E) NEW: Root scan for "<anyTopLevel>/<filename>"
 *  F) NEW: Global DB search "%/{filename}" (choose best candidate)
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ALLOWED_CSV_FILES = new Set([
  'campaigns.csv',
  'flows.csv',
  'subscribers.csv',
  'metrics.csv',
])

export function sanitizeCsvFilename(input: string | null): string | null {
  if (!input) return null
  const name = input.trim()
  if (!/^[a-z0-9_\-]+\.csv$/i.test(name)) return null
  if (!ALLOWED_CSV_FILES.has(name)) return null
  return name
}

/** Legacy "type" → filename mapping. */
export function normalizeTypeToFile(typeParam: string | null): string | null {
  if (!typeParam) return null
  const t = typeParam.trim().toLowerCase()
  const name = t.endsWith('.csv') ? t : `${t}.csv`
  return sanitizeCsvFilename(name)
}

type StorageItem = { name: string; id?: string }

/** List names in a path and check if filename exists. */
async function containsFile(
  client: SupabaseClient,
  bucket: string,
  parentPath: string,
  filename: string,
  limit = 1000
): Promise<boolean> {
  const { data, error } = await client.storage.from(bucket).list(parentPath, { limit })
  if (error || !data) return false
  return data.some((it: StorageItem) => it?.name === filename)
}

/** Return first child entry names inside parentPath (folders/files). */
async function listChildren(
  client: SupabaseClient,
  bucket: string,
  parentPath: string,
  limit = 1000
): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(parentPath, { limit })
  if (error || !data) return []
  return data.map((x: any) => String(x?.name || '')).filter(Boolean)
}

/** DB search within storage.objects (service role required). */
async function dbSearch(
  client: SupabaseClient,
  bucket: string,
  ilikePattern: string,
  limit = 5
): Promise<string[]> {
  const { data, error } = await (client as any)
    .from('storage.objects')
    .select('name')
    .eq('bucket_id', bucket)
    .ilike('name', ilikePattern)
    .limit(limit)
  if (error || !data) return []
  return (data as Array<{ name: string }>).map((d) => d.name)
}

/** Scan bucket root for "<anyTopLevel>/<snapshotId>/<filename>". */
async function scanRootForSnapshot(
  client: SupabaseClient,
  bucket: string,
  snapshotId: string,
  filename: string
): Promise<string | null> {
  const lvl0 = await listChildren(client, bucket, '')
  for (const dir of lvl0) {
    const parent = `${dir}/${snapshotId}/`
    if (await containsFile(client, bucket, parent, filename)) {
      return `${parent}${filename}`
    }
  }
  return null
}

/** Root scan for "<anyTopLevel>/<filename>" (no snapshot folder). */
async function scanRootForDirectFile(
  client: SupabaseClient,
  bucket: string,
  filename: string
): Promise<string | null> {
  const lvl0 = await listChildren(client, bucket, '')
  for (const dir of lvl0) {
    const parent = `${dir}/`
    if (await containsFile(client, bucket, parent, filename)) {
      return `${parent}${filename}`
    }
  }
  return null
}

/** Find a CSV path across buckets with widening search. */
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
    // A) Direct parents
    for (const parent of directParents) {
      if (await containsFile(client, bucket, parent, filename)) {
        return { bucket, path: `${parent}${filename}` }
      }
    }

    // B) One-level scan under account root
    if (accountId) {
      const root = `${accountId}/`
      const lvl1 = await listChildren(client, bucket, root)
      for (const child of lvl1) {
        const parent = `${root}${child}/`
        if (await containsFile(client, bucket, parent, filename)) {
          return { bucket, path: `${parent}${filename}` }
        }
      }
    }

    // C) Snapshot-first DB search
    const snapHits = await dbSearch(client, bucket, `%/${snapshotId}/%${filename}`)
    if (snapHits.length > 0) return { bucket, path: snapHits[0] }

    // D) Root scan "<anyTopLevel>/<snapshotId>/<filename>"
    const rootSnap = await scanRootForSnapshot(client, bucket, snapshotId, filename)
    if (rootSnap) return { bucket, path: rootSnap }

    // E) Root scan "<anyTopLevel>/<filename>"
    const rootDirect = await scanRootForDirectFile(client, bucket, filename)
    if (rootDirect) return { bucket, path: rootDirect }

    // F) Global DB search for filename anywhere
    const anyHits = await dbSearch(client, bucket, `%/${filename}`)
    if (anyHits.length > 0) {
      const preferred =
        anyHits.find((p) => p.includes(snapshotId)) ??
        anyHits.find((p) => p.startsWith(`${accountId}/`) || p.includes(`/${accountId}/`)) ??
        anyHits[0]
      return { bucket, path: preferred }
    }
  }
  return null
}

/** Discover CSV paths for all allowed files. */
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

