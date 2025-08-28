'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { DataManager } from '../../../lib/data/dataManager';

const DashboardHeavy = dynamic(() => import('../../../components/dashboard/DashboardHeavy'), {
    loading: () => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
            </div>
        </div>
    ),
    ssr: false
});

interface SharedDashboardProps {
    snapshotId: string;
    shareTitle: string;
    shareDescription: string | null;
    lastEmailDate: string;
    shareToken: string;
}

export default function SharedDashboard({ snapshotId, shareTitle, shareDescription, lastEmailDate, shareToken }: SharedDashboardProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [hasData, setHasData] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const loadData = async () => {
            try {
                setIsLoading(true);
                setError(null);

                console.log('Loading shared dashboard data...');

                if (cancelled) return;

                // Create a new DataManager instance for this shared view
                const dm = DataManager.getInstance();

                // Try to load CSV data using the public shared endpoint
                const csvTypes = ['campaigns', 'flows', 'subscribers'];
                const files: Record<string, File> = {};
                let shareTokenError: string | null = null;

                for (const type of csvTypes) {
                    try {
                        console.log(`Fetching ${type} CSV for shared token...`);

                        const response = await fetch(`/api/shared/csv?token=${shareToken}&type=${type}`, {
                            cache: 'no-store'
                        });

                        console.log(`${type} CSV response:`, response.status, response.statusText);

                        if (response.ok) {
                            const text = await response.text();
                            if (text.trim()) {
                                console.log(`${type} CSV loaded successfully, length:`, text.length);
                                const blob = new Blob([text], { type: 'text/csv' });
                                files[type] = new File([blob], `${type}.csv`, { type: 'text/csv' });
                            } else {
                                console.log(`${type} CSV is empty`);
                            }
                        } else {
                            const errorText = await response.text();
                            console.warn(`Failed to load ${type} CSV: ${response.status} ${response.statusText}`, errorText);

                            // Check if this is a share token error (applies to all file types)
                            if (response.status === 404) {
                                try {
                                    const errorData = JSON.parse(errorText);
                                    if (errorData.error?.includes('Invalid or expired share token') ||
                                        errorData.error?.includes('Share link')) {
                                        shareTokenError = errorData.error;
                                        break; // No point checking other file types
                                    }
                                } catch (e) {
                                    // Error parsing response, continue
                                }
                            }
                        }
                    } catch (err) {
                        console.warn(`Failed to load ${type} CSV:`, err);
                    }
                }

                if (cancelled) return;

                // Check if we have a share token error that affects all requests
                if (shareTokenError) {
                    setError(shareTokenError);
                    return;
                }

                if (Object.keys(files).length > 0) {
                    // Load the CSV data into DataManager
                    const result = await dm.loadCSVFiles({
                        campaigns: files.campaigns,
                        flows: files.flows,
                        subscribers: files.subscribers
                    });

                    if (cancelled) return;

                    if (result.success) {
                        setHasData(true);
                    } else {
                        console.error('Failed to process CSV data:', result.errors);
                        setError('Failed to process dashboard data');
                    }
                } else {
                    console.log('No CSV files loaded successfully');
                    setError('No data files are available for this shared dashboard. The dashboard share exists, but the CSV data files may not have been uploaded to storage properly.');
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('Error loading shared dashboard:', err);
                    setError('Failed to load dashboard data');
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        loadData();

        return () => {
            cancelled = true;
        };
    }, [shareToken]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Loading shared dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                    <h2 className="text-xl font-semibold text-red-600 dark:text-red-400 mb-4">Unable to Load Dashboard</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-500">
                        Please contact the person who shared this dashboard for assistance.
                    </p>
                </div>
            </div>
        );
    }

    if (!hasData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                    <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-4">No Data Available</h2>
                    <p className="text-gray-600 dark:text-gray-400">
                        This shared dashboard doesn't contain any data to display.
                    </p>
                </div>
            </div>
        );
    }

    // Render the full DashboardHeavy component with shared data
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Header with share info */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                                {shareTitle}
                            </h1>
                            {shareDescription && (
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {shareDescription}
                                </p>
                            )}
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                Shared Dashboard • Data from {lastEmailDate}
                            </p>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                            Data through {lastEmailDate}
                        </div>
                    </div>
                </div>
            </div>

            {/* Dashboard Content */}
            <DashboardHeavy />
        </div>
    );
}
