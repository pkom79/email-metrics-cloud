"use client";
import React from 'react';
import { DataManager } from '../../lib/data/dataManager';
// removed Info icon per request

interface DataCoverageNoticeProps {
    dataManager: DataManager;
}

export default function DataCoverageNotice({ dataManager }: DataCoverageNoticeProps) {
    try {
        // Re-render when dataset hydrates/persists
        const [, setTick] = React.useState(0);
        React.useEffect(() => {
            const onHydrated = () => setTick(t => t + 1);
            if (typeof window !== 'undefined') {
                window.addEventListener('em:dataset-hydrated', onHydrated as any);
                window.addEventListener('em:dataset-persisted', onHydrated as any);
            }
            return () => {
                if (typeof window !== 'undefined') {
                    window.removeEventListener('em:dataset-hydrated', onHydrated as any);
                    window.removeEventListener('em:dataset-persisted', onHydrated as any);
                }
            };
        }, []);

        const last = dataManager.getLastEmailDate();
        if (!last) return null;
        const lastStr = last.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const capDays = 730; // 2 years
        const capStart = new Date(last);
        capStart.setDate(capStart.getDate() - (capDays - 1));
        // capStart computed but not shown per request

        return (
            <div className="py-2">
                <div className="max-w-7xl mx-auto">
                    <div className="mx-4 sm:mx-6">
                        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-2.5">
                            <div className="text-xs text-purple-900 dark:text-purple-100">
                                <span className="font-medium">Data Coverage:</span> The dashboard shows data through the most recent day available ({lastStr}). Historical data is limited to two years prior to that date.
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
