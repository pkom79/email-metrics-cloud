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
    const pageLimit = Number(searchParams.get('pageLimit') || '10');
    const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });

    const revision = process.env.KLAVIYO_API_REVISION || '2024-06-15';
    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const base = 'https://a.klaviyo.com/api/metrics';
    const fields = 'fields[metric]=name';
    let url: string | undefined = `${base}?${fields}`;
    let pages = 0;
    const items: { id: string; name?: string }[] = [];
    while (url && pages < pageLimit) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return new Response(JSON.stringify({ error: 'Failed to fetch metrics', details: text }), { status: 502 });
      }
      const json: any = await res.json();
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const m of data) {
        items.push({ id: m?.id, name: m?.attributes?.name });
      }
      const next = json?.links?.next;
      url = typeof next === 'string' && next ? next : undefined;
      pages++;
    }
    return new Response(JSON.stringify({ ok: true, count: items.length, metrics: items }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
