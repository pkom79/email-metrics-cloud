import { NextRequest } from 'next/server';
import { fetchAllSubscribedProfiles } from '../../../../lib/klaviyo/client';
import { mapProfilesToRequiredCsvRows } from '../../../../lib/klaviyo/audienceMapping';

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;

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
    const limit = Math.max(1, Math.min(Number(searchParams.get('limit') || '50'), 200));
    const pageSize = Math.max(1, Math.min(Number(searchParams.get('pageSize') || String(limit)), 100));
    const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });

    // Fetch most recent profiles by created desc, client-side filter removes suppressed/unsubscribed
    const profiles = await fetchAllSubscribedProfiles(apiKey, { pageSize, maxPages: 3, sortBy: 'created', sortDir: 'desc' });
    const top = profiles.slice(0, limit);
    const rows = mapProfilesToRequiredCsvRows(top as any);
    // Return a compact projection to quickly spot NEVER_SUBSCRIBED vs SUBSCRIBED
    const minimal = rows.map(r => ({
      email: r['Email'],
      id: r['Klaviyo ID'],
      consent: r['Email Marketing Consent'],
      suppressions: r['Email Suppressions'],
      created: r['Profile Created On'],
      firstActive: r['First Active'],
      lastOpen: r['Last Open'],
    }));
    return new Response(JSON.stringify({ ok: true, count: minimal.length, sample: minimal }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
