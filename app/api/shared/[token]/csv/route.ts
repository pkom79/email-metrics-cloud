/**
 * GET /api/shared/[token]/csv?file=<name>.csv
 * Streams a single whitelisted CSV file to anonymous visitors.
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin, CSV_BUCKET } from '../../../../../lib/supabaseAdmin'
import { sanitizeCsvFilename, findCsvPath } from '../../../../../lib/sharedCsv'

type ShareRow = {
  snapshot_id: string
  expires_at: string | null
  is_active: boolean | null
  snapshots: { id: string; account_id: string; upload_id: string | null }
}

async function getShareContext(token: string): Promise<ShareRow | null> {
  const { data, error } = await supabaseAdmin
    .from('snapshot_shares')
    .select('snapshot_id, expires_at, is_active, snapshots!inner(id, account_id, upload_id)')
    .eq('share_token', token)
    .maybeSingle<ShareRow>()
  if (error || !data) return null
  if (data.is_active === false) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return data
}

async function resolveStoragePrefix(accountId: string, uploadId: string | null, snapshotId: string) {
  const candidates = [
    `${accountId}/${uploadId}/`,
    `${accountId}/${snapshotId}/`,
  ].filter(Boolean) as string[]

  for (const prefix of candidates) {
    const { data, error } = await supabaseAdmin.storage.from(CSV_BUCKET).list(prefix, { limit: 1 })
    if (!error && data && data.length > 0) return prefix
  }
  return candidates[0] ?? `${accountId}/${snapshotId}/`
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const url = new URL(req.url)
  const file = sanitizeCsvFilename(url.searchParams.get('file'))
  if (!file) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })

  const ctx = await getShareContext(params.token)
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })

  // Find actual path supporting different per-file subfolders
  const path = await findCsvPath(
    supabaseAdmin,
    CSV_BUCKET,
    ctx.snapshots.account_id,
    ctx.snapshots.upload_id,
    ctx.snapshot_id,
    file
  )
  if (!path) return NextResponse.json({ error: 'CSV not found' }, { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(CSV_BUCKET).download(path)
  if (error || !blob) return NextResponse.json({ error: 'CSV not found' }, { status: 404 })

  return new NextResponse(blob as any, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'private, max-age=60'
    }
  })
}
