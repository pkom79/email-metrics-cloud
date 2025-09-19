import AuthGate from '../../../../components/AuthGate';
import BrandsManager from '../../../../components/account/BrandsManager';

export const metadata = { title: 'Brands' };

export default function BrandsPage() {
  return (
    <AuthGate>
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Brands</h1>
        <BrandsManager />
      </div>
    </AuthGate>
  );
}

