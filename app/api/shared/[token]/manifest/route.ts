import { NextResponse } from 'next/server'
import { supabaseAdmin, CSV_BUCKETS } from '../../../../../lib/supabaseAdmin'
import { ALLOWED_CSV_FILES, discoverCsvPaths } from '../../../../../lib/sharedCsv'

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

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token
  const ctx = await getShareContext(token)
  if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })

  // Build a map of discovered CSV paths (handles per-file subfolders)
  const paths = await discoverCsvPaths(
    supabaseAdmin,
    CSV_BUCKETS,
    ctx.snapshots.account_id,
    ctx.snapshots.upload_id,
    ctx.snapshot_id
  )

  // Only expose the *filenames* to the client; keep real paths server-only
  const files = Object.keys(paths).filter((f) => ALLOWED_CSV_FILES.has(f))

  return NextResponse.json({
    snapshotId: ctx.snapshot_id,
    accountId: ctx.snapshots.account_id,
    files
  })
}
