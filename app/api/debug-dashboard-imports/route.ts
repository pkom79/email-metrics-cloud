import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function safeStat(p: string) {
  try {
    const st = await fs.stat(p);
    return {
      exists: true,
      size: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return { exists: false };
  }
}

export async function GET() {
  try {
    const cwd = process.cwd();
    const now = new Date().toISOString();

    const relTargets = [
      'components/dashboard/DashboardHeavy.tsx',
      'components/dashboard/DetailedMetricChart.tsx',
      'components/dashboard/RevenueReliabilityV2.tsx',
      'components/dashboard/RevenueReliabilityV2/index.ts',
    ];

    const fileProbes: Record<string, any> = {};
    for (const rel of relTargets) {
      const full = path.join(cwd, rel);
      fileProbes[rel] = await safeStat(full);
    }

    // Also report info about this compiled route file as a proxy for build time
    const thisFile = __filename;
    const thisStat = await safeStat(thisFile);

    const data = {
      ok: true,
      now,
      env: {
        node: process.versions.node,
        nextRuntime: (process as any).env?.NEXT_RUNTIME || 'unknown',
        vercel: !!process.env.VERCEL,
        vercelEnv: process.env.VERCEL_ENV || null,
        vercelUrl: process.env.VERCEL_URL || null,
      },
      git: {
        sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
        sha7: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
        message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      },
      process: {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        cwd,
      },
      compiledRoute: {
        file: thisFile,
        stat: thisStat,
        dir: path.dirname(thisFile),
      },
      fileProbes,
    };

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}

