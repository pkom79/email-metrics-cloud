"use client";
import React from "react";
import { MailSearch, ChevronDown } from "lucide-react";
import type { ProcessedCampaign } from "../../lib/data/dataTypes";
import { buildCampaignSubjectLineInsights } from "../../lib/analytics/campaignSubjectLineInsights";

interface Props {
    campaigns: ProcessedCampaign[];
    rangeLabel: string;
    className?: string;
}

export default function CampaignSubjectLineNote({ campaigns, rangeLabel, className }: Props) {
    const insight = React.useMemo(() => buildCampaignSubjectLineInsights(campaigns, rangeLabel, { maxTopCount: 3 }), [campaigns, rangeLabel]);
    const [expanded, setExpanded] = React.useState(false);

    React.useEffect(() => { setExpanded(false); }, [rangeLabel, campaigns]);

    if (!insight) return null;

    const { note } = insight;

    return (
        <div className={className}>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                        <MailSearch className="w-5 h-5 text-purple-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{note.headline}</p>
                            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{note.summary}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setExpanded(prev => !prev)}
                        className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                        aria-expanded={expanded}
                        aria-controls="campaign-subject-note-details"
                    >
                        {expanded ? "Hide Insights" : "View Insights"}
                        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                </div>
                {expanded && (
                    <div id="campaign-subject-note-details" className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                        <p>{note.paragraph}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

