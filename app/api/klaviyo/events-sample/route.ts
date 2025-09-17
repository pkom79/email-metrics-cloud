import { NextRequest } from 'next/server';
import { fetchEventsSampleForMetrics, fetchEventsSampleByMetricIds } from '../../../../lib/klaviyo/client';

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
    const pageSize = Number(searchParams.get('pageSize') || '25');
    const maxPages = Number(searchParams.get('maxPages') || '1');
    const profileId = searchParams.get('profileId') || undefined;
    const since = searchParams.get('since') || undefined; // ISO8601 timestamp to bound lookback
  const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
  const revision = searchParams.get('revision') || process.env.KLAVIYO_API_REVISION || undefined;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });
    }
    const metricsParam = searchParams.get('metrics');
    const metricIdsParam = searchParams.get('metricIds');
    const defaultMetrics = ['Opened Email', 'Clicked Email'];
    const metrics = metricsParam ? metricsParam.split(',').map(s => s.trim()).filter(Boolean) : defaultMetrics;

    // When metricIds are provided, bypass name lookup and fetch directly
    let events: any[] = [];
    if (metricIdsParam) {
      const ids = metricIdsParam.split(',').map(s => s.trim()).filter(Boolean);
      events = await fetchEventsSampleByMetricIds(apiKey, ids, { pageSize, maxPages, profileId, since, revision });
    } else {
      events = await fetchEventsSampleForMetrics(apiKey, metrics, { pageSize, maxPages, profileId, since, revision });
    }
    // If profileId provided, filter results
    const filtered = profileId ? events.filter(e => e.profile_id === profileId) : events;
  const payload = { ok: true, metrics, metricIds: metricIdsParam ? metricIdsParam.split(',').map(s => s.trim()).filter(Boolean) : undefined, profileId, since, revision, count: filtered.length, sample: filtered.slice(0, pageSize) };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
