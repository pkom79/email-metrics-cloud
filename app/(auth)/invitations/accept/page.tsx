export default function AcceptInvitationPage() {
  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Invitations Retired</h1>
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-600 dark:text-gray-300 space-y-3">
        <p>
          Email invitations are no longer in use. Each company has a single owner account and Global Admins can assist directly when access is needed.
        </p>
        <p>
          If you were expecting an invitation, ask the account owner to share their login or contact support so a Global Admin can help.
        </p>
        <a href="/" className="inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">Return home</a>
      </div>
    </div>
  );
}
