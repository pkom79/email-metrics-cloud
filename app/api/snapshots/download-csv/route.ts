import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
    try {
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type'); // 'campaigns', 'flows', or 'subscribers'

        if (!type || !['campaigns', 'flows', 'subscribers'].includes(type)) {
            return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
        }

        const supabase = createServiceClient();

        // Find the user's account
        const { data: acct, error: acctErr } = await supabase
            .from('accounts')
            .select('id')
            .eq('owner_user_id', user.id)
            .maybeSingle();
        if (acctErr) throw acctErr;
        if (!acct) return NextResponse.json({ error: 'No account found' }, { status: 404 });

        // Get the latest snapshot for this account
        const { data: snap, error: snapErr } = await supabase
            .from('snapshots')
            .select('upload_id')
            .eq('account_id', acct.id)
            .eq('status', 'ready')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (snapErr) throw snapErr;
        if (!snap) return NextResponse.json({ error: 'No data found' }, { status: 404 });

        // Download the CSV file from storage
        const bucket = process.env.PREAUTH_BUCKET || 'preauth-uploads';
        const fileName = `${type}.csv`;
        const { data: file, error: downloadErr } = await supabase.storage
            .from(bucket)
            .download(`${snap.upload_id}/${fileName}`);

        if (downloadErr) throw downloadErr;
        if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

        // Return the CSV file content as text
        const csvText = await file.text();
        return new Response(csvText, {
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
