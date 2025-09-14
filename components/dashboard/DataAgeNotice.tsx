"use client";
import React from 'react';
import { DataManager } from '../../lib/data/dataManager';
import { AlertTriangle, Upload } from 'lucide-react';

interface DataAgeNoticeProps {
    dataManager: DataManager;
    onUploadClick: () => void;
}

export default function DataAgeNotice({ dataManager, onUploadClick }: DataAgeNoticeProps) {
    const lastEmailDate = dataManager.getLastEmailDate();
    const today = new Date();
    const daysDiff = Math.floor((today.getTime() - lastEmailDate.getTime()) / (1000 * 60 * 60 * 24));

    // Only show notice if data is 7+ days old
    if (daysDiff < 7) {
        return null;
    }

    return (
        <div className="py-3">
            <div className="max-w-7xl mx-auto">
                <div className="mx-4 sm:mx-6">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                    Data Update Recommended
                                </h3>
                                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                                    Your dashboard shows data from {lastEmailDate.toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })} ({daysDiff} days ago). Upload fresh reports to see your latest email performance.
                                </p>
                            </div>
                            <button
                                onClick={onUploadClick}
                                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <Upload className="h-4 w-4" />
                                Upload Reports
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
