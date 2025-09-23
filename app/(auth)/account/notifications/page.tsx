import NotificationsSettings from '../../../../components/account/NotificationsSettings';
import { getServerUser } from '../../../../lib/supabase/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await getServerUser();
  if (!user) {
    redirect('/signup?mode=signup');
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h1>
        <a href="/account" className="text-sm text-purple-600 hover:underline">← Back to Account</a>
      </div>
      <NotificationsSettings />
    </div>
  );
}
