import DashboardClient from '../../../components/dashboard/DashboardClient';
import AuthGate from '../../../components/AuthGate';
import { getServerUser } from '../../../lib/supabase/auth';

export default async function Dashboard() {
    const user = await getServerUser();
    const businessName = (user?.user_metadata as any)?.businessName as string | undefined;
    return (
        <AuthGate>
            <DashboardClient businessName={businessName} />
        </AuthGate>
    );
}
