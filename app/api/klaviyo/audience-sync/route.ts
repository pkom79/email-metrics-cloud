import { NextRequest } from 'next/server';
import { mapProfilesToSubscribersCsvRows, toCsv, KlaviyoProfileMinimal, mapProfilesToSubscribersCsvRowsExtended, mapProfilesToRequiredCsvRows, toCsvWithHeaders } from '../../../../lib/klaviyo/audienceMapping';
import { createServiceClient } from '../../../../lib/supabase/server';
import { fetchAllSubscribedProfiles, fetchEventsSummaryForProfiles } from '../../../../lib/klaviyo/client';

type Mode = 'dry-run' | 'live';
type Format = 'json' | 'csv';

interface RequestBody {
  mode?: Mode;
  format?: Format;
  schema?: 'minimal' | 'extended' | 'required';
  source?: 'profiles' | 'klaviyo';
  // When source === 'profiles'
  profiles?: KlaviyoProfileMinimal[];
  // Optional metadata for live writes
  accountId?: string;
  uploadId?: string;
  // When source === 'klaviyo'
  klaviyoApiKey?: string; // staging-only key
  pageSize?: number;
  maxPages?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  // Optional enrichment
  enrichEvents?: boolean; // when true and schema==='required', attempt to populate First Active / Last Open / Last Click for a subset
  enrichProfileLimit?: number; // default all up to safety cap
  enrichEventsMaxPages?: number; // default 3
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
  const schema = body.schema ?? 'minimal';
    const source = body.source ?? 'profiles';

  let mappedRows: any[] = [];
    if (source === 'profiles') {
      const profiles = Array.isArray(body.profiles) ? body.profiles : [];
      if (!profiles.length) {
        return new Response(JSON.stringify({ error: 'No profiles provided' }), { status: 400 });
      }
      mappedRows = schema === 'extended'
        ? mapProfilesToSubscribersCsvRowsExtended(profiles as any)
        : schema === 'required'
          ? mapProfilesToRequiredCsvRows(profiles as any)
          : mapProfilesToSubscribersCsvRows(profiles);
    } else if (source === 'klaviyo') {
      // Gated by env flag and admin secret; fetch all NOT SUPPRESSED (includes never_subscribed, list imports, Shopify leads).
      if (process.env.KLAVIYO_ENABLE !== 'true') {
        return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
      }
      const providedSecret = req.headers.get('x-admin-job-secret') || '';
      if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized for klaviyo source' }), { status: 401 });
      }
      const apiKey = body.klaviyoApiKey || process.env.KLAVIYO_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });
      }
  const profiles = await fetchAllSubscribedProfiles(apiKey, { pageSize: body.pageSize, maxPages: body.maxPages, sortBy: body.sortBy, sortDir: body.sortDir });
      mappedRows = schema === 'extended'
        ? mapProfilesToSubscribersCsvRowsExtended(profiles as any)
        : schema === 'required'
          ? mapProfilesToRequiredCsvRows(profiles as any)
          : mapProfilesToSubscribersCsvRows(profiles);
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported source' }), { status: 400 });
    }

    // Optional events enrichment (only affects required schema)
    if (schema === 'required' && (body.enrichEvents ?? false)) {
      const apiKey = source === 'klaviyo' ? (body.klaviyoApiKey || process.env.KLAVIYO_API_KEY) : process.env.KLAVIYO_API_KEY;
      if (apiKey) {
        try {
          const ids = (mappedRows as any[]).map(r => r['Klaviyo ID']).filter(Boolean);
          const summary = await fetchEventsSummaryForProfiles(apiKey, ids, { profileLimit: body.enrichProfileLimit, maxPages: body.enrichEventsMaxPages });
          mappedRows = (mappedRows as any[]).map(r => {
            const s = summary[r['Klaviyo ID']];
            if (s) {
              if (!r['First Active']) r['First Active'] = s.firstActive;
              if (!r['Last Open']) r['Last Open'] = s.lastOpen;
              if (!r['Last Click']) r['Last Click'] = s.lastClick;
            }
            return r;
          });
        } catch (e) {
          // Non-fatal; proceed without enrichment
        }
      }
    }

    const rows = mappedRows;
    const requiredHeaders = [
      'Email',
      'Klaviyo ID',
      'First Name',
      'Last Name',
      'Email Marketing Consent',
      'Email Suppressions',
      'Email Suppressions Timestamp',
      'First Active',
      'Last Active',
      'Profile Created On',
      'Last Open',
      'Last Click',
      'Total Customer Lifetime Value',
      'Predicted Customer Lifetime Value',
      'Predicted Number Of Orders',
      'Average Order Value',
      'Average Days Between Orders',
      'Historic Customer Lifetime Value',
      'Historic Number Of Orders',
      'Expected Date Of Next Order',
    ];
    const csv = schema === 'required'
      ? toCsvWithHeaders(rows as any, requiredHeaders)
      : toCsv(rows as any, schema === 'extended');

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
