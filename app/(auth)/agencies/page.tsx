import AuthGate from '../../../components/AuthGate';
import AgenciesClient from '../../../components/agencies/AgenciesClient';
import { getServerUser } from '../../../lib/supabase/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Agencies' };

export default async function AgenciesPage() {
  const user = await getServerUser();
  if (!user) redirect('/signup?mode=signin');
  const isAgency = ((user.user_metadata as any)?.signup_type) === 'agency';
  if (!isAgency) redirect('/account');
  return (
    <AuthGate>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Agencies</h1>
        <AgenciesClient />
      </div>
    </AuthGate>
  );
}
