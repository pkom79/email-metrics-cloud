import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        console.log('manual-link: Starting manual upload linking');
        const user = await getServerUser();
        if (!user) {
            console.log('manual-link: No authenticated user');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const { uploadId } = await request.json();
        if (!uploadId) {
            return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
        }
        
        console.log('manual-link: User:', user.id, 'Upload:', uploadId);
        
        const supabase = createServiceClient();
        const bucket = ingestBucketName();
        
        // Check if upload exists and has files
        const { data: upload } = await supabase
            .from('uploads')
            .select('*')
            .eq('id', uploadId)
            .single();
            
        if (!upload) {
            return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
        }
        
        console.log('manual-link: Upload found:', upload);
        
        // Check if files exist in storage
        const { data: files, error: listErr } = await supabase.storage
            .from(bucket)
            .list(uploadId, { limit: 100 });
            
        if (listErr) {
            console.error('manual-link: Error listing files:', listErr);
            return NextResponse.json({ error: 'Failed to check files: ' + listErr.message }, { status: 500 });
        }
        
        const required = ['subscribers.csv', 'flows.csv', 'campaigns.csv'];
        const present = new Set((files || []).map((f: any) => f.name));
        const missing = required.filter(r => !present.has(r));
        
        console.log('manual-link: Files present:', Array.from(present));
        console.log('manual-link: Missing files:', missing);
        
        if (missing.length > 0) {
            return NextResponse.json({ 
                error: 'Missing required files: ' + missing.join(', '),
                present: Array.from(present),
                missing: missing
            }, { status: 400 });
        }
        
        // Get or create account
        let { data: account } = await supabase
            .from('accounts')
            .select('id')
            .eq('owner_user_id', user.id)
            .single();
            
        if (!account) {
            console.log('manual-link: Creating new account for user');
            const { data: newAccount, error: createErr } = await supabase
                .from('accounts')
                .insert({ 
                    owner_user_id: user.id, 
                    name: user.email || 'My Account'
                })
                .select('id')
                .single();
                
            if (createErr) {
                console.error('manual-link: Error creating account:', createErr);
                return NextResponse.json({ error: 'Failed to create account: ' + createErr.message }, { status: 500 });
            }
            account = newAccount;
        }
        
        console.log('manual-link: Account ID:', account.id);
        
        // Link upload to account
        const { error: updateErr } = await supabase
            .from('uploads')
            .update({ 
                account_id: account.id, 
                status: 'bound', 
                updated_at: new Date().toISOString() 
            })
            .eq('id', uploadId);
            
        if (updateErr) {
            console.error('manual-link: Error updating upload:', updateErr);
            return NextResponse.json({ error: 'Failed to link upload: ' + updateErr.message }, { status: 500 });
        }
        
        // Create snapshot
        const { data: snapshot, error: snapErr } = await supabase
            .from('snapshots')
            .insert({ 
                account_id: account.id, 
                upload_id: uploadId, 
                label: 'Manual Link - ' + new Date().toISOString().split('T')[0],
                status: 'ready' 
            })
            .select('id')
            .single();
            
        if (snapErr) {
            console.error('manual-link: Error creating snapshot:', snapErr);
            return NextResponse.json({ error: 'Failed to create snapshot: ' + snapErr.message }, { status: 500 });
        }
        
        console.log('manual-link: Snapshot created:', snapshot.id);
        
        // Trigger processing
        try {
            await fetch(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/snapshots/process` : 'http://localhost:3000/api/snapshots/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId })
            });
        } catch (e) {
            console.warn('manual-link: Failed to trigger processing:', e);
        }
        
        return NextResponse.json({ 
            success: true,
            accountId: account.id,
            snapshotId: snapshot.id,
            uploadId: uploadId,
            filesFound: Array.from(present)
        });
        
    } catch (e: any) {
        console.error('manual-link: Error:', e);
        return NextResponse.json({ error: e?.message || 'Failed to link upload' }, { status: 500 });
    }
}
