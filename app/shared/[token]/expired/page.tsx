import Link from 'next/link';
import { Calendar, Clock, Share2 } from 'lucide-react';

export default function ExpiredSharePage() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto p-6">
                <div className="mb-6">
                    <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                </div>

                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                    Share Link Unavailable
                </h1>

                <p className="text-gray-600 dark:text-gray-400 mb-6">
                    This dashboard share link is no longer available. It may have expired, been deleted, or deactivated by the owner.
                    Please contact the dashboard owner for a new share link.
                </p>

                <div className="space-y-4">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors"
                    >
                        <Share2 className="w-4 h-4" />
                        Create Your Own Dashboard
                    </Link>
                </div>

                <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-sm">
                        <Calendar className="w-4 h-4" />
                        <span className="font-medium">Dashboard Owner?</span>
                    </div>
                    <p className="text-blue-600 dark:text-blue-400 text-sm mt-1">
                        Sign in to your account to create a new share link with a fresh expiration date.
                    </p>
                </div>
            </div>
        </div>
    );
}
