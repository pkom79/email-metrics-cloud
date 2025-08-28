/**
 * GET /api/shared/csv?token=<t>&type=<campaigns|flows|subscribers|metrics>
 * Back-compat redirect to the new endpoint.
 */
import { NextResponse } from 'next/server'
import { normalizeTypeToFile } from '../../../../lib/sharedCsv'

export async function GET(req: Request) {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    const file = normalizeTypeToFile(url.searchParams.get('type'))
    if (!token || !file) return NextResponse.json({ error: 'Missing token or type' }, { status: 400 })
    const target = `/api/shared/${encodeURIComponent(token)}/csv?file=${encodeURIComponent(file)}`
    return NextResponse.redirect(target, { status: 307 })
}
