"use client";
import React, { useMemo, useState } from 'react';
import type { ProcessedCampaign, ProcessedFlowEmail } from '../../lib/data/dataTypes';
import { buildWeeklyAggregates, computeReliability } from '../../lib/analytics/reliability';
import { ShieldCheck } from 'lucide-react';

interface Props { campaigns: ProcessedCampaign[]; flows: ProcessedFlowEmail[]; dateRange: string; }

const formatCurrency = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

export default function RevenueReliabilityV2({ campaigns, flows, dateRange }: Props) {
    const [scope, setScope] = useState<'all' | 'campaigns' | 'flows'>('all');
    const weeks = useMemo(() => buildWeeklyAggregates(scope === 'flows' ? [] : campaigns, scope === 'campaigns' ? [] : flows), [campaigns, flows, scope, dateRange]);
    const result = useMemo(() => computeReliability(weeks, { scope, windowSize: 12 }), [weeks, scope]);
    if (!weeks.length) return null;
    const reliability = result.reliability;
    const badgeColor = reliability == null ? 'bg-gray-300 text-gray-700' : reliability >= 80 ? 'bg-green-600 text-white' : reliability >= 65 ? 'bg-emerald-500 text-white' : reliability >= 50 ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white';
    // Sparkline geometry
    const pts = result.points;
    const width = 420; const height = 110; const padY = 14; const padX = 10;
    const maxIdx = Math.max(1.4, ...pts.map((p) => p.index));
    const minIdx = Math.min(0.4, ...pts.map((p) => p.index));
    const yFor = (idx: number) => {
        const span = maxIdx - minIdx || 1;
        return padY + (1 - (idx - minIdx) / span) * (height - padY * 2);
    };
    const xFor = (i: number) => padX + i * ((width - padX * 2) / (Math.max(1, pts.length - 1)));
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(p.index)}`).join(' ');
    // Band = median ± (MAD/median) (converted in index space as 1 ± (mad/median))
    const bandUpper = 1 + (result.mad && result.median ? result.mad / result.median : 0);
    const bandLower = 1 - (result.mad && result.median ? result.mad / result.median : 0);
    const bandUpperY = yFor(bandUpper);
    const bandLowerY = yFor(bandLower);
    const showBand = result.mad !== null && result.median && result.mad > 0;
    return (
        <div className="mt-8">
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-purple-600" />
                        <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">Weekly Revenue Reliability</h3>
                        <select value={scope} onChange={e => setScope(e.target.value as any)} className="ml-2 px-2 py-1 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200">
                            <option value="all">All Email</option>
                            <option value="campaigns">Campaigns</option>
                            <option value="flows">Flows</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        {reliability === null ? <span className="text-xs text-gray-500">Insufficient history</span> : (
                            <div className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeColor}`}>{reliability}%{result.trendDelta !== null && <span className={`ml-1 font-medium ${result.trendDelta > 0 ? 'text-green-100' : 'text-red-100'}`}>{result.trendDelta > 0 ? '+' : ''}{result.trendDelta}</span>}</div>
                        )}
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                    <div className="relative">
                        <svg width={width} height={height} className="overflow-visible block">
                            {showBand && (
                                <rect x={0} y={bandUpperY} width={width} height={Math.max(2, bandLowerY - bandUpperY)} className="fill-purple-500/10" />
                            )}
                            <path d={linePath} className="stroke-purple-600 dark:stroke-purple-400 fill-none" strokeWidth={1.8} strokeLinecap="round" />
                            {pts.map((p, i) => {
                                const x = xFor(i); const y = yFor(p.index);
                                const anomaly = p.isAnomaly;
                                return <circle key={i} cx={x} cy={y} r={anomaly ? 4 : 3} className={anomaly ? 'fill-rose-500 stroke-white stroke-[1.2px]' : 'fill-white stroke-purple-600 dark:stroke-purple-400'} />
                            })}
                            {/* Baseline index 1 line */}
                            <line x1={0} x2={width} y1={yFor(1)} y2={yFor(1)} className="stroke-dashed stroke-gray-300 dark:stroke-gray-700" strokeDasharray="4 3" />
                        </svg>
                    </div>
                    <div className="flex-1 grid grid-cols-2 gap-4 text-xs">
                        <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">Median Weekly Rev</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{result.median ? formatCurrency(result.median) : '—'}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">Dispersion (MAD)</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{result.mad ? formatCurrency(result.mad) : '—'}</p>
                        </div>
                        <div className="col-span-2 text-[11px] text-gray-500 leading-snug mt-1">
                            Reliability reflects stability of weekly revenue (robust dispersion via MAD/median over up to last 12 full weeks). Outliers marked.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
