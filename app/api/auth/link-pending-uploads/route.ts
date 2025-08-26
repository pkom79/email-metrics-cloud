import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

// Links any pending uploads (IDs stored in cookie "pending-upload-ids") to the authenticated user's account.
// Idempotent: rows already bound or missing required files are skipped.
export async function POST(request: Request) {
  try {
    console.log('=== LINK-PENDING-UPLOADS START ===');
    const user = await getServerUser();
    if (!user) {
      console.log('link-pending-uploads: No authenticated user');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.log('link-pending-uploads: User authenticated:', { id: user.id, email: user.email });

    const cookieStore = cookies();
    const raw = cookieStore.get('pending-upload-ids')?.value;
    console.log('link-pending-uploads: Raw cookie value:', raw);
    
    // Also log all cookies for debugging
    const allCookies = Array.from(cookieStore.getAll()).map(c => ({ name: c.name, value: c.value.substring(0, 50) + '...' }));
    console.log('link-pending-uploads: All cookies:', allCookies);
    
    if (!raw) {
      console.log('link-pending-uploads: No pending-upload-ids cookie found');
      return NextResponse.json({ processedCount: 0, message: 'No pending uploads' });
    }

    let ids: string[] = [];
    try { ids = JSON.parse(raw); } catch { ids = [raw]; }
    ids = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    console.log('link-pending-uploads: Parsed upload IDs:', ids);
    if (!ids.length) {
      console.log('link-pending-uploads: No valid upload IDs found');
      return NextResponse.json({ processedCount: 0, message: 'No valid IDs' });
    }

    const supabase = createServiceClient();
    const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';

    // Ensure account exists
    let accountId: string | undefined;
    {
      console.log('link-pending-uploads: Looking for existing account for user:', user.id);
      const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).limit(1).maybeSingle();
      if (acct?.id) {
        accountId = acct.id;
        console.log('link-pending-uploads: Found existing account:', accountId);
      } else {
        console.log('link-pending-uploads: Creating new account for user:', user.id);
        const md = (user.user_metadata as any) || {};
        const name = (md.name as string)?.trim() || user.email || 'My Account';
        const businessName = (md.businessName as string)?.trim() || '';
        const country = (md.country as string)?.trim() || null;
        const insertPayload: any = { owner_user_id: user.id, name };
        if (businessName) insertPayload.company = businessName;
        if (country) insertPayload.country = country;
        console.log('link-pending-uploads: Account payload:', insertPayload);
        const { data: created, error: createErr } = await supabase.from('accounts').insert(insertPayload).select('id').single();
        if (createErr || !created) {
          console.error('link-pending-uploads: Failed to create account:', createErr?.message);
          return NextResponse.json({ error: 'Failed to create account', details: createErr?.message }, { status: 500 });
        }
        accountId = created.id;
        console.log('link-pending-uploads: Created new account:', accountId);
      }
    }

    const required = ['subscribers.csv', 'flows.csv', 'campaigns.csv'];
    const processedResults: any[] = [];
    let processedCount = 0;

    for (const id of ids) {
      try {
        console.log(`link-pending-uploads: Processing upload ID: ${id}`);
        // Verify files exist
        const { data: files, error: listErr } = await supabase.storage.from(bucket).list(id, { limit: 50 });
        if (listErr || !files) { 
          console.error(`link-pending-uploads: Failed to list files for ${id}:`, listErr?.message);
          processedResults.push({ id, error: listErr?.message || 'list failed' }); 
          continue; 
        }
        const fileNames = new Set(files.map(f => f.name));
        console.log(`link-pending-uploads: Found files for ${id}:`, Array.from(fileNames));
        const missing = required.filter(r => !fileNames.has(r));
        if (missing.length) { 
          console.error(`link-pending-uploads: Missing required files for ${id}:`, missing);
          processedResults.push({ id, error: `missing: ${missing.join(', ')}` }); 
          continue; 
        }

        // Bind upload row if still preauth/unbound
        console.log(`link-pending-uploads: Binding upload ${id} to account ${accountId}`);
        const { error: updErr } = await supabase.from('uploads').update({ account_id: accountId, status: 'bound', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'preauth');
        if (updErr) { 
          console.error(`link-pending-uploads: Failed to bind upload ${id}:`, updErr.message);
          processedResults.push({ id, error: updErr.message }); 
          continue; 
        }

        // Create snapshot (ignore conflict if one exists)
        console.log(`link-pending-uploads: Creating snapshot for upload ${id}`);
        const { data: snap, error: snapErr } = await supabase.from('snapshots').insert({ account_id: accountId, upload_id: id, label: 'Imported Data', status: 'ready' }).select('id').single();
        if (snapErr) { 
          console.error(`link-pending-uploads: Failed to create snapshot for ${id}:`, snapErr.message);
          processedResults.push({ id, error: snapErr.message }); 
          continue; 
        }

        console.log(`link-pending-uploads: Successfully processed ${id}, snapshot: ${snap.id}`);
        processedResults.push({ id, snapshotId: snap.id, success: true });
        processedCount++;

        // Fire & forget processing
        console.log(`link-pending-uploads: Triggering processing for upload ${id}`);
        fetch(new URL('/api/snapshots/process', request.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: id }) }).catch((err) => {
          console.error(`link-pending-uploads: Failed to trigger processing for ${id}:`, err);
        });
      } catch (e: any) {
        console.error(`link-pending-uploads: Unexpected error processing ${id}:`, e);
        processedResults.push({ id, error: e?.message || 'failed' });
      }
    }

    // Clear cookie after attempt
    console.log('link-pending-uploads: Clearing pending-upload-ids cookie');
    cookieStore.delete('pending-upload-ids');

    const result = { processedCount, totalCount: ids.length, results: processedResults };
    console.log('link-pending-uploads: Final result:', result);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('link-pending-uploads: Unexpected error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to link pending uploads' }, { status: 500 });
  }
}
