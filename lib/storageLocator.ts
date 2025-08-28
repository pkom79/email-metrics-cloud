import type { SupabaseClient } from '@supabase/supabase-js'

export const ALLOWED_CSV_FILES = new Set(['campaigns.csv', 'flows.csv', 'subscribers.csv'])

export function sanitizeCsvFilename(input: string | null): string | null {
  if (!input) return null
  const name = input.trim()
  if (!/^[a-z0-9_\-]+\.csv$/i.test(name)) return null
  return ALLOWED_CSV_FILES.has(name) ? name : null
}

type ListEntry = { name: string }

/** Safe list: returns [] on error. */
async function list(client: SupabaseClient, bucket: string, prefix: string) {
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) return []
  return data as ListEntry[]
}

async function directoryHasFile(
  client: SupabaseClient,
  bucket: string,
  dirPrefix: string,
  filename: string
) {
  const entries = await list(client, bucket, dirPrefix)
  return entries.some((e) => e.name === filename)
}

/**
 * Deep scan (BFS) up to depth=4 looking for a folder segment that equals snapshotId.
 * Once found, we check that folder for the allowed CSV files.
 * We collect detailed attempts for debugging.
 */
export async function deepDiscoverAllCsvs(
  client: SupabaseClient,
  buckets: readonly string[],
  snapshotId: string,
  maxDepth = 4
): Promise<{
  files: Record<string, { bucket: string; path: string }>
  debug: {
    snapshotId: string
    buckets: readonly string[]
    visited: Array<{ bucket: string; prefix: string; depth: number }>
    candidates: Array<{ bucket: string; dir: string; found: string[] }>
    notes: string[]
  }
}> {
  const files: Record<string, { bucket: string; path: string }> = {}
  const visited: Array<{ bucket: string; prefix: string; depth: number }> = []
  const candidates: Array<{ bucket: string; dir: string; found: string[] }> = []
  const notes: string[] = []

  for (const bucket of buckets) {
    // BFS queue of directory prefixes (always end with '/')
    const q: Array<{ prefix: string; depth: number }> = [{ prefix: '', depth: 0 }]
    // Track prefixes we’ve queued to avoid loops
    const seen = new Set<string>([''])

    while (q.length) {
      const { prefix, depth } = q.shift()!
      visited.push({ bucket, prefix, depth })

      // Stop if we already found all files in this bucket
      if (ALLOWED_CSV_FILES.size === Object.keys(files).length) break
      if (depth > maxDepth) continue

      const entries = await list(client, bucket, prefix)
      for (const e of entries) {
        // An object named like "something.csv" – we only descend into folder-looking entries
        if (e.name.toLowerCase().endsWith('.csv')) continue

        const child = `${prefix}${e.name}/`
        if (!seen.has(child)) {
          seen.add(child)
          q.push({ prefix: child, depth: depth + 1 })
        }

        // When a segment equals snapshotId, test this directory for our CSVs
        if (e.name === snapshotId) {
          const found: string[] = []
          for (const name of ALLOWED_CSV_FILES) {
            if (await directoryHasFile(client, bucket, child, name)) {
              files[name] = { bucket, path: `${child}${name}` }
              found.push(name)
            }
          }
          candidates.push({ bucket, dir: child, found })
        }
      }
    }
  }

  // As a last resort, do a DB search in storage.objects for each filename anywhere with /<snapshotId>/ in path.
  if (Object.keys(files).length === 0) {
    notes.push('BFS found no snapshotId folders; attempting DB ilike search fallbacks.')
    for (const bucket of buckets) {
      for (const name of ALLOWED_CSV_FILES) {
        const { data, error } = await (client as any)
          .from('storage.objects')
          .select('name')
          .eq('bucket_id', bucket)
          .ilike('name', `%/${snapshotId}/%${name}`)
          .limit(1)
        if (!error && data?.length) {
          files[name] = { bucket, path: data[0].name }
          candidates.push({ bucket, dir: data[0].name.replace(name, ''), found: [name] })
        }
      }
    }
  }

  return { files, debug: { snapshotId, buckets, visited, candidates, notes } }
}

/** Single-file lookup using the deep discovery result (helper). */
export async function deepLocateOne(
  client: SupabaseClient,
  buckets: readonly string[],
  snapshotId: string,
  filename: string
): Promise<{ bucket: string; path: string } | null> {
  const { files } = await deepDiscoverAllCsvs(client, buckets, snapshotId)
  return files[filename] ?? null
}
