"use client";
import React from 'react';
import { DataManager } from '../../lib/data/dataManager';
import { Info } from 'lucide-react';

interface DataCoverageNoticeProps {
    dataManager: DataManager;
}

export default function DataCoverageNotice({ dataManager }: DataCoverageNoticeProps) {
    try {
        const last = dataManager.getLastEmailDate();
        if (!last) return null;
        const lastStr = last.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const capDays = 730; // 2 years
        const capStart = new Date(last);
        capStart.setDate(capStart.getDate() - (capDays - 1));
        const capStartStr = capStart.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        return (
            <div className="py-2">
                <div className="max-w-7xl mx-auto">
                    <div className="mx-4 sm:mx-6">
                        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-2.5">
                            <div className="flex items-start gap-2.5">
                                <Info className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 text-xs text-purple-900 dark:text-purple-100">
                                    <span className="font-medium">Data Coverage:</span> Dashboard covers up to the last available day, {lastStr}. Historical data is capped at 2 years back from that date (from {capStartStr}).
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    } catch {
        return null;
    }
}
