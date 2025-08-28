import { NextResponse } from 'next/server'
import { supabaseAdmin, CSV_BUCKETS } from '../../../../../lib/supabaseAdmin'
import { deepDiscoverAllCsvs } from '../../../../../lib/storageLocator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_: Request, { params }: { params: { token: string } }) {
  // Convenience endpoint to inspect what the server sees right now
  const { data, error } = await supabaseAdmin
    .from('snapshot_shares')
    .select('snapshot_id, expires_at, is_active, snapshots!inner(id,account_id,upload_id)')
    .eq('share_token', params.token)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Share not found' }, { status: 404 })

  const result = await deepDiscoverAllCsvs(
    supabaseAdmin,
    CSV_BUCKETS,
    (data as any).snapshot_id ?? (data as any).snapshots?.id
  )

  return NextResponse.json(
    {
      share: {
        token_prefix: params.token.slice(0, 8) + '…',
        is_active: (data as any).is_active,
        expires_at: (data as any).expires_at,
        snapshot_id: (data as any).snapshot_id,
        snapshot_row: (data as any).snapshots ?? null,
      },
      ...result,
    },
    { status: 200, headers: { 'x-debug': '1' } }
  )
}