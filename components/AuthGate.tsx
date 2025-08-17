import { redirect } from 'next/navigation';
import { getServerUser } from '../lib/supabase/auth';

export default async function AuthGate({ children }: { children: React.ReactNode }) {
    const user = await getServerUser();
    if (!user) redirect('/signup?mode=signin');
    return <>{children}</>;
}
