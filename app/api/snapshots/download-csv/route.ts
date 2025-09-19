import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        console.log('CSV Download - Starting request');
        const user = await getServerUser();
        
        console.log('CSV Download - User:', user ? `${user.id} (anonymous: ${user.is_anonymous})` : 'none');
        
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type'); // 'campaigns', 'flows', or 'subscribers'
        const snapshotId = searchParams.get('snapshot_id');
        const overrideAccountId = searchParams.get('account_id');

        console.log('CSV Download - Params:', { type, snapshotId, overrideAccountId });

        if (!type || !['campaigns', 'flows', 'subscribers'].includes(type)) {
            return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
        }

        const supabase = createServiceClient();

        // Check if user is anonymous and accessing a specific snapshot
        const isAnonymous = user.is_anonymous;
        console.log('CSV Download - Is anonymous:', isAnonymous);
        if (isAnonymous) {
            return NextResponse.json({ error: 'Anonymous access disabled (sharing removed)' }, { status: 403 });
        }

        // Regular authenticated user flow (existing logic)
        let targetAccountId: string | null = null;
        if (overrideAccountId && /^[0-9a-fA-F-]{36}$/.test(overrideAccountId)) {
            targetAccountId = overrideAccountId;
        } else {
            const { data: acct, error: acctErr } = await supabase
                .from('accounts')
                .select('id')
                .eq('owner_user_id', user.id)
                .maybeSingle();
            if (acctErr) throw acctErr;
            if (!acct) return NextResponse.json({ error: 'No account found' }, { status: 404 });
            targetAccountId = acct.id;
        }

        // Get the latest snapshot for this account (or specific snapshot if provided)
        let snapQuery = supabase
            .from('snapshots')
            .select('upload_id, account_id')
            .eq('account_id', targetAccountId)
            .eq('status', 'ready');
        
        if (snapshotId) {
            snapQuery = snapQuery.eq('id', snapshotId);
        } else {
            snapQuery = snapQuery.order('created_at', { ascending: false }).limit(1);
        }

        const { data: snap, error: snapErr } = await snapQuery.maybeSingle();
        if (snapErr) throw snapErr;
        if (!snap) return NextResponse.json({ error: 'No data found' }, { status: 404 });
        if (!snap.upload_id) return NextResponse.json({ error: 'No upload data available' }, { status: 404 });

        // Download the CSV file from storage (probe buckets & path variations)
        const fileName = `${type}.csv`;
        // Prefer ingest bucket first (source of truth for new uploads), then legacy paths
        const probe = [
            { bucket: ingestBucketName(), path: `${snap.upload_id}/${fileName}` },
            { bucket: 'uploads', path: `${snap.account_id}/${snap.upload_id}/${fileName}` },
            { bucket: 'csv-uploads', path: `${snap.account_id}/${snap.upload_id}/${fileName}` },
        ];
        let csvText: string | null = null;
        for (const p of probe) {
            const { data: blob, error: dlErr } = await supabase.storage.from(p.bucket).download(p.path);
            if (blob && !dlErr) { csvText = await (blob as Blob).text(); break; }
        }
        if (!csvText) return NextResponse.json({ error: 'File not found' }, { status: 404 });
        return new NextResponse(csvText, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    } catch (e: any) {
        console.error('Download CSV error:', e);
        return NextResponse.json({ error: e?.message || 'Failed to download CSV' }, { status: 500 });
    }
}
