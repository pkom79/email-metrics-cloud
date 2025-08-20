import AuthGate from '../../../components/AuthGate';
import AccountClient from '../../../components/AccountClient';
import { getServerUser } from '../../../lib/supabase/auth';

export default async function AccountPage() {
    const user = await getServerUser();
    const email = user?.email || '';
    const businessName = (user?.user_metadata as any)?.businessName as string | undefined;
    const storeUrl = (user?.user_metadata as any)?.storeUrl as string | undefined;
    return (
        <AuthGate>
            <AccountClient initial={{ email, businessName: businessName || '', storeUrl: storeUrl || '' }} />
        </AuthGate>
    );
}
