import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;
  const provided = request.headers.get('x-admin-job-secret') || '';
  if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const supabase = createServiceClient();
    const bucketName = process.env.FLOW_STAGING_BUCKET || 'flow-staging';

    const { error: bucketError } = await supabase.storage.createBucket(bucketName, {
      public: false,
      allowedMimeTypes: ['text/csv'],
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (bucketError && !bucketError.message?.includes('already exists')) {
      return NextResponse.json({ success: false, error: bucketError.message, step: 'create_bucket' }, { status: 500 });
    }

    const testPath = `flow-staging/setup-test/${Date.now()}.csv`;
    const testCsv = 'Day,Flow ID\n2025-01-01,example';
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(testPath, new Blob([testCsv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });
    if (uploadError) {
      return NextResponse.json({ success: false, error: uploadError.message, step: 'upload_test' }, { status: 500 });
    }

    await supabase.storage.from(bucketName).remove([testPath]).catch(() => {});

    return NextResponse.json({ success: true, bucket: bucketName, message: 'flow-staging bucket ready' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: String(err?.message || err) }, { status: 500 });
  }
}