import { NextResponse } from 'next/server'
import { supabaseAdmin, CSV_BUCKETS } from '../../../../../lib/supabaseAdmin'
import { discoverAllCsvs } from '../../../../../lib/storageLocator'

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

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const ctx = await getShareContext(params.token)
    if (!ctx) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })

    const files = await discoverAllCsvs(supabaseAdmin, CSV_BUCKETS, ctx.snapshot_id)
    return NextResponse.json({ snapshot_id: ctx.snapshot_id, files }, { status: 200 })
  } catch (err: any) {
    console.error('[shared/manifest] unexpected', err?.message || err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
