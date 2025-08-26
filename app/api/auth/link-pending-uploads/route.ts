import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

// Links any pending uploads (IDs stored in cookie "pending-upload-ids") to the authenticated user's account.
// Idempotent: rows already bound or missing required files are skipped.
export async function POST(request: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = cookies();
    const raw = cookieStore.get('pending-upload-ids')?.value;
    if (!raw) return NextResponse.json({ processedCount: 0, message: 'No pending uploads' });

    let ids: string[] = [];
    try { ids = JSON.parse(raw); } catch { ids = [raw]; }
    ids = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!ids.length) return NextResponse.json({ processedCount: 0, message: 'No valid IDs' });

    const supabase = createServiceClient();
    const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';

    // Ensure account exists
    let accountId: string | undefined;
    {
      const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).limit(1).maybeSingle();
      if (acct?.id) accountId = acct.id; else {
        const md = (user.user_metadata as any) || {};
        const name = (md.name as string)?.trim() || user.email || 'My Account';
        const businessName = (md.businessName as string)?.trim() || '';
        const country = (md.country as string)?.trim() || null;
        const insertPayload: any = { owner_user_id: user.id, name };
        if (businessName) insertPayload.company = businessName;
        if (country) insertPayload.country = country;
        const { data: created, error: createErr } = await supabase.from('accounts').insert(insertPayload).select('id').single();
        if (createErr || !created) return NextResponse.json({ error: 'Failed to create account', details: createErr?.message }, { status: 500 });
        accountId = created.id;
      }
    }

    const required = ['subscribers.csv', 'flows.csv', 'campaigns.csv'];
    const processedResults: any[] = [];
    let processedCount = 0;

    for (const id of ids) {
      try {
        // Verify files exist
        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(id, { limit: 50 });
        if (listErr || !files) { processedResults.push({ id, error: listErr?.message || 'list failed' }); continue; }
        const fileNames = new Set(files.map(f => f.name));
        const missing = required.filter(r => !fileNames.has(r));
        if (missing.length) { processedResults.push({ id, error: `missing: ${missing.join(', ')}` }); continue; }

        // Bind upload row if still preauth/unbound
        const { error: updErr } = await supabase.from('uploads').update({ account_id: accountId, status: 'bound', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'preauth');
        if (updErr) { processedResults.push({ id, error: updErr.message }); continue; }

        // Create snapshot (ignore conflict if one exists)
        const { data: snap, error: snapErr } = await supabase.from('snapshots').insert({ account_id: accountId, upload_id: id, label: 'Imported Data', status: 'ready' }).select('id').single();
        if (snapErr) { processedResults.push({ id, error: snapErr.message }); continue; }

        processedResults.push({ id, snapshotId: snap.id, success: true });
        processedCount++;

        // Fire & forget processing
        fetch(new URL('/api/snapshots/process', request.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: id }) }).catch(() => {});
      } catch (e: any) {
        processedResults.push({ id, error: e?.message || 'failed' });
      }
    }

    // Clear cookie after attempt
    cookieStore.delete('pending-upload-ids');

    return NextResponse.json({ processedCount, totalCount: ids.length, results: processedResults });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to link pending uploads' }, { status: 500 });
  }
}
