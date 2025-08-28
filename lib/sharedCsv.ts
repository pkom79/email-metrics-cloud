/**
 * Shared CSV utilities:
 *  - Allowed file set
 *  - Filename sanitizers
 *  - Helpers to locate CSVs in Storage even if each is in a different folder
 *
 * We assume structure like:
 *   csv-uploads/{accountId}/{uploadId? or snapshotId? or randomId}/<file>.csv
 *
 * For robustness, we:
 *   1) Try {accountId}/{uploadId}/<file>
 *   2) Try {accountId}/{snapshotId}/<file>
 *   3) Scan one level deeper under pattern {accountId}/<any single folder>/<file>
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

type StorageItem = { name: string; id?: string; metadata?: any }

/**
 * Try to locate a specific CSV path under a handful of prefixes.
 */
export async function findCsvPath(
  client: SupabaseClient,
  bucket: string,
  accountId: string,
  uploadId: string | null,
  snapshotId: string,
  filename: string
): Promise<string | null> {
  // 1) Direct candidates (common case)
  const directCandidates = [
    uploadId ? `${accountId}/${uploadId}/${filename}` : null,
    snapshotId ? `${accountId}/${snapshotId}/${filename}` : null,
  ].filter(Boolean) as string[]

  for (const full of directCandidates) {
    const parent = full.slice(0, full.lastIndexOf('/') + 1)
    const base = full.slice(full.lastIndexOf('/') + 1)
    const { data, error } = await client.storage.from(bucket).list(parent, { limit: 50 })
    if (!error && data?.some((it: StorageItem) => it.name === base)) return full
  }

  // 2) One-level deep scan under the account folder
  const root = `${accountId}/`
  const { data: lvl1, error: e1 } = await client.storage.from(bucket).list(root, { limit: 1000 })
  if (e1 || !lvl1) return null

  // We look into first-level folders only (good balance of coverage and cost)
  for (const dir of lvl1) {
    const maybeDir = (dir as StorageItem)?.name
    if (!maybeDir) continue
    const prefix = `${root}${maybeDir}/`
    const { data: items, error: e2 } = await client.storage.from(bucket).list(prefix, { limit: 100 })
    if (!e2 && items?.some((it: StorageItem) => it.name === filename)) {
      return `${prefix}${filename}`
    }
  }

  return null
}

/**
 * Discover CSV paths for all allowed files. Returns a map: { "campaigns.csv": "account/.../campaigns.csv", ... }
 */
export async function discoverCsvPaths(
  client: SupabaseClient,
  bucket: string,
  accountId: string,
  uploadId: string | null,
  snapshotId: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of ALLOWED_CSV_FILES) {
    const path = await findCsvPath(client, bucket, accountId, uploadId, snapshotId, name)
    if (path) out[name] = path
  }
  return out
}
