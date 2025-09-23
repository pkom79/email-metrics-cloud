import DashboardClient from '../../../components/dashboard/DashboardClient';
import { getServerUser } from '../../../lib/supabase/auth';
import { redirect } from 'next/navigation';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { createServiceClient } from '../../../lib/supabase/server';

export default async function Dashboard({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
    const user = await getServerUser();
    if (!user) {
        redirect('/signup?mode=signup');
    }
    const spAccount = (typeof searchParams?.account === 'string' ? searchParams?.account : Array.isArray(searchParams?.account) ? searchParams?.account[0] : '') || '';
    if (!spAccount) {
        // If owner of exactly one account, pin context by redirecting with ?account=
        try {
            const svc = createServiceClient();
            const { data: own } = await svc.from('accounts').select('id').eq('owner_user_id', user.id);
            if (Array.isArray(own) && own.length === 1 && own[0]?.id) {
                redirect(`/dashboard?account=${encodeURIComponent(String(own[0].id))}`);
            }
        } catch { /* ignore */ }
    }
    const businessName = (user?.user_metadata as any)?.businessName as string | undefined;
    return (
        <ErrorBoundary>
            <DashboardClient businessName={businessName} userId={user.id} />
        </ErrorBoundary>
    );
}
