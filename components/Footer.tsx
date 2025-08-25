import Link from 'next/link';

export default function Footer() {
    const year = new Date().getFullYear();
    return (
        <footer className="mt-16 border-t border-gray-200 dark:border-gray-800 py-8 text-sm text-gray-600 dark:text-gray-400">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-medium text-gray-700 dark:text-gray-300">© {year} Email Metrics</span>
                    <Link href="/terms" className="hover:text-gray-900 dark:hover:text-gray-200 underline-offset-4 hover:underline transition-colors">Terms & Conditions</Link>
                    <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-gray-200 underline-offset-4 hover:underline transition-colors">Privacy Policy</Link>
                </div>
                <div className="text-xs opacity-75">
                    <span>All product names, logos, and brands are property of their respective owners.</span>
                </div>
            </div>
        </footer>
    );
}
