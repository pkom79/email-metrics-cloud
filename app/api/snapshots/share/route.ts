import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServiceClient } from '../../../../lib/supabase/server';

export async function POST(request: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { snapshotId, title, description, expiresIn, createSnapshot } = body;

        let finalSnapshotId = snapshotId;

        // If we need to create a snapshot from current data
        if (createSnapshot && (!snapshotId || snapshotId === 'temp-snapshot')) {
            // Use service client for snapshot creation (requires higher privileges)
            const serviceClient = createServiceClient();
            
            // First, get or create the user's account
            const { data: account, error: accountError } = await supabase
                .from('accounts')
                .select('id')
                .eq('owner_user_id', user.id)
                .single();

            let accountId = account?.id;

            if (!accountId) {
                // Create account if it doesn't exist
                const { data: newAccount, error: createAccountError } = await supabase
                    .from('accounts')
                    .insert({
                        owner_user_id: user.id,
                        business_name: title.split(' - ')[0] || 'My Business',
                        label: `${user.email || 'user'}-account`
                    })
                    .select('id')
                    .single();

                if (createAccountError || !newAccount) {
                    return NextResponse.json({ error: 'Failed to create account for snapshot' }, { status: 500 });
                }
                accountId = newAccount.id;
            }

            // Create a snapshot
            // Create a new snapshot with current timestamp
            const { data: newSnapshot, error: snapshotError } = await serviceClient
                .from('snapshots')
                .insert({
                    account_id: accountId,
                    label: `Dashboard Share - ${new Date().toLocaleDateString()}`,
                    last_email_date: new Date().toISOString().split('T')[0]
                })
                .select()
                .single();

            if (snapshotError || !newSnapshot) {
                return NextResponse.json({ error: 'Failed to create snapshot for sharing' }, { status: 500 });
            }

            finalSnapshotId = newSnapshot.id;
        }

        if (!finalSnapshotId) {
            return NextResponse.json({ error: 'Snapshot ID is required' }, { status: 400 });
        }

        // Verify user owns the snapshot or is admin
        const { data: snapshot, error: snapError } = await supabase
            .from('snapshots')
            .select(`
                id,
                account_id,
                label,
                accounts!inner(owner_user_id)
            `)
            .eq('id', finalSnapshotId)
            .single();

        if (snapError || !snapshot) {
            return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
        }

        const isAdmin = user.app_metadata?.role === 'admin';
        const isOwner = (snapshot.accounts as any).owner_user_id === user.id;

        if (!isAdmin && !isOwner) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Generate share token
        const { data: tokenData, error: tokenError } = await supabase
            .rpc('generate_share_token');

        if (tokenError) {
            return NextResponse.json({ error: 'Failed to generate share token' }, { status: 500 });
        }

        const shareToken = tokenData;

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
        const { data: share, error: shareError } = await supabase
            .from('snapshot_shares')
            .insert({
                snapshot_id: finalSnapshotId,
                share_token: shareToken,
                title: title || `${snapshot.label} - Dashboard`,
                description: description || null,
                created_by: user.id,
                expires_at: expiresAt
            })
            .select()
            .single();

        if (shareError) {
            return NextResponse.json({ error: 'Failed to create share' }, { status: 500 });
        }

        const shareUrl = `${request.nextUrl.origin}/shared/${shareToken}`;

        return NextResponse.json({
            success: true,
            shareId: share.id,
            shareToken: shareToken,
            shareUrl: shareUrl,
            expiresAt: expiresAt
        });

    } catch (error: any) {
        console.error('Share creation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// Get list of shares for current user
export async function GET(request: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const snapshotId = searchParams.get('snapshotId');

        let query = supabase
            .from('snapshot_shares')
            .select(`
                id,
                snapshot_id,
                share_token,
                title,
                description,
                created_at,
                expires_at,
                is_active,
                access_count,
                last_accessed_at,
                snapshots!inner(label, created_at)
            `)
            .eq('created_by', user.id)
            .order('created_at', { ascending: false });

        if (snapshotId) {
            query = query.eq('snapshot_id', snapshotId);
        }

        const { data: shares, error: sharesError } = await query;

        if (sharesError) {
            return NextResponse.json({ error: 'Failed to fetch shares' }, { status: 500 });
        }

        const baseUrl = request.nextUrl.origin;
        const formattedShares = shares.map((share: any) => ({
            id: share.id,
            snapshotId: share.snapshot_id,
            title: share.title,
            description: share.description,
            shareUrl: `${baseUrl}/shared/${share.share_token}`,
            createdAt: share.created_at,
            expiresAt: share.expires_at,
            isActive: share.is_active,
            accessCount: share.access_count,
            lastAccessedAt: share.last_accessed_at,
            snapshotLabel: (share.snapshots as any).label
        }));

        return NextResponse.json({ shares: formattedShares });

    } catch (error: any) {
        console.error('Shares fetch error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
