import AuthGate from '../../../../components/AuthGate';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import AdminOutboxLogs from '../../../../components/admin/AdminOutboxLogs';

export const metadata = { title: 'Outbox Diagnostics' };

export default async function AdminNotificationsPage() {
  const c = cookies();
  const client = createRouteHandlerClient({ cookies: () => c });
  const { data: { user } } = await client.auth.getUser();
  const isAdmin = !!user && (user.app_metadata?.role === 'admin' || user.app_metadata?.app_role === 'admin');
  return (
    <AuthGate>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Outbox Diagnostics</h1>
          {!isAdmin && <span className="text-xs text-rose-600">Admin only</span>}
        </div>
        {isAdmin ? <AdminOutboxLogs /> : <div className="rounded border border-gray-200 dark:border-gray-800 p-4 text-sm text-gray-600 dark:text-gray-300">You don’t have permission to view this page.</div>}
      </div>
    </AuthGate>
  );
}

