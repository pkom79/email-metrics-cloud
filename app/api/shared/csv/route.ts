/**
 * GET /api/shared/csv?token=<t>&type=<campaigns|flows|subscribers|metrics>
 * Back-compat redirect to the new endpoint.
 */
import { NextResponse } from 'next/server'
import { normalizeTypeToFile } from '../../../../lib/sharedCsv'

export async function GET(req: Request) {
    try {
        const url = new URL(req.url)
        const token = url.searchParams.get('token')
        const file = normalizeTypeToFile(url.searchParams.get('type'))
        if (!token || !file) {
            return NextResponse.json({ error: 'Missing or invalid token/type' }, { status: 400 })
        }
        const dest = new URL(`/api/shared/${encodeURIComponent(token)}/csv`, url)
        dest.searchParams.set('file', file)
        return NextResponse.redirect(dest, 307)
    } catch (err) {
        console.error('[compat /api/shared/csv] redirect error:', err)
        return NextResponse.json({ error: 'Compat redirect failed' }, { status: 500 })
    }
}
