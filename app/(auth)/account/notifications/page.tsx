import AuthGate from '../../../../components/AuthGate';
import NotificationsSettings from '../../../../components/account/NotificationsSettings';

export const metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <AuthGate>
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Notifications</h1>
        <NotificationsSettings />
      </div>
    </AuthGate>
  );
}

