import { NextRequest } from 'next/server';
import { mapProfilesToSubscribersCsvRows, toCsv, KlaviyoProfileMinimal } from '../../../../lib/klaviyo/audienceMapping';
import { createServiceClient } from '../../../../lib/supabase/server';

type Mode = 'dry-run' | 'live';
type Format = 'json' | 'csv';

interface RequestBody {
  mode?: Mode;
  format?: Format;
  source?: 'profiles' | 'klaviyo';
  // When source === 'profiles'
  profiles?: KlaviyoProfileMinimal[];
  // Optional metadata for live writes
  accountId?: string;
  uploadId?: string;
}

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;
const AUDIENCE_STAGING_BUCKET = process.env.AUDIENCE_STAGING_BUCKET; // optional; when set, allows live writes to this bucket

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!/application\/json/i.test(contentType)) {
      return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), { status: 415 });
    }

    const body = (await req.json()) as RequestBody;
    const mode: Mode = body.mode ?? 'dry-run';
    const format: Format = body.format ?? 'json';
    const source = body.source ?? 'profiles';

    // Only support provided profiles in this safe staging route.
    if (source !== 'profiles') {
      return new Response(JSON.stringify({ error: 'source=klaviyo not enabled in this environment' }), { status: 501 });
    }

    const profiles = Array.isArray(body.profiles) ? body.profiles : [];
    if (!profiles.length) {
      return new Response(JSON.stringify({ error: 'No profiles provided' }), { status: 400 });
    }

    const rows = mapProfilesToSubscribersCsvRows(profiles);
    const csv = toCsv(rows);

    if (mode === 'live') {
      // For safety: require admin secret and staging bucket before writing.
      const providedSecret = req.headers.get('x-admin-job-secret') || '';
      if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized for live mode' }), { status: 401 });
      }
      if (!AUDIENCE_STAGING_BUCKET) {
        return new Response(JSON.stringify({ error: 'AUDIENCE_STAGING_BUCKET not configured' }), { status: 500 });
      }
      const accountId = body.accountId || 'unknown-account';
      const uploadId = body.uploadId || new Date().toISOString().replace(/[:.]/g, '-');
      // Path is staging-only and does not collide with canonical CSV paths used by the UI.
      const objectPath = `audience-staging/${accountId}/${uploadId}/subscribers.csv`;
      const supabase = createServiceClient();
      const { error } = await supabase.storage
        .from(AUDIENCE_STAGING_BUCKET)
        .upload(objectPath, new Blob([csv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });
      if (error) {
        return new Response(JSON.stringify({ error: 'Failed to write CSV', details: error?.message }), { status: 500 });
      }
      const payload = { mode, wrote: { bucket: AUDIENCE_STAGING_BUCKET, path: objectPath }, rows: rows.length };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // dry-run response
    if (format === 'csv') {
      return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }
    return new Response(
      JSON.stringify({ mode: 'dry-run', rows: rows.length, csvPreview: csv.split('\n').slice(0, 5) }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
