import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Secured cron endpoint to trigger master cleanup.
// Allows either:
// - Vercel Cron header (x-vercel-cron), or
// - ADMIN_JOB_SECRET via header, bearer, or token query param.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ADMIN_SECRET = (globalThis as any).process?.env?.ADMIN_JOB_SECRET || process.env.ADMIN_JOB_SECRET;
    const provided = (request.headers.get('x-admin-job-secret') || '').trim();
    const bearer = (request.headers.get('authorization') || '').trim();
    const bearerToken = bearer.toLowerCase().startsWith('bearer ')
      ? bearer.slice(7).trim()
      : '';
    const token = url.searchParams.get('token') || '';
    const isCron = request.headers.has('x-vercel-cron');

    if (!isCron && (!ADMIN_SECRET || (provided !== ADMIN_SECRET && token !== ADMIN_SECRET && bearerToken !== ADMIN_SECRET))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const origin = `${url.protocol}//${url.host}`;
    const res = await fetch(`${origin}/api/cleanup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ADMIN_SECRET ? { 'x-admin-job-secret': ADMIN_SECRET } : {}),
      },
      body: JSON.stringify({}),
    });

    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, cleanup: body }, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Cron failed' }, { status: 500 });
  }
}

