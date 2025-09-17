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
    const id = searchParams.get('id');
    const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });

    const revision = process.env.KLAVIYO_API_REVISION || '2024-06-15';
    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const base = 'https://a.klaviyo.com/api/profiles';
  const fields = 'fields[profile]=email,first_name,last_name,created,updated,last_event_date,subscriptions,predictive_analytics';
  const additional = 'additional-fields[profile]=subscriptions,predictive_analytics';
  const res = await fetch(`${base}/${encodeURIComponent(id)}?${fields}&${additional}`, { headers });
    const text = await res.text();
    const ok = res.ok;
    let json: any = undefined;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return new Response(JSON.stringify({ ok, status: res.status, body: json ?? text }), { status: ok ? 200 : res.status, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), { status: 500 });
  }
}
