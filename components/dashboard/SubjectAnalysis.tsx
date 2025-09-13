"use client";
import React, { useMemo, useState } from 'react';
import { Type, Ruler, Sparkles, CaseSensitive, AlarmClock, User, BadgeDollarSign, Play, RefreshCcw } from 'lucide-react';
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
    const [reliableOnly, setReliableOnly] = useState<boolean>(true);

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
                        <button
                            className={`px-2.5 py-1 text-xs font-medium rounded border ${reliableOnly ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}
                            onClick={() => setReliableOnly(v => !v)}
                        >
                            Only show reliable
                        </button>
                        <InfoTooltipIcon content={(<div>
                            <div className="font-semibold mb-1">Reliable</div>
                            <div>Meets volume (≥5 campaigns and ≥2% of total emails) and passes significance at 95% (FDR‑adjusted for rates; bootstrap CI for RPE).</div>
                            <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">Open Rate may be inflated by Apple MPP. Prefer CTR/CTO/RPE for decisions.</div>
                        </div>)} />
                    </div>
                </div>

                {/* Length bins */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3 justify-center"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Performance by Subject Length</h4></div>
                    <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Baseline card at top-left */}
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
                    <div className="flex items-center gap-2 mb-3 justify-center"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Category Lifts</h4></div>
                    <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                        {result.categories
                            .filter(f => f.countCampaigns > 0)
                            .filter(f => !reliableOnly || f.reliable)
                            .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                            .map(f => (
                                <TooltipPortal key={f.key} content={(
                                    <div>
                                        <div className="text-xs font-medium mb-1">Examples</div>
                                        <ul className="list-disc pl-4 text-xs space-y-1">
                                            {(f.examples || []).map((ex, i) => (<li key={i} className="truncate max-w-xs" title={ex}>{ex}</li>))}
                                        </ul>
                                        {f.reliable ? (<div className="mt-2 text-[11px] text-emerald-600">Reliable at 95%</div>) : (<div className="mt-2 text-[11px] text-gray-500">Insufficient evidence</div>)}
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
                </div>

                {/* Punctuation & Casing */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3 justify-center"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Punctuation & Casing Effects</h4></div>
                    <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                        {result.punctuationCasing
                            .filter(f => f.countCampaigns > 0 && !(f.key?.startsWith('none:')))
                            .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                            .slice(0, 6)
                            .map(f => (
                                <TooltipPortal key={f.key} content={(
                                    <div>
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
                                        <div className={`text-base font-medium ${f.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(f.liftVsBaseline)}</div>
                                    </div>
                                </TooltipPortal>
                            ))}
                    </div>
                </div>

                {/* Deadline/Urgency */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3 justify-center"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Deadline & Urgency Words</h4></div>
                    <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                        {result.deadlines
                            .filter(f => f.countCampaigns > 0 && !(f.key?.startsWith('none:')))
                            .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                            .slice(0, 8)
                            .map(f => (
                                <TooltipPortal key={f.key} content={(
                                    <div>
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
                                        <div className={`text-base font-medium ${f.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(f.liftVsBaseline)}</div>
                                    </div>
                                </TooltipPortal>
                            ))}
                    </div>
                </div>

                {/* Personalization & Price Anchoring */}
                <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <div className="flex items-center gap-2 mb-3 justify-center md:justify-start"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Personalization Markers</h4></div>
                        <div className="space-y-4">
                            {result.personalization
                                .filter(f => f.countCampaigns > 0 && !(f.key?.startsWith('none:')))
                                .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                                .map(f => (
                                    <TooltipPortal key={f.key} content={(
                                        <div>
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
                                            <div className={`text-base font-medium ${f.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(f.liftVsBaseline)}</div>
                                        </div>
                                    </TooltipPortal>
                                ))}
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-3 justify-center md:justify-start"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Price Anchoring</h4></div>
                        <div className="space-y-4">
                            {result.priceAnchoring
                                .filter(f => f.countCampaigns > 0 && !(f.key?.startsWith('none:')))
                                .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline))
                                .map(f => (
                                    <TooltipPortal key={f.key} content={(
                                        <div>
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
                                            <div className={`text-base font-medium ${f.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(f.liftVsBaseline)}</div>
                                        </div>
                                    </TooltipPortal>
                                ))}
                        </div>
                    </div>
                </div>

                {/* Imperative start & Reuse */}
                <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                    <div>
                        <div className="flex items-center gap-2 mb-3 justify-center md:justify-start"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Imperative Start</h4></div>
                        <div className="space-y-4">
                            {result.imperativeStart
                                .filter(f => f.countCampaigns > 0 && !(f.key?.startsWith('none:')))
                                .sort((a, b) => (a.key?.startsWith('none:') ? 1 : 0) - (b.key?.startsWith('none:') ? 1 : 0))
                                .map(f => (
                                    <TooltipPortal key={f.key} content={(
                                        <div>
                                            <div className="text-xs font-medium mb-1">Examples</div>
                                            <ul className="list-disc pl-4 text-xs space-y-1">
                                                {(f.examples || []).map((ex, i) => (<li key={i} className="truncate max-w-xs" title={ex}>{ex}</li>))}
                                            </ul>
                                        </div>
                                    )}>
                                        <div className="w-full rounded-2xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-gray-900 flex items-center justify-between">
                                            <div className="text-base text-gray-900 dark:text-gray-100">{f.label}</div>
                                            <div className={`text-base font-medium ${f.liftVsBaseline >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(f.liftVsBaseline)}</div>
                                        </div>
                                    </TooltipPortal>
                                ))}
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-3 justify-center md:justify-start"><h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Reuse Fatigue (exact match)</h4></div>
                        <div className="space-y-3 max-h-72 overflow-auto pr-1">
                            {result.reuse.slice(0, 10).map(r => (
                                <TooltipPortal key={r.subject} content={(<div>
                                    <div className="text-sm">Occurrences: {r.occurrences}</div>
                                    <div className="text-[11px]">First: {fmt(r.firstValue)} • Last: {fmt(r.lastValue)}</div>
                                </div>)}>
                                    <div className="w-full rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900">
                                        <div className="text-sm truncate text-gray-900 dark:text-gray-100" title={r.subject}>{r.subject || 'Untitled'}</div>
                                        <div className={`text-sm ${r.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liftFmt(r.change)}</div>
                                    </div>
                                </TooltipPortal>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
