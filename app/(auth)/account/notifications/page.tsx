import AuthGate from '../../../../components/AuthGate';
import NotificationsSettings from '../../../../components/account/NotificationsSettings';

export const metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <AuthGate>
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h1>
          <a href="/account" className="text-sm text-purple-600 hover:underline">← Back to Account</a>
        </div>
        <NotificationsSettings />
      </div>
    </AuthGate>
  );
}
