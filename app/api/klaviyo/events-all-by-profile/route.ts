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
    const profileId = searchParams.get('profileId');
    const pageSize = Number(searchParams.get('pageSize') || '25');
    const maxPages = Number(searchParams.get('maxPages') || '5');
    const since = searchParams.get('since') || undefined;
    const revision = searchParams.get('revision') || process.env.KLAVIYO_API_REVISION || '2024-06-15';
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });
    if (!profileId) return new Response(JSON.stringify({ error: 'Missing profileId' }), { status: 400 });

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
    const rawPid = profileId;
  const sinceClause = since ? `,greater-or-equal(timestamp,"${since}")` : '';
    const makeUrl = (filterExpr: string, pageUrl?: string) => pageUrl || `${base}?filter=${encodeURIComponent(filterExpr)}&sort=-datetime&${fieldsEvent}&${fieldsMetric}&${fieldsProfile}&${include}&page[size]=${Math.min(Math.max(pageSize,1),100)}`;
    let url = makeUrl(`and(equals(profile_id,"${rawPid}")${sinceClause})`);
    let pages = 0;
    let triedPerson = false;
    const out: any[] = [];
    while (url && pages < Math.min(Math.max(maxPages,1),20)) {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
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
      if (pages === 1 && out.length === 0 && !triedPerson) {
        triedPerson = true;
        url = makeUrl(`and(equals(person_id,"${rawPid}")${sinceClause})`);
        pages = 0;
      }
    }
    return new Response(JSON.stringify({ ok: true, profileId, since, revision, count: out.length, sample: out.slice(0, pageSize) }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
