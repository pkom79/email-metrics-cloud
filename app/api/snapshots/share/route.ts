import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceClient } from '../../../../lib/supabase/server';

export async function POST(request: NextRequest) {
    try {
        console.log('🔄 Share creation started');
        
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            console.log('❌ Authentication failed:', authError?.message);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('✅ User authenticated:', user.id);

        // Create service client for snapshot creation if needed
        const serviceClient = createServiceClient();

        const body = await request.json();
    const { title, name, description, expiresIn, snapshotId, csvData, rangeStart, rangeEnd, granularity, compareMode, staticSnapshotJson } = body;
        console.log('📝 Request body:', { title, name, description, expiresIn, snapshotId, hasCsvData: !!csvData });

        let finalSnapshotId = snapshotId;

        // Get user's account (or create if missing)
        let { data: account, error: accountError } = await supabase
            .from('accounts')
            .select('id')
            .eq('owner_user_id', user.id)
            .single();

        if (accountError || !account) {
            console.log('⚠️ No account found for user, creating one...');
            // Create account if it doesn't exist
            const { data: newAccount, error: createError } = await supabase
                .from('accounts')
                .insert({
                    owner_user_id: user.id,
                    name: user.email || 'Account',
                    company: null,
                    country: null
                })
                .select('id')
                .single();

            if (createError || !newAccount) {
                console.error('❌ Failed to create account:', createError);
                return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
            }
            
            console.log('✅ Account created:', newAccount.id);
            account = newAccount;
        } else {
            console.log('✅ Account found:', account.id);
        }

        const accountId = account.id;

        // If no specific snapshot provided, create a temporary one
        if (!finalSnapshotId || finalSnapshotId === 'temp-snapshot') {
            console.log('🔄 Creating new snapshot for sharing...');
            
            // Find the most recent snapshot with data
            // Use a simpler approach that doesn't test storage during creation
            const { data: candidateSnapshots, error: existingError } = await serviceClient
                .from('snapshots')
                .select('upload_id, id, created_at, account_id')
                .eq('status', 'ready')
                .eq('account_id', accountId) // enforce same account to avoid ownership/RLS issues
                .order('created_at', { ascending: false })
                .limit(10);

            console.log('📊 Found candidate snapshots:', candidateSnapshots?.length || 0);

            let uploadId = null;

            if (candidateSnapshots && candidateSnapshots.length > 0) {
                // Look for snapshots with upload_id first (these are more likely to have data)
                let snapshotWithUploadId = candidateSnapshots.find(s => s.upload_id !== null);
                
                if (snapshotWithUploadId) {
                    uploadId = snapshotWithUploadId.upload_id; // upload belongs to this account
                    console.log('Using snapshot with upload_id:', { upload_id: uploadId, account_id: accountId, snapshot_id: snapshotWithUploadId.id });
                } else {
                    // Fallback: use the most recent snapshot's ID as upload_id
                    const recent = candidateSnapshots[0];
                    uploadId = recent.id; // fallback
                    console.log('Using snapshot ID as upload_id:', { upload_id: uploadId, account_id: accountId, snapshot_id: recent.id });
                }
            } else {
                console.log('No snapshots found');
            }

            // Create a snapshot with the upload_id from existing data
            // Use the source account that actually has the data
            // Build insert payload (include range fields if migrations applied)
            const basePayload: any = {
                account_id: accountId,
                label: `Dashboard Share - ${new Date().toLocaleDateString()}`,
                last_email_date: new Date().toISOString().split('T')[0],
                upload_id: uploadId,
                status: uploadId ? 'ready' : 'pending'
            };
            if (rangeStart) basePayload.range_start = rangeStart;
            if (rangeEnd) basePayload.range_end = rangeEnd;

            let newSnapshot: any = null; let snapshotError: any = null;
            const attemptInsert = async (payload: any) => {
                return await serviceClient
                    .from('snapshots')
                    .insert(payload)
                    .select()
                    .single();
            };
            let firstTry = await attemptInsert(basePayload);
            newSnapshot = firstTry.data; snapshotError = firstTry.error;
            // If undefined_column (42703) likely range_start/range_end migrations missing on remote DB. Retry without them.
            if (snapshotError && (snapshotError.code === '42703' || /range_(start|end)/i.test(snapshotError.message || '')) && (basePayload.range_start || basePayload.range_end)) {
                console.warn('⚠️ snapshots table appears to be missing range_start / range_end (', snapshotError.message, '). Retrying insert without range columns. Run migrations to enable date range persistence.');
                delete basePayload.range_start; delete basePayload.range_end;
                const retry = await attemptInsert(basePayload);
                newSnapshot = retry.data; snapshotError = retry.error;
            }

            if (!uploadId) {
                console.warn('No existing upload data for account; rejecting share creation without data');
                return NextResponse.json({ error: 'No dataset available to share yet. Upload reports first.' }, { status: 400 });
            }

            if (snapshotError || !newSnapshot) {
                console.error('❌ Failed to create snapshot:', snapshotError);
                return NextResponse.json({ error: 'Failed to create snapshot for sharing', details: snapshotError?.message || snapshotError }, { status: 500 });
            }

            console.log('✅ Created new snapshot:', newSnapshot.id, 'with upload_id:', uploadId);
            finalSnapshotId = newSnapshot.id;
        } else {
            console.log('✅ Using existing snapshot:', finalSnapshotId);
        }

        // If using existing snapshot and a date range was supplied, update snapshot window (overwrite allowed)
        if (finalSnapshotId && rangeStart && rangeEnd) {
            try {
                await serviceClient.from('snapshots').update({ range_start: rangeStart, range_end: rangeEnd }).eq('id', finalSnapshotId);
            } catch (e) {
                console.warn('Failed to update snapshot date range', e);
            }
        }

        if (!finalSnapshotId) {
            console.error('❌ Snapshot ID is still null after creation');
            return NextResponse.json({ error: 'Snapshot ID is required' }, { status: 400 });
        }

        console.log('🔍 Verifying snapshot ownership for:', finalSnapshotId);
        // Verify user owns the snapshot - simplified query
        const { data: snapshot, error: snapError } = await supabase
            .from('snapshots')
            .select(`
                id,
                account_id,
                label
            `)
            .eq('id', finalSnapshotId)
            .single();

        if (snapError || !snapshot) {
            console.error('Snapshot lookup error:', snapError);
            return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
        }

        // Now verify the account ownership separately
        const { data: snapshotAccount, error: snapshotAccountError } = await supabase
            .from('accounts')
            .select('id, owner_user_id')
            .eq('id', snapshot.account_id)
            .single();

        if (snapshotAccountError || !snapshotAccount) {
            console.error('Account lookup error:', snapshotAccountError);
            return NextResponse.json({ error: 'Account not found for snapshot' }, { status: 404 });
        }

        // Check if user owns this snapshot's account
        if (snapshotAccount.owner_user_id !== user.id) {
            console.error('Access denied: user', user.id, 'does not own account', snapshotAccount.owner_user_id);
            return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }

        console.log('✅ Snapshot ownership verified');

        // Save CSV data to storage if provided
        if (csvData && Object.keys(csvData).length > 0) {
            console.log('Saving CSV data to storage for snapshot:', finalSnapshotId);
            const storageErrors = [];
            
            for (const [type, csvContent] of Object.entries(csvData)) {
                if (csvContent && typeof csvContent === 'string') {
                    try {
                        const fileName = `${type}.csv`;
                        const filePath = `${accountId}/${finalSnapshotId}/${fileName}`;
                        
                        console.log(`Uploading ${type}.csv to:`, filePath);
                        
                        const { error: uploadError } = await serviceClient.storage
                            .from('csv-uploads')
                            .upload(filePath, csvContent, {
                                contentType: 'text/csv',
                                upsert: true
                            });
                        
                        if (uploadError) {
                            console.error(`Failed to upload ${type}.csv:`, uploadError);
                            storageErrors.push(`${type}: ${uploadError.message}`);
                        } else {
                            console.log(`✅ Successfully uploaded ${type}.csv`);
                        }
                    } catch (err) {
                        console.error(`Error uploading ${type}.csv:`, err);
                        storageErrors.push(`${type}: Upload failed`);
                    }
                }
            }
            
            if (storageErrors.length > 0) {
                console.warn('Some CSV files failed to upload:', storageErrors);
                // Continue anyway - the share will still be created
            }
        }

        // Generate a collision-resistant share token (retry on rare collision)
        async function generateUniqueShareToken(maxAttempts = 5): Promise<string> {
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
            function randomToken() {
                let out = '';
                for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
                return out;
            }
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const token = randomToken();
                // Best-effort preflight: see if token exists already (not transactional, but reduces collisions)
                const { data: existing } = await supabase
                    .from('snapshot_shares')
                    .select('id')
                    .eq('share_token', token)
                    .maybeSingle();
                if (!existing) return token;
                console.warn(`⚠️ Share token collision detected (attempt ${attempt}) – regenerating`);
            }
            // Fallback: last generated token (even if collision risk remains)
            return randomToken();
        }

        const shareToken = await generateUniqueShareToken();

        // Calculate expiration if specified
        let expiresAt = null;
        if (expiresIn) {
            const now = new Date();
            switch (expiresIn) {
                case '1hour':
                    expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
                    break;
                case '1day':
                    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                    break;
                case '7days':
                    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30days':
                    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    // No expiration
                    break;
            }
        }

        // Create share record
        console.log('🔄 Creating share record with token:', shareToken);
        console.log('📊 Share details:', { 
            snapshot_id: finalSnapshotId, 
            title: title || `${snapshot.label} - Dashboard`,
            expires_at: expiresAt 
        });

    // Insert share with lightweight collision retry loop (handles race where token created between preflight & insert)
    let shareInsertAttempts = 0;
    let share: any = null;
    let shareError: any = null;
    let tokenForInsert = shareToken;
    while (shareInsertAttempts < 5) {
        const { data: inserted, error: err } = await supabase
            .from('snapshot_shares')
            .insert({
                snapshot_id: finalSnapshotId,
                share_token: tokenForInsert,
                title: title || `${snapshot.label} - Dashboard`,
                description: description || null,
                shared_by_name: name || null,
                created_by: user.id,
                expires_at: expiresAt
            })
            .select()
            .single();
        if (!err) { share = inserted; break; }
        shareError = err;
        // 23505 = unique violation
        if (err?.code === '23505') {
            console.warn('⚠️ Unique constraint violation on share_token – regenerating');
            tokenForInsert = await generateUniqueShareToken();
            shareInsertAttempts++;
            continue;
        }
        break; // Non-collision error – abort loop
    }

        if (shareError) {
            console.error('❌ Failed to create share:', shareError);
            return NextResponse.json({ error: 'Failed to create share', details: shareError.message || shareError }, { status: 500 });
        }

        console.log('✅ Share created successfully:', share.id);

        // Store provided static snapshot JSON (preferred for accuracy) else build from CSV fallback
        try {
            if (staticSnapshotJson && typeof staticSnapshotJson === 'object') {
                // Accept either canonical bundle (schemaVersion present) or legacy wrapper { sharedBundle }
                let bundle = staticSnapshotJson as any;
                if (bundle.sharedBundle && !bundle.schemaVersion) {
                    bundle = bundle.sharedBundle; // unwrap legacy wrapper
                }
                // Basic validation
                const issues: string[] = [];
                if (typeof bundle !== 'object') issues.push('not an object');
                if (!bundle.meta) issues.push('missing meta');
                if (bundle.meta) {
                    if (!bundle.meta.start || !bundle.meta.end) issues.push('missing meta.start/end');
                    if (isNaN(Date.parse(bundle.meta.start))) issues.push('invalid meta.start');
                    if (isNaN(Date.parse(bundle.meta.end))) issues.push('invalid meta.end');
                }
                const numericFieldCheck = (obj: any, path: string) => {
                    if (!obj) return;
                    for (const [k,v] of Object.entries(obj)) {
                        if (typeof v === 'number' && !Number.isFinite(v)) issues.push(`NaN/inf at ${path}.${k}`);
                    }
                };
                ['emailPerformance','campaignPerformance','flowPerformance'].forEach(section => {
                    const sec = bundle[section];
                    if (sec) { numericFieldCheck(sec.totals, section+'.totals'); numericFieldCheck(sec.derived, section+'.derived'); }
                });
                if (issues.length) {
                    console.warn('Provided static snapshot failed validation, storing anyway but flagged:', issues);
                    bundle.__validationIssues = issues;
                }
                const size = Buffer.byteLength(JSON.stringify(bundle),'utf8');
                if (size > 2_000_000) {
                    console.warn('Snapshot bundle larger than 2MB, may be rejected by downstream consumers:', size);
                }
                const { error: updErr } = await supabase.from('snapshot_shares').update({ snapshot_json: bundle }).eq('id', share.id);
                if (updErr) console.warn('Failed to store client-provided static snapshot JSON:', updErr.message || updErr);
            } else {
                // Fallback server build
                const { data: snapFull, error: snapFullErr } = await serviceClient
                    .from('snapshots')
                    .select('id, account_id, upload_id, range_start, range_end')
                    .eq('id', finalSnapshotId)
                    .single();
                if (!snapFullErr && snapFull?.upload_id) {
                    const { buildReducedSnapshot } = await import('../../../../lib/shareStaticBuilder');
                    const reduced = await buildReducedSnapshot({
                        snapshotId: snapFull.id,
                        accountId: snapFull.account_id,
                        uploadId: snapFull.upload_id,
                        rangeStart: snapFull.range_start || rangeStart,
                        rangeEnd: snapFull.range_end || rangeEnd,
                        granularity: granularity || 'daily',
                        compareMode: compareMode || 'prev-period'
                    });
                    try {
                        const { error: updErr } = await supabase.from('snapshot_shares').update({ snapshot_json: reduced }).eq('id', share.id);
                        if (updErr && /snapshot_json/i.test(updErr.message || '')) {
                            console.warn('⚠️ snapshot_shares missing snapshot_json column. Run migration to enable static snapshots. Continuing without stored JSON.');
                        } else if (updErr) {
                            console.warn('Failed to store static snapshot_json:', updErr);
                        }
                    } catch (e:any) {
                        console.warn('snapshot_json update threw unexpectedly:', e?.message || e);
                    }
                }
            }
        } catch (err) {
            console.warn('Failed to prepare static snapshot JSON', err);
        }

        const shareUrl = `${request.nextUrl.origin}/shared/${shareToken}`;

        return NextResponse.json({
            success: true,
            share: {
                id: share.id,
                shareUrl,
                title: share.title,
                expiresAt: share.expires_at
            }
        });

    } catch (error: any) {
        console.error('Share creation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        console.log('GET /api/snapshots/share - Starting request');
        const supabase = createRouteHandlerClient({ cookies });
        
        console.log('GET /api/snapshots/share - Getting user');
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            console.log('GET /api/snapshots/share - Auth error:', authError);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.log('GET /api/snapshots/share - User authenticated:', user.id);

        const { searchParams } = new URL(request.url);
        const snapshotId = searchParams.get('snapshotId');
        console.log('GET /api/snapshots/share - SnapshotId:', snapshotId);

        // Handle temp-snapshot case - don't filter by snapshotId if it's not a valid UUID
        const isValidUUID = snapshotId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId);

        let query = supabase
            .from('snapshot_shares')
            .select(`
                id,
                snapshot_id,
                share_token,
                title,
                description,
                shared_by_name,
                created_at,
                expires_at,
                is_active,
                access_count,
                last_accessed_at
            `)
            .eq('created_by', user.id)
            .order('created_at', { ascending: false });

        if (isValidUUID) {
            query = query.eq('snapshot_id', snapshotId);
        }

        console.log('GET /api/snapshots/share - Executing query');
        const { data: shares, error: sharesError } = await query;

        if (sharesError) {
            console.log('GET /api/snapshots/share - Query error:', sharesError);
            return NextResponse.json({ error: 'Failed to fetch shares', details: sharesError }, { status: 500 });
        }
        console.log('GET /api/snapshots/share - Query successful, shares count:', shares?.length || 0);

        const baseUrl = request.nextUrl.origin;
        const formattedShares = shares.map((share: any) => ({
            id: share.id,
            snapshotId: share.snapshot_id,
            title: share.title,
            description: share.description,
            sharedByName: share.shared_by_name,
            shareUrl: `${baseUrl}/shared/${share.share_token}`,
            createdAt: share.created_at,
            expiresAt: share.expires_at,
            isActive: share.is_active,
            accessCount: share.access_count,
            lastAccessedAt: share.last_accessed_at,
            snapshotLabel: share.title // Use the share title as the label
        }));

        return NextResponse.json({ shares: formattedShares });

    } catch (error: any) {
        console.error('GET /api/snapshots/share - Error:', error);
        return NextResponse.json({ 
            error: 'Internal server error', 
            details: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
}

// Update or delete share
export async function PATCH(request: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { shareId, action, ...updates } = body;

        if (!shareId) {
            return NextResponse.json({ error: 'Share ID is required' }, { status: 400 });
        }

        if (action === 'delete') {
            const { error: deleteError } = await supabase
                .from('snapshot_shares')
                .delete()
                .eq('id', shareId)
                .eq('created_by', user.id);

            if (deleteError) {
                return NextResponse.json({ error: 'Failed to delete share' }, { status: 500 });
            }

            return NextResponse.json({ success: true });
        }

        // Update share
        const { data: updatedShare, error: updateError } = await supabase
            .from('snapshot_shares')
            .update(updates)
            .eq('id', shareId)
            .eq('created_by', user.id)
            .select()
            .single();

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update share' }, { status: 500 });
        }

        return NextResponse.json({ success: true, share: updatedShare });

    } catch (error: any) {
        console.error('Share update error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
