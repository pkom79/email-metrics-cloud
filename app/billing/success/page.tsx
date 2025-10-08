import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

export const metadata = {
    title: 'Subscription Activated | Email Metrics'
};

export default function BillingSuccessPage() {
    return (
        <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-3xl shadow-sm px-8 py-12 text-center">
            <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="h-10 w-10" />
                </div>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-3">Trial started!</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                Thanks for subscribing to Email Metrics. Your 30 day free trial is active–feel free to explore every dashboard insight. We’ll remind you before billing begins.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/dashboard" className="inline-flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 text-sm font-medium">
                    Go to dashboard
                </Link>
                <Link href="/" className="inline-flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 px-6 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-indigo-300">
                    Back to home
                </Link>
            </div>
        </div>
    );
}
