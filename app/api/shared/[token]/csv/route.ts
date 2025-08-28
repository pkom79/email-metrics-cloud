/**
 * GET /api/shared/[token]/csv?file=<name>.csv
 * Streams a single whitelisted CSV file to anonymous visitors.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, sanitizeFileParam } from '../../../../../lib/supabaseAdmin';
import { resolveShareStrict, locateFile } from '../../../../../lib/sharedCsv';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const t0 = Date.now();
  const token = params.token;
  const url = new URL(req.url);
  const file = sanitizeFileParam(url.searchParams.get('file'));

  if (!file) {
    return NextResponse.json({ error: 'Missing or invalid file param' }, { status: 400 });
  }

  try {
    const resolved = await resolveShareStrict(token);

  const located = await locateFile(resolved.accountId, resolved.uploadId, file, resolved.snapshotId);
    if (!located) {
      return NextResponse.json(
        {
          error: 'CSV not found',
          debug: {
            tried_exact: [
              `uploads/${resolved.accountId}/${resolved.uploadId}/${file}`,
              `csv-uploads/${resolved.accountId}/${resolved.uploadId}/${file}`,
            ],
            note: 'Also listed under the computed prefix and searched storage.objects by upload_id and snapshot_id; no matches ended with .csv.',
            duration_ms: Date.now() - t0,
          },
        },
        { status: 404 }
      );
    }

    const { data, error } = await supabaseAdmin.storage.from(located.bucket).download(located.path);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message || 'no data'}`);

    const buf = Buffer.from(await data.arrayBuffer());
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store, private',
        'X-CSV-Bucket': located.bucket,
        'X-CSV-Path': located.path,
  'X-CSV-Resolved-Prefix': `${resolved.accountId}/${resolved.uploadId}/`,
  'X-CSV-Hit': located.hit,
  'X-CSV-Resolution-Debug': JSON.stringify(located.debug ?? {}),
        'X-CSV-Duration': String(Date.now() - t0),
      },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      /not found/i.test(msg) ? 404 :
      /inactive|expired/i.test(msg) ? 403 : 500;
    return NextResponse.json(
      { error: msg, debug: { token, file, duration_ms: Date.now() - t0 } },
      { status }
    );
  }
}

// Removed legacy wide locator implementation block.
