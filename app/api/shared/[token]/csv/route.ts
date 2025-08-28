/**
 * GET /api/shared/[token]/csv?file=<name>.csv
 * Streams a single whitelisted CSV file to anonymous visitors.
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin, CSV_BUCKETS } from '../../../../../lib/supabaseAdmin'
import { sanitizeCsvFilename, locateCsvPath } from '../../../../../lib/storageLocator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ShareRow = {
  snapshot_id: string
  expires_at: string | null
  is_active: boolean | null
}

async function getShareContext(token: string): Promise<ShareRow | null> {
  const { data, error } = await supabaseAdmin
    .from('snapshot_shares')
    .select('snapshot_id, expires_at, is_active')
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
  const filename = sanitizeCsvFilename(url.searchParams.get('file'))
  if (!filename) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })

    const ctx = await getShareContext(params.token)
    if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })

    const hit = await locateCsvPath(supabaseAdmin, CSV_BUCKETS, ctx.snapshot_id, filename)
    if (!hit) {
      console.warn('[shared/csv] not found', {
        token: params.token.slice(0, 6) + '…',
        snap: ctx.snapshot_id,
        filename,
        buckets: CSV_BUCKETS,
      })
      return NextResponse.json({ error: 'CSV not found' }, { status: 404 })
    }

    const { data: blob, error } = await supabaseAdmin.storage.from(hit.bucket).download(hit.path)
    if (error || !blob) {
      console.warn('[shared/csv] download failed', { hit, error })
      return NextResponse.json({ error: 'CSV not found' }, { status: 404 })
    }

    return new NextResponse(blob as any, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
        'Content-Disposition': `inline; filename="${filename}"`,
      }
    })
  } catch (err: any) {
  console.error('[shared/csv] unexpected', err?.message || err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
