import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Email Metrics Cloud',
    description: 'Upload CSVs. Get snapshots.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-white">
                <div className="max-w-5xl mx-auto p-6">{children}</div>
            </body>
        </html>
    );
}
