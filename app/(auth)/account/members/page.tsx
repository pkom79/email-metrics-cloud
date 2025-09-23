import { getServerUser } from '../../../../lib/supabase/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Users' };

export default async function MembersPage() {
  const user = await getServerUser();
  if (!user) {
    redirect('/signup?mode=signup');
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Users</h1>
        <a href="/account" className="text-sm text-purple-600 hover:underline">← Back to Account</a>
      </div>
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-600 dark:text-gray-400">
        Multi-user access has been retired. Each company now uses a single owner account. Global Admins can still assist through the admin console.
      </div>
    </div>
  );
}
