import { NextRequest } from 'next/server';
import { fetchAllSubscribedProfiles } from '../../../../lib/klaviyo/client';

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;

// Profiles JSON:API allowed fields list (for fields[profile]) per Klaviyo docs / error response
const ALLOWED_PROFILE_FIELDS = [
  'anonymous_id',
  'created',
  'email',
  'external_id',
  'first_name',
  'id',
  'image',
  'last_event_date',
  'last_name',
  'locale',
  'location',
  'organization',
  'phone_number',
  'predictive_analytics',
  'properties',
  'subscriptions',
  'title',
  'updated',
];

export async function GET(req: NextRequest) {
  try {
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }
    const providedSecret = req.headers.get('x-admin-job-secret') || '';
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const pageSize = Number(searchParams.get('pageSize') || '100');
    const maxPages = Number(searchParams.get('maxPages') || '3');
    const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });
    }

    const profiles = await fetchAllSubscribedProfiles(apiKey, { pageSize, maxPages });

    const standardFieldKeys = new Set<string>();
    const propertyKeys = new Set<string>();

    for (const p of profiles) {
      // Collect top-level keys present on our mapped minimal model
      Object.keys(p).forEach((k) => {
        if (k !== 'properties' && k !== 'subscriptions' && k !== 'predictive_analytics' && k !== 'location') {
          standardFieldKeys.add(k);
        }
      });
      // Collect properties bag keys
      const props = (p as any)?.properties || {};
      for (const k of Object.keys(props)) propertyKeys.add(k);
    }

    // Some helpful heuristics to highlight likely engagement keys
    const interestingPatterns = /(first[_\s-]?active|last[_\s-]?open|last[_\s-]?click|opened|clicked|open(ed)?|click(ed)?)/i;
    const interesting = Array.from(propertyKeys).filter((k) => interestingPatterns.test(k));

    const payload = {
      ok: true,
      sampleCount: profiles.length,
      allowedProfileFields: ALLOWED_PROFILE_FIELDS,
      observedStandardFields: Array.from(standardFieldKeys).sort(),
      observedPropertyKeys: Array.from(propertyKeys).sort(),
      interestingPropertyKeys: interesting.sort(),
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
