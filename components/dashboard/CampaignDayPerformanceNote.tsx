"use client";
import React from 'react';
import { CalendarDays } from 'lucide-react';
import { computeCampaignDayPerformance, CampaignDayPerformanceRecommendation } from '../../lib/analytics/campaignDayPerformance';
import type { ProcessedCampaign } from '../../lib/data/dataTypes';

interface Props {
    campaigns: ProcessedCampaign[];
    rangeStart: Date;
    rangeEnd: Date;
    frequencyRecommendation?: number; // from existing send frequency module
    dateRangeLabel?: string;
    className?: string;
}

function RecommendationCard({ rec }: { rec: CampaignDayPerformanceRecommendation }) {
    return (
        <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{rec.headline}</p>
            {rec.body.map((line, idx) => (
                <p key={idx} className={`mt-${idx === 0 ? 1 : 2} text-sm text-gray-700 dark:text-gray-300 leading-relaxed`}>{line}</p>
            ))}
            {rec.sampleLine && (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{rec.sampleLine}</p>
            )}
        </div>
    );
}

export default function CampaignDayPerformanceNote(props: Props) {
    const { campaigns, rangeStart, rangeEnd, frequencyRecommendation, dateRangeLabel, className } = props;
    const { recommendation } = React.useMemo(() => computeCampaignDayPerformance({ campaigns, rangeStart, rangeEnd, frequencyRecommendation, dateRangeLabel }), [campaigns, rangeStart, rangeEnd, frequencyRecommendation, dateRangeLabel]);

    // Hide entirely only if no data scenario so we don't render empty shells with other modules.
    if (!recommendation) return null;

    return (
        <div className={className}>
            <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Campaign Performance by Day</h3>
            </div>
            <RecommendationCard rec={recommendation} />
        </div>
    );
}
