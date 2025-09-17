import { NextRequest } from 'next/server';

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
    const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
    const pageSize = Number(searchParams.get('pageSize') || '25');
    const maxPages = Number(searchParams.get('maxPages') || '2');
    const revision = searchParams.get('revision') || process.env.KLAVIYO_API_REVISION || '2024-06-15';
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });

    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const base = 'https://a.klaviyo.com/api/events';
  const fieldsEvent = 'fields[event]=datetime';
    const fieldsMetric = 'fields[metric]=name';
    const fieldsProfile = 'fields[profile]=email';
    const include = 'include=metric,profile';
  let url = `${base}?sort=-datetime&${fieldsEvent}&${fieldsMetric}&${fieldsProfile}&${include}&page[size]=${Math.min(Math.max(pageSize,1),100)}`;
    const out: any[] = [];
    let pages = 0;
    while (url && pages < Math.min(Math.max(maxPages,1),5)) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return new Response(JSON.stringify({ ok: false, status: res.status, body: txt }), { status: 200 });
      }
      const json: any = await res.json();
      const metricNames = new Map<string, string>();
      const profileEmails = new Map<string, string>();
      for (const inc of (json?.included || [])) {
        if (inc?.type === 'metric' && inc?.id && inc?.attributes?.name) metricNames.set(inc.id, inc.attributes.name);
        if (inc?.type === 'profile' && inc?.id && inc?.attributes?.email) profileEmails.set(inc.id, inc.attributes.email);
      }
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const ev of data) {
        const metricId = ev?.relationships?.metric?.data?.id;
        const relPid = ev?.relationships?.profile?.data?.id;
        out.push({
          time: ev?.attributes?.datetime,
          metric_id: metricId,
          metric: metricId ? metricNames.get(metricId) : undefined,
          profile_id: relPid,
          email: relPid ? profileEmails.get(relPid) : undefined,
        });
      }
      const next = json?.links?.next;
      url = typeof next === 'string' && next ? next : '';
      pages++;
    }
    return new Response(JSON.stringify({ ok: true, count: out.length, sample: out.slice(0, pageSize), revision }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
