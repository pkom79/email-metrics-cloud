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
    const bucketName = process.env.AUDIENCE_STAGING_BUCKET || 'audience-staging';

    const { data: bucket, error: bucketError } = await supabase.storage.createBucket(bucketName, {
      public: false,
      allowedMimeTypes: ['text/csv'],
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (bucketError && !bucketError.message?.includes('already exists')) {
      return NextResponse.json({ success: false, error: bucketError.message, step: 'create_bucket' }, { status: 500 });
    }

    // Quick write test
    const testPath = `audience-staging/setup-test/${Date.now()}.csv`;
    const testCsv = 'Email,Email Marketing Consent\nsetup@example.com,Subscribed';
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(testPath, new Blob([testCsv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });
    if (uploadError) {
      return NextResponse.json({ success: false, error: uploadError.message, step: 'upload_test' }, { status: 500 });
    }

    // Clean up test file (best-effort)
    await supabase.storage.from(bucketName).remove([testPath]).catch(() => {});

    return NextResponse.json({ success: true, bucket: bucketName, message: 'audience-staging bucket ready' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: String(err?.message || err) }, { status: 500 });
  }
}
