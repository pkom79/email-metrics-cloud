import AuthGate from '../../../../components/AuthGate';
import InvitationsManager from '../../../../components/account/InvitationsManager';

export const metadata = { title: 'Members' };

export default function MembersPage() {
  return (
    <AuthGate>
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Members</h1>
        <InvitationsManager />
      </div>
    </AuthGate>
  );
}

