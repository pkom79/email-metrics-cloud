import './globals.css';
import type { Metadata } from 'next';
import ThemeToggle from '../components/ThemeToggle';
import Link from 'next/link';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
    title: 'Email Metrics Cloud',
    description: 'Upload CSVs. Get snapshots.',
    icons: {
        icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
        apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    const cookieStore = cookies();
    const hasSession = !!cookieStore.get('sb:token') || !!cookieStore.get('sb-access-token') || !!cookieStore.get('sb:access-token');
    return (
        <html lang="en">
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `!function(){try{var t=localStorage.getItem("theme");if(!t){var e=window.matchMedia("(prefers-color-scheme: dark)");t=e.matches?"dark":"light"}("dark"===t)&&document.documentElement.classList.add("dark")}catch(n){}}();`
                    }}
                />
                <link rel="icon" href="/icon.svg" type="image/svg+xml" />
                <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
            </head>
            <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-lg font-semibold hover:opacity-90 transition-opacity">
                        <img src="/brand/logo-email.png" alt="Email Metrics" className="h-6 w-auto" />
                        <span className="hidden sm:inline">Email Metrics</span>
                    </Link>
                    <div className="flex items-center gap-3">
                        <Link href={hasSession ? '/dashboard' : '/signup?mode=signin'} className="text-sm text-purple-600 dark:text-purple-400">
                            {hasSession ? 'Dashboard' : 'Sign in'}
                        </Link>
                        <ThemeToggle />
                    </div>
                </div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
            </body>
        </html>
    );
}
