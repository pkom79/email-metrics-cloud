import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const now = new Date().toISOString();
    const data = {
      ok: true,
      now,
      env: {
        node: process.versions.node,
        nextRuntime: (process as any).env?.NEXT_RUNTIME || 'unknown',
        vercel: !!process.env.VERCEL,
        vercelEnv: process.env.VERCEL_ENV || null,
      },
      git: {
        sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
        sha7: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
        message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      },
      routeCompiled: {
        file: __filename,
      },
    };
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}

// Accept development probes from client components (safe echo)
export async function POST(req: NextRequest) {
  try {
    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }
    const now = new Date().toISOString();
    return NextResponse.json({
      ok: true,
      now,
      received: payload,
      git: {
        sha7: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}
