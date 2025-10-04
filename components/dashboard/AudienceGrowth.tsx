"use client";
import React, { useMemo, useState, useCallback } from 'react';
import { ArrowUpRight, Info, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import SelectBase from "../ui/SelectBase";
import { DataManager } from '../../lib/data/dataManager';
import { computeAxisMax, thirdTicks, formatTickLabels } from '../../lib/utils/chartTicks';

interface Props { dateRange: string; granularity: 'daily' | 'weekly' | 'monthly'; customFrom?: string; customTo?: string; compareMode?: 'prev-period' | 'prev-year'; }

type Metric = 'created' | 'firstActive' | 'subscribed';
interface Bucket { label: string; start: Date; countCreated: number; countFirst: number; countSubscribed: number; }

// (Legacy) parsing helper no longer needed now that transformer exposes emailConsentTimestamp
// Kept as a no-op fallback for backward compatibility if older data still present
function parseConsentDate(raw: any): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    const s = String(raw).trim();
    if (!s || ['TRUE', 'FALSE', 'NEVER_SUBSCRIBED'].includes(s.toUpperCase())) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

export default function AudienceGrowth({ dateRange, granularity, customFrom, customTo, compareMode = 'prev-period' }: Props) {
    const dm = DataManager.getInstance();
    const subs = dm.getSubscribers();
    // Active audience filter (consent or canReceiveEmail truthy). Fallback: all.
    const activeSubs = useMemo(() => subs.filter(s => (s.emailConsent || s.canReceiveEmail !== false)), [subs]);
    const [metric, setMetric] = useState<Metric>('created');

    // Range calc (mirrors existing component)
    const range = useMemo(() => {
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
            if (dateRange === 'all') {
                // Avoid spreading large arrays into Math.min/Math.max which can overflow the call stack
                let minTime = Infinity;
                let maxTime = -Infinity;
                for (const s of activeSubs) {
                    const d = s.profileCreated;
                    if (d instanceof Date && !isNaN(d.getTime())) {
                        const t = d.getTime();
                        if (t < minTime) minTime = t;
                        if (t > maxTime) maxTime = t;
                    }
                }
                if (!isFinite(minTime) || !isFinite(maxTime)) return null;
                return { start: new Date(minTime), end: new Date(maxTime) };
            }
            const days = parseInt(dateRange.replace('d', '')) || 30;
            const end = dm.getLastEmailDate() || new Date(); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            return { start, end };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, activeSubs, dm]);

    const buildBuckets = useCallback((start: Date, end: Date): Bucket[] => {
        const res: Bucket[] = [];
        const cursor = new Date(start);
        const push = (label: string, d: Date) => { res.push({ label, start: new Date(d), countCreated: 0, countFirst: 0, countSubscribed: 0 }); };
        if (granularity === 'daily') {
            while (cursor <= end) { push(cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), cursor); cursor.setDate(cursor.getDate() + 1); }
        } else if (granularity === 'weekly') {
            // Use Monday-based weeks with proper range labels for consistency
            while (cursor <= end) {
                const boundaries = dm.getWeekBoundaries(cursor);
                console.log('📊 AudienceGrowth weekly bucket:', {
                    cursor: cursor.toISOString().slice(0, 10),
                    monday: boundaries.monday.toISOString().slice(0, 10),
                    rangeLabel: boundaries.rangeLabel
                });
                push(boundaries.rangeLabel, new Date(boundaries.monday));
                cursor.setDate(cursor.getDate() + 7);
            }
        } else {
            while (cursor <= end) { push(cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }), cursor); cursor.setMonth(cursor.getMonth() + 1); }
        }
        const idxFor = (d: Date) => {
            if (granularity === 'daily') return Math.floor((d.getTime() - start.getTime()) / 86400000);
            if (granularity === 'weekly') {
                // Find which Monday-based week bucket this date belongs to
                const boundaries = dm.getWeekBoundaries(d);
                const weekMonday = boundaries.monday;
                // Find the bucket with this Monday
                for (let i = 0; i < res.length; i++) {
                    if (res[i].start.getTime() === weekMonday.getTime()) return i;
                }
                return -1; // Not in any bucket (shouldn't happen if date is in range)
            }
            return (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
        };
        activeSubs.forEach(s => {
            const created = s.profileCreated; if (created >= start && created <= end) { const i = idxFor(created); if (res[i]) res[i].countCreated++; }
            const first = s.firstActiveRaw || s.firstActive; if (first && first >= start && first <= end) { const i = idxFor(first); if (res[i]) res[i].countFirst++; }
            // Subscribed now based on processed consent timestamp. Fallback to raw parse and then created date if consent true.
            const consentDate = (s as any).emailConsentTimestamp || parseConsentDate((s as any).emailConsentRaw);
            if (consentDate && consentDate >= start && consentDate <= end) {
                const i = idxFor(consentDate); if (res[i]) res[i].countSubscribed++;
            } else if (s.emailConsent && created >= start && created <= end) {
                const i = idxFor(created); if (res[i]) res[i].countSubscribed++;
            }
        });
        return res;
    }, [granularity, activeSubs, dm]);

    const buckets = useMemo(() => { if (!range) return [] as Bucket[]; return buildBuckets(range.start, range.end); }, [range, buildBuckets]);

    // Compare period buckets (only if not 'all')
    const compareBuckets = useMemo(() => {
        if (!range || dateRange === 'all') return [] as Bucket[];
        const spanMs = range.end.getTime() - range.start.getTime();
        let prevStart = new Date(range.start); let prevEnd = new Date(range.end);
        if (compareMode === 'prev-year') { prevStart.setFullYear(prevStart.getFullYear() - 1); prevEnd.setFullYear(prevEnd.getFullYear() - 1); }
        else { prevEnd = new Date(range.start.getTime() - 1); prevStart = new Date(prevEnd.getTime() - spanMs); }
        return buildBuckets(prevStart, prevEnd);
    }, [range, dateRange, compareMode, buildBuckets]);

    const total = useMemo(() => buckets.reduce((s, b) => s + (metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed), 0), [buckets, metric]);
    const prevTotal = useMemo(() => compareBuckets.reduce((s, b) => s + (metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed), 0), [compareBuckets, metric]);
    const pctChange = useMemo(() => { if (!prevTotal) return null; return ((total - prevTotal) / prevTotal) * 100; }, [total, prevTotal]);

    // Hover state (defined before conditional return to satisfy hooks rule)
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);

    if (!buckets.length) return null;

    // Scale now based only on selected metric for better visual variation
    const rawMax = Math.max(0, ...buckets.map(b => metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed));
    const maxVal = computeAxisMax([rawMax], null, 'number');
    const width = 850; const height = 170; const innerH = 120; const padLeft = 40; const padRight = 20; const innerW = width - padLeft - padRight;
    const xScale = (i: number) => buckets.length <= 1 ? padLeft + innerW / 2 : padLeft + (i / (buckets.length - 1)) * innerW;
    // Clamp to 0: never render below baseline even with smoothing/negative glitches
    const yScale = (v: number) => {
        const y = innerH - (Math.max(0, v) / maxVal) * (innerH - 10);
        return Math.min(innerH, Math.max(0, y));
    };
    const seriesVals = buckets.map((b, i) => ({ x: i, v: metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed }));
    const seriesCompareVals = compareBuckets.length === buckets.length ? compareBuckets.map((b, i) => ({ x: i, v: metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed })) : [];
    const buildPath = (pts: { x: number; v: number }[]) => {
        const pts2 = pts.filter(p => p.v > 0).map(p => ({ x: xScale(p.x), y: yScale(p.v) }));
        if (pts2.length < 2) return '';
        const d: string[] = [`M${pts2[0].x} ${Math.min(innerH, Math.max(0, pts2[0].y))}`];
        for (let i = 0; i < pts2.length - 1; i++) {
            const p0 = pts2[i - 1] || pts2[i];
            const p1 = pts2[i];
            const p2 = pts2[i + 1];
            const p3 = pts2[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = Math.min(innerH, Math.max(0, p1.y + (p2.y - p0.y) / 6));
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = Math.min(innerH, Math.max(0, p2.y - (p3.y - p1.y) / 6));
            const endY = Math.min(innerH, Math.max(0, p2.y));
            d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${endY}`);
        }
        return d.join(' ');
    };
    const pathD = buildPath(seriesVals);
    // Compare path removed (only used for pct change summary)
    const comparePathD = '';
    const areaD = pathD ? `${pathD} L ${xScale(seriesVals[seriesVals.length - 1].x)} ${innerH} L ${xScale(seriesVals[0].x)} ${innerH} Z` : '';

    // X axis tick calculation (evenly spaced, independent of bucket label density)
    const desiredXTicks = 6; // including first & last
    const tickIndices: number[] = [];
    if (buckets.length <= desiredXTicks) {
        for (let i = 0; i < buckets.length; i++) tickIndices.push(i);
    } else {
        for (let i = 0; i < desiredXTicks; i++) {
            const idx = Math.round((i / (desiredXTicks - 1)) * (buckets.length - 1));
            if (!tickIndices.includes(idx)) tickIndices.push(idx);
        }
    }

    // Y axis ticks (4 divisions)
    // Thirds-based ticks and labels (numbers) — compute directly (avoid hooks after early return)
    const yTickValues = thirdTicks(maxVal, 'number');
    const yTickLabels = formatTickLabels(yTickValues, 'number', maxVal);

    const active = hoverIdx != null ? buckets[hoverIdx] : null;

    return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 mb-8">
            <div className="flex items-start justify-between mb-6 sticky top-14 z-20 bg-white dark:bg-gray-900 border-b border-transparent pb-2">
                <div className="flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-2">Audience Growth
                        <InfoTooltipIcon
                            placement="bottom"
                            content={(
                                <div>
                                    <p className="font-semibold mb-1">What</p>
                                    <p>New profiles, initial activity, and signups over time.</p>
                                    <p className="font-semibold mt-2 mb-1">How</p>
                                    <p>Counts for Created which can occur by submitting a form, being imported, or through an integration like Shopify, First Active which includes actions like opening an email, clicking a link, visiting your website, or making a purchase, and Subscribed indicating that the person has explicitly given consent to receive marketing messages through that channel within your date range.</p>
                                    <p className="font-semibold mt-2 mb-1">Why</p>
                                    <p>Invest in sources and moments that generate genuine signups and early engagement.</p>
                                </div>
                            )}
                        />
                    </h3>
                </div>
                <div className="flex gap-3 text-sm items-start">
                    <div className="relative">
                        <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value as Metric)} className="px-3 h-9 pr-8 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                            <option value="created">Created</option>
                            <option value="firstActive">First Active</option>
                            <option value="subscribed">Subscribed</option>
                        </SelectBase>
                    </div>
                </div>
            </div>
            <div className="flex items-start justify-between mb-4">
                <div />
                <div className="text-right">
                    <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{total.toLocaleString()}</div>
                    {pctChange != null && (() => {
                        const zero = Math.abs(pctChange) < 0.01;
                        const positive = pctChange > 0;
                        const color = zero ? 'text-gray-600 dark:text-gray-400' : positive ? 'text-emerald-600' : 'text-rose-600';
                        return (
                            <div className="mt-1 flex justify-end">
                                <span className={`text-sm font-semibold tabular-nums inline-flex items-center ${color}`} title={prevTotal ? `Previous period: ${prevTotal.toLocaleString()}` : ''}>
                                    {zero ? <ArrowRight className="w-4 h-4 mr-1" /> : positive ? <ArrowUp className="w-4 h-4 mr-1" /> : <ArrowDown className="w-4 h-4 mr-1" />}
                                    {zero ? '0.0' : Math.abs(pctChange).toFixed(1)}%
                                </span>
                            </div>
                        );
                    })()}
                </div>
            </div>
            <div className="relative" style={{ width: '100%' }}>
                <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block select-none">
                    <defs>
                        <linearGradient id="ag-line" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.4} /></linearGradient>
                        <linearGradient id="ag-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} /></linearGradient>
                    </defs>
                    {areaD && <path d={areaD} fill="url(#ag-area)" stroke="none" />}
                    {pathD && <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
                    {/* Y axis */}
                    {/* Y axis ticks (labels only, no horizontal grid lines) */}
                    {yTickValues.map((v, i) => {
                        const y = yScale(v); return (
                            <g key={v}>
                                <text x={padLeft - 6} y={y + 3} fontSize={10} textAnchor="end" className="tabular-nums fill-gray-500 dark:fill-gray-400">{yTickLabels[i]}</text>
                            </g>
                        );
                    })}
                    {/* X axis baseline */}
                    <line x1={padLeft} x2={width - padRight} y1={innerH} y2={innerH} className="stroke-gray-200 dark:stroke-gray-700" />
                    {/* X axis ticks */}
                    {tickIndices.map(i => {
                        const b = buckets[i];
                        const x = xScale(i) - 30;
                        return <text key={i} x={x} y={height - 15} fontSize={11} textAnchor="start" className="fill-gray-500 dark:fill-gray-400">{b.label}</text>;
                    })}
                    {/* Hover hit zones */}
                    {buckets.map((b, i) => { const x = xScale(i); const cellW = innerW / Math.max(1, (buckets.length - 1)); return <rect key={i} x={x - cellW / 2} y={0} width={cellW} height={height} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />; })}
                </svg>
                {active && hoverIdx != null && (
                    <div className="pointer-events-none absolute z-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700" style={{ left: `${(xScale(hoverIdx) / width) * 100}%`, top: '10%', transform: 'translate(-50%, 0)' }}>
                        <div className="font-medium mb-0.5 text-gray-900 dark:text-gray-100">{active.label}</div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Created</span><span className="tabular-nums">{active.countCreated.toLocaleString()}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">First Active</span><span className="tabular-nums">{active.countFirst.toLocaleString()}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Subscribed</span><span className="tabular-nums">{active.countSubscribed.toLocaleString()}</span></div>
                    </div>
                )}
            </div>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="border border-gray-200 dark:border-gray-700 rounded-2xl p-5 bg-white dark:bg-gray-900">
                    <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium text-sm">Created</div>
                    <div className="text-gray-900 dark:text-gray-100 font-semibold tabular-nums text-2xl md:text-3xl leading-none">{buckets.reduce((s, b) => s + b.countCreated, 0).toLocaleString()}</div>
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-2xl p-5 bg-white dark:bg-gray-900">
                    <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium text-sm">First Active</div>
                    <div className="text-gray-900 dark:text-gray-100 font-semibold tabular-nums text-2xl md:text-3xl leading-none">{buckets.reduce((s, b) => s + b.countFirst, 0).toLocaleString()}</div>
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-2xl p-5 bg-white dark:bg-gray-900">
                    <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium text-sm">Subscribed</div>
                    <div className="text-gray-900 dark:text-gray-100 font-semibold tabular-nums text-2xl md:text-3xl leading-none">{buckets.reduce((s, b) => s + b.countSubscribed, 0).toLocaleString()}</div>
                </div>
            </div>
            {/* Disclaimer removed; information lives in tooltip only */}
        </div>
    );
}
