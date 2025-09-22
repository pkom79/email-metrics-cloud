import AuthGate from '../../../components/AuthGate';
import AgenciesClient from '../../../components/agencies/AgenciesClient';
import { getServerUser } from '../../../lib/supabase/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Agencies (retired)' };

export default async function AgenciesPage() {
  const user = await getServerUser();
  if (!user) redirect('/signup?mode=signin');
  // Agencies feature retired — redirect to account
  if (user) redirect('/account');
  return (
    <AuthGate>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Agencies (retired)</h1>
        <div className="rounded border border-gray-200 dark:border-gray-800 p-4 text-sm text-gray-600 dark:text-gray-300">This section has been retired.</div>
      </div>
    </AuthGate>
  );
}
