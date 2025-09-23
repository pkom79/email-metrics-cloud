import { getServerUser } from '../../../../lib/supabase/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Brands' };

export default async function BrandsPage() {
  const user = await getServerUser();
  if (!user) {
    redirect('/signup?mode=signup');
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Brands</h1>
        <a href="/account" className="text-sm text-purple-600 hover:underline">← Back to Account</a>
      </div>
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-600 dark:text-gray-400">
        The dashboard now supports a single brand per user. If you need to migrate historical data between accounts, contact support and a Global Admin will assist you.
      </div>
    </div>
  );
}
