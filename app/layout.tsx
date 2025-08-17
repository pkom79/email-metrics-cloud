import './globals.css';
import type { Metadata } from 'next';
import ThemeToggle from '../components/ThemeToggle';
import { BarChart3 } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Email Metrics Cloud',
    description: 'Upload CSVs. Get snapshots.',
    icons: {
        icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
        apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                            <BarChart3 className="w-4 h-4 text-white" />
                        </div>
                        <span>Email Metrics</span>
                    </div>
                    <ThemeToggle />
                </div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
            </body>
        </html>
    );
}
