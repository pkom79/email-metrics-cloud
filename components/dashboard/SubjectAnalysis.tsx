"use client";
import React, { useMemo, useState } from 'react';
import { Type, Ruler, Sparkles, CaseSensitive, AlarmClock, User, BadgeDollarSign, Play, RefreshCcw, HelpCircle } from 'lucide-react';
import SelectBase from "../ui/SelectBase";
import InfoTooltipIcon from "../InfoTooltipIcon";
import TooltipPortal from "../TooltipPortal";
import type { ProcessedCampaign } from "../../lib/data/dataTypes";
import { computeSubjectAnalysis, uniqueSegmentsFromCampaigns, type SubjectMetricKey } from "../../lib/analytics/subjectAnalysis";

interface Props {
    campaigns: ProcessedCampaign[];
}

const metricOptions: { value: SubjectMetricKey; label: string }[] = [
    { value: 'openRate', label: 'Open Rate' },
    { value: 'clickToOpenRate', label: 'Click-to-Open Rate' },
    { value: 'clickRate', label: 'Click Rate' },
    { value: 'revenuePerEmail', label: 'Revenue per Email' },
];

export default function SubjectAnalysis({ campaigns }: Props) {
    const [metric, setMetric] = useState<SubjectMetricKey>('openRate');
    const segments = useMemo(() => uniqueSegmentsFromCampaigns(campaigns), [campaigns]);
    const [segment, setSegment] = useState<string>('ALL_SEGMENTS');
    // Always show only reliable categories per spec (no toggle)

    const result = useMemo(() => computeSubjectAnalysis(campaigns, metric, segment), [campaigns, metric, segment]);

    const formatPercent = (v: number) => `${(v ?? 0).toFixed(1)}%`;
    const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
    const fmt = (v: number) => metric === 'revenuePerEmail' ? formatCurrency(v) : formatPercent(v);

    // Lifts are always shown as relative % change vs baseline, even for RPE
    const liftFmt = (v: number) => `${v >= 0 ? '+' : ''}${(v ?? 0).toFixed(1)}%`;

    return (
        <section className="mt-6">
            <div className="section-card">
                <div className="section-header mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Type className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Subject Line Analysis
                            <InfoTooltipIcon placement="top" content={(<div>
                                <p className="font-semibold mb-1">What</p>
                                <p>How subject line features correlate with performance for Campaigns.</p>
                                <p className="font-semibold mt-2 mb-1">Notes</p>
                                <ul className="list-disc pl-4 space-y-1">
                                    <li>Open Rate can be inflated by Apple MPP; prefer CTR/CTO/RPE for decisions.</li>
                                    <li>Comparisons are weighted by emails sent.</li>
                                    <li>Lifts show relative % change vs Baseline, including for RPE.</li>
                                    <li>Exact-match reuse only. Data is capped at 2 years.</li>
                                </ul>
                            </div>)} />
                        </h3>
                    </div>
                    <div className="section-controls flex items-center gap-2">
                        <div className="relative">
                            <SelectBase value={segment} onChange={e => setSegment((e.target as HTMLSelectElement).value)} className="select-base h-9">
                                <option value="ALL_SEGMENTS">All Segments</option>
                                {segments.map(s => (<option key={s} value={s}>{s}</option>))}
                            </SelectBase>
                        </div>
                        <div className="relative">
                            <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value as SubjectMetricKey)} className="select-base h-9">
                                {metricOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </SelectBase>
                        </div>
                    </div>
                </div>

                {/* Length bins */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3 justify-center"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Performance by Subject Length</h4></div>
                    {/* 4 in a line on md+ screens, centered container */}
                    <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Baseline card */}
                        <TooltipPortal content={(<div className="text-xs">Reference average for comparison.</div>)}>
                            <div className="w-full rounded-2xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900">
                                <div className="text-base text-gray-600 dark:text-gray-400">Baseline</div>
                                <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmt(result.baseline.value)}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400">{result.baseline.countCampaigns} campaigns • {result.baseline.totalEmails.toLocaleString()} emails</div>
                                <div className="text-sm text-gray-500 dark:text-gray-500">&nbsp;</div>
                            </div>
                        </TooltipPortal>
                        {result.lengthBins
                            .filter(b => b.countCampaigns > 0)
                            .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                            .slice(0, 3)
                            .map(b => (
                                <TooltipPortal key={b.key} content={(
                                    <div>
                                        <div className="text-xs font-medium mb-1">Examples</div>
                                        <ul className="list-disc pl-4 text-xs space-y-1">
                                            {(b.examples || []).map((ex, i) => (<li key={i} className="truncate max-w-xs" title={ex}>{ex}</li>))}
                                        </ul>
                                    </div>
                                )}>
                                    <div className="w-full rounded-2xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900">
                                        <div className="text-base text-gray-600 dark:text-gray-400">{b.label} chars</div>
                                        <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmt(b.value)}</div>
                                        <div className="text-sm text-gray-600 dark:text-gray-400">{b.countCampaigns} campaigns • {b.totalEmails.toLocaleString()} emails</div>
                                        <div className={`text-sm ${b.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(b.liftVsBaseline)}</div>
                                    </div>
                                </TooltipPortal>
                            ))}
                    </div>
                </div>

                {/* Categories */}
                <div className="mb-6">
                    {(() => {
                        const reliableCats = result.categories
                            .filter(f => f.countCampaigns > 0)
                            .filter(f => f.reliable);
                        if (reliableCats.length === 0) {
                            return (
                                <div className="max-w-3xl mx-auto">
                                    <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-10 bg-white dark:bg-gray-900 flex flex-col items-center justify-center text-center">
                                        <HelpCircle className="w-10 h-10 text-gray-300 mb-3" />
                                        <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Not enough reliable data yet</h4>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            We didn’t find any subject line categories with sufficient volume and statistical significance
                                            for this selection. Try expanding the date range or including more segments.
                                        </p>
                                    </div>
                                </div>
                            );
                        }
                        return (
                            <>
                                <div className="flex items-center gap-2 mb-3 justify-center"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Category Lifts</h4></div>
                                <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {reliableCats
                                        .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                                        .map(f => (
                                            <TooltipPortal key={f.key} content={(
                                                <div>
                                                    {Array.isArray(f.usedTerms) && f.usedTerms.length > 0 && (
                                                        <div className="mb-2">
                                                            <div className="text-xs font-medium mb-1">Used this period</div>
                                                            <ul className="list-disc pl-4 text-xs space-y-1 max-w-xs">
                                                                {f.usedTerms.slice(0, 10).map((t, i) => (
                                                                    <li key={i} className="truncate" title={`${t.term} — ${t.count} campaigns`}>
                                                                        <span className="font-medium">{t.term}</span> <span className="text-gray-500">— {t.count}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    <div className="text-xs font-medium mb-1">Examples</div>
                                                    <ul className="list-disc pl-4 text-xs space-y-1">
                                                        {(f.examples || []).map((ex, i) => (<li key={i} className="truncate max-w-xs" title={ex}>{ex}</li>))}
                                                    </ul>
                                                </div>
                                            )}>
                                                <div className="w-full rounded-2xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900 flex items-center justify-between">
                                                    <div>
                                                        <div className="text-base text-gray-900 dark:text-gray-100">{f.label}</div>
                                                        <div className="text-sm text-gray-600 dark:text-gray-400">{f.countCampaigns} campaigns • {f.totalEmails.toLocaleString()} emails</div>
                                                    </div>
                                                    <div className={`${f.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'} text-base font-medium`}>{liftFmt(f.liftVsBaseline)}</div>
                                                </div>
                                            </TooltipPortal>
                                        ))}
                                </div>
                            </>
                        );
                    })()}
                </div>
                {/* Reuse section removed per spec */}
            </div>
        </section>
    );
}
