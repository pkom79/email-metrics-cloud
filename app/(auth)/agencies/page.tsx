import AuthGate from '../../../components/AuthGate';
import AgenciesClient from '../../../components/agencies/AgenciesClient';

export const metadata = { title: 'Agencies' };

export default function AgenciesPage() {
  return (
    <AuthGate>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Agencies</h1>
        <AgenciesClient />
      </div>
    </AuthGate>
  );
}

