/**
 * GET /api/shared/[token]/csv?file=<name>.csv
 * Streams a single whitelisted CSV file to anonymous visitors.
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin, CSV_BUCKETS } from '../../../../../lib/supabaseAdmin'
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

export async function GET(req: Request, { params }: { params: { token: string } }) {
  try {
    const url = new URL(req.url)
    const file = sanitizeCsvFilename(url.searchParams.get('file'))
    if (!file) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })

    const ctx = await getShareContext(params.token)
    if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })

    // Widened discovery includes root direct and global DB search.
    const hit = await findCsvPath(
      supabaseAdmin,
      CSV_BUCKETS,
      ctx.snapshots.account_id,
      ctx.snapshots.upload_id,
      ctx.snapshot_id,
      file
    )

    if (!hit) {
      console.warn('[shared-csv] not-found', {
        token: params.token.slice(0, 6) + '…',
        file,
        account_id: ctx.snapshots.account_id,
        upload_id: ctx.snapshots.upload_id,
        snapshot_id: ctx.snapshot_id,
        buckets: CSV_BUCKETS,
      })
      return NextResponse.json({ error: 'CSV not found' }, { status: 404 })
    }

    const { data: blob, error } = await supabaseAdmin.storage.from(hit.bucket).download(hit.path)
    if (error || !blob) return NextResponse.json({ error: 'CSV not found' }, { status: 404 })

    return new NextResponse(blob as any, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'private, max-age=60'
      }
    })
  } catch (err: any) {
    console.error('[shared-csv] unexpected error', err?.message || err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
