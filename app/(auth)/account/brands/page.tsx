import AuthGate from '../../../../components/AuthGate';
import BrandsManager from '../../../../components/account/BrandsManager';

export const metadata = { title: 'Brands' };

export default function BrandsPage() {
  return (
    <AuthGate>
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Brands</h1>
          <a href="/account" className="text-sm text-purple-600 hover:underline">← Back to Account</a>
        </div>
        <BrandsManager />
      </div>
    </AuthGate>
  );
}
