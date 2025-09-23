import AuthGate from '../../../components/AuthGate';
import AccountClient from '../../../components/AccountClient';
import { getServerUser } from '../../../lib/supabase/auth';
import { redirect } from 'next/navigation';
import { createServiceClient } from '../../../lib/supabase/server';

export default async function AccountPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
    const user = await getServerUser();
    const email = user?.email || '';
    const businessName = (user?.user_metadata as any)?.businessName as string | undefined;
    const storeUrl = (user?.user_metadata as any)?.storeUrl as string | undefined;

    const spAccount = (typeof searchParams?.account === 'string' ? searchParams?.account : Array.isArray(searchParams?.account) ? searchParams?.account[0] : '') || '';
    if (!spAccount && user) {
        try {
            const svc = createServiceClient();
            const { data } = await svc.from('accounts').select('id').eq('owner_user_id', user.id);
            if (Array.isArray(data) && data.length === 1 && data[0]?.id) {
                redirect(`/account?account=${encodeURIComponent(String(data[0].id))}`);
            }
        } catch { /* ignore */ }
    }

    return (
        <AuthGate>
            <AccountClient initial={{ email, businessName: businessName || '', storeUrl: storeUrl || '' }} />
        </AuthGate>
    );
}
