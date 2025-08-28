import { notFound, redirect } from 'next/navigation';
import { createServiceClient } from '../../../lib/supabase/server';
import SharedDashboard from './SharedDashboard';

interface PageProps {
    params: {
        token: string;
    };
}

export default async function SharedDashboardPage({ params }: PageProps) {
    const { token } = params;

    try {
        const supabase = createServiceClient();

        // First, check if this share token exists and is active
        const { data: shareExists, error: existsError } = await supabase
            .from('snapshot_shares')
            .select('id, is_active, expires_at')
            .eq('share_token', token)
            .single();

        // If share doesn't exist (never existed or was deleted), redirect to expired page
        if (existsError || !shareExists) {
            redirect(`/shared/${token}/expired`);
        }

        // If share exists but is inactive or expired, show expired page
        if (!shareExists.is_active ||
            (shareExists.expires_at && new Date(shareExists.expires_at) < new Date())) {
            redirect(`/shared/${token}/expired`);
        }

        // Now get the full share data for active, non-expired shares
        const { data: share, error: shareError } = await supabase
            .from('snapshot_shares')
            .select(`
        id,
        title,
        description,
        expires_at,
        is_active,
        access_count,
        snapshot_id,
        snapshots!inner(
          id,
          account_id,
          label,
          last_email_date,
          status
        )
      `)
            .eq('share_token', token)
            .eq('is_active', true)
            .single();

        if (shareError || !share) {
            // This shouldn't happen since we already checked above, but just in case
            redirect(`/shared/${token}/expired`);
        }

        // Update access count
        await supabase
            .from('snapshot_shares')
            .update({
                access_count: (share.access_count || 0) + 1,
                last_accessed_at: new Date().toISOString()
            })
            .eq('id', share.id);

        const snapshot = share.snapshots as any;

        return (
            <div className="min-h-screen bg-gray-50">
                <div className="bg-white border-b border-gray-200">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="py-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900">
                                        {share.title}
                                    </h1>
                                    {share.description && (
                                        <p className="mt-1 text-sm text-gray-500">
                                            {share.description}
                                        </p>
                                    )}
                                </div>
                                <div className="text-sm text-gray-500">
                                    <p>Shared Dashboard</p>
                                    <p>Data from {snapshot.last_email_date}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="bg-white rounded-lg shadow">
                        <div className="px-6 py-4 border-b border-gray-200">
                            <h2 className="text-lg font-medium text-gray-900">
                                Dashboard Data
                            </h2>
                            <p className="mt-1 text-sm text-gray-500">
                                Data through {snapshot.last_email_date}
                            </p>
                        </div>
                        <div className="p-6">
                            <SharedDashboard
                                snapshotId={snapshot.id}
                                shareTitle={share.title}
                                shareDescription={share.description}
                                lastEmailDate={snapshot.last_email_date}
                                shareToken={token}
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    } catch (error) {
        console.error('Error loading shared dashboard:', error);
        notFound();
    }
}

export async function generateMetadata({ params }: PageProps) {
    const { token } = params;

    try {
        const supabase = createServiceClient();

        const { data: share } = await supabase
            .from('snapshot_shares')
            .select('title, description')
            .eq('share_token', token)
            .eq('is_active', true)
            .single();

        if (share) {
            return {
                title: `${share.title} - Email Metrics`,
                description: share.description || 'Shared email marketing dashboard',
            };
        }
    } catch (error) {
        console.error('Error generating metadata:', error);
    }

    return {
        title: 'Shared Dashboard - Email Metrics',
        description: 'Shared email marketing dashboard',
    };
}
