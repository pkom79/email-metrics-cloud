import type { SupabaseClient } from '@supabase/supabase-js'

export const ALLOWED_CSV_FILES = new Set([
  'campaigns.csv',
  'flows.csv',
  'subscribers.csv',
])

export function sanitizeCsvFilename(input: string | null): string | null {
  if (!input) return null
  const name = input.trim()
  if (!/^[a-z0-9_\-]+\.csv$/i.test(name)) return null
  if (!ALLOWED_CSV_FILES.has(name)) return null
  return name
}

type StorageItem = { name: string }

async function listChildren(
  client: SupabaseClient,
  bucket: string,
  parent: string
): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(parent, { limit: 1000 })
  if (error || !data) return []
  return data.map((x: StorageItem | any) => String(x?.name || '')).filter(Boolean)
}

async function dirHasFile(
  client: SupabaseClient,
  bucket: string,
  parent: string,
  filename: string
): Promise<boolean> {
  const { data, error } = await client.storage.from(bucket).list(parent, { limit: 1000 })
  if (error || !data) return false
  return data.some((x: any) => x?.name === filename)
}

async function dbSearch(
  client: SupabaseClient,
  bucket: string,
  pattern: string,
  limit = 5
): Promise<string[]> {
  const { data, error } = await (client as any)
    .from('storage.objects')
    .select('name')
    .eq('bucket_id', bucket)
    .ilike('name', pattern)
    .limit(limit)
  if (error || !data) return []
  return (data as Array<{ name: string }>).map((d) => d.name)
}

export async function locateCsvPath(
  client: SupabaseClient,
  buckets: readonly string[],
  snapshotId: string,
  filename: string
): Promise<{ bucket: string; path: string } | null> {
  for (const bucket of buckets) {
    if (await dirHasFile(client, bucket, `${snapshotId}/`, filename)) {
      return { bucket, path: `${snapshotId}/${filename}` }
    }
    const lvl0 = await listChildren(client, bucket, '')
    for (const top of lvl0) {
      if (await dirHasFile(client, bucket, `${top}/${snapshotId}/`, filename)) {
        return { bucket, path: `${top}/${snapshotId}/${filename}` }
      }
      if (await dirHasFile(client, bucket, `${top}/`, filename)) {
        return { bucket, path: `${top}/${filename}` }
      }
    }
    const bySnap = await dbSearch(client, bucket, `%/${snapshotId}/%${filename}`, 1)
    if (bySnap.length) return { bucket, path: bySnap[0] }
    const anyHit = await dbSearch(client, bucket, `%/${filename}`, 3)
    if (anyHit.length) {
      const preferred = anyHit.find((p) => p.includes(snapshotId)) ?? anyHit[0]
      return { bucket, path: preferred }
    }
  }
  return null
}

export async function discoverAllCsvs(
  client: SupabaseClient,
  buckets: readonly string[],
  snapshotId: string
): Promise<Record<string, { bucket: string; path: string }>> {
  const out: Record<string, { bucket: string; path: string }> = {}
  for (const name of ALLOWED_CSV_FILES) {
    const hit = await locateCsvPath(client, buckets, snapshotId, name)
    if (hit) out[name] = hit
  }
  return out
}
