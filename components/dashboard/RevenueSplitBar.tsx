"use client";
import React, { useMemo } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';

interface RevenueSplitBarProps {
    campaigns: ProcessedCampaign[];
    flows: ProcessedFlowEmail[];
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

/**
 * Simple horizontal split bar showing the share of total email revenue coming from Campaigns vs Flows
 * - Placed directly beneath the "Email Performance Overview" heading
 * - Uses current filtered dataset passed from parent (already date-range constrained)
 */
export default function RevenueSplitBar({ campaigns, flows }: RevenueSplitBarProps) {
    const { campaignRevenue, flowRevenue, totalRevenue, campaignPct, flowPct } = useMemo(() => {
        const campaignRevenue = campaigns.reduce((s, c) => s + (c.revenue || 0), 0);
        const flowRevenue = flows.reduce((s, f) => s + (f.revenue || 0), 0);
        const totalRevenue = campaignRevenue + flowRevenue;
        const campaignPct = totalRevenue > 0 ? (campaignRevenue / totalRevenue) * 100 : 0;
        const flowPct = totalRevenue > 0 ? (flowRevenue / totalRevenue) * 100 : 0;
        return { campaignRevenue, flowRevenue, totalRevenue, campaignPct, flowPct };
    }, [campaigns, flows]);

    if (!campaigns.length && !flows.length) return null;

    return (
        <div className="mb-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Campaign vs Flow Revenue Split</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{totalRevenue > 0 ? formatCurrency(totalRevenue) + ' total' : 'No revenue in range'}</p>
                </div>
                {totalRevenue > 0 ? (
                    <div className="space-y-2">
                        <div className="h-5 w-full rounded-md overflow-hidden flex text-[11px] font-medium tracking-tight select-none">
                            {/* Campaign segment */}
                            <div
                                className="flex items-center justify-end pr-1 text-white bg-gradient-to-r from-indigo-600 to-indigo-500 transition-all"
                                style={{ width: `${campaignPct}%` }}
                                aria-label={`Campaign revenue ${campaignPct.toFixed(1)}%`}
                            >
                                {campaignPct > 6 && <span>{campaignPct.toFixed(1)}%</span>}
                            </div>
                            {/* Flow segment */}
                            <div
                                className="flex items-center justify-start pl-1 text-white bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                                style={{ width: `${flowPct}%` }}
                                aria-label={`Flow revenue ${flowPct.toFixed(1)}%`}
                            >
                                {flowPct > 6 && <span>{flowPct.toFixed(1)}%</span>}
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <span className="inline-block w-3 h-3 rounded-sm bg-indigo-600" />
                                <span className="text-gray-600 dark:text-gray-400">Campaigns: <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(campaignRevenue)}</span> ({campaignPct.toFixed(1)}%)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
                                <span className="text-gray-600 dark:text-gray-400">Flows: <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(flowRevenue)}</span> ({flowPct.toFixed(1)}%)</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-xs text-gray-500 dark:text-gray-400">No revenue recorded in the selected range yet.</div>
                )}
            </div>
        </div>
    );
}
