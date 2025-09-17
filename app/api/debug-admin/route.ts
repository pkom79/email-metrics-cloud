import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = process.env.ADMIN_JOB_SECRET || '';
    const klaviyoEnabled = process.env.KLAVIYO_ENABLE === 'true';
    return NextResponse.json({
      ok: true,
      klaviyoEnabled,
      adminSecretConfigured: !!admin,
      adminSecretLength: admin ? admin.length : 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const provided = req.headers.get('x-admin-job-secret') || '';
    const admin = process.env.ADMIN_JOB_SECRET || '';
    const klaviyoEnabled = process.env.KLAVIYO_ENABLE === 'true';
    const match = !!admin && provided === admin;
    return NextResponse.json({
      ok: match,
      klaviyoEnabled,
      adminSecretConfigured: !!admin,
      adminSecretLength: admin ? admin.length : 0,
      headerPresent: !!provided,
      headerLength: provided ? provided.length : 0,
      match,
    }, { status: match ? 200 : 401 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}

