import DashboardClient from '../../../components/dashboard/DashboardClient';
import AuthGate from '../../../components/AuthGate';
import { getServerUser } from '../../../lib/supabase/auth';
import { redirect } from 'next/navigation';
import { ErrorBoundary } from '../../../components/ErrorBoundary';

export default async function Dashboard() {
    const user = await getServerUser();
    if (!user) {
        redirect('/signup?mode=signup');
    }
    const businessName = (user?.user_metadata as any)?.businessName as string | undefined;
    return (
        <AuthGate>
            <ErrorBoundary>
                <DashboardClient businessName={businessName} userId={user.id} />
            </ErrorBoundary>
        </AuthGate>
    );
}
