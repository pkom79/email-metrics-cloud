"use client";
import React, { useMemo, useState, useCallback } from 'react';
import { Users, Info } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

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
                const dates = activeSubs.map(s => s.profileCreated.getTime()); if (!dates.length) return null; return { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) };
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
            while (cursor <= end) { push(cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cursor); cursor.setDate(cursor.getDate() + 1); }
        } else if (granularity === 'weekly') {
            while (cursor <= end) { push(cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cursor); cursor.setDate(cursor.getDate() + 7); }
        } else {
            while (cursor <= end) { push(cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), cursor); cursor.setMonth(cursor.getMonth() + 1); }
        }
        const idxFor = (d: Date) => {
            if (granularity === 'daily') return Math.floor((d.getTime() - start.getTime()) / 86400000);
            if (granularity === 'weekly') return Math.floor((d.getTime() - start.getTime()) / (86400000 * 7));
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
    }, [granularity, activeSubs]);

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
    const maxVal = Math.max(1, ...buckets.map(b => metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed));
    const width = 850; const height = 170; const innerH = 120; const padLeft = 40; const padRight = 20; const innerW = width - padLeft - padRight;
    const xScale = (i: number) => buckets.length <= 1 ? padLeft + innerW / 2 : padLeft + (i / (buckets.length - 1)) * innerW;
    const yScale = (v: number) => innerH - (v / maxVal) * (innerH - 10);
    const seriesVals = buckets.map((b, i) => ({ x: i, v: metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed }));
    const seriesCompareVals = compareBuckets.length === buckets.length ? compareBuckets.map((b, i) => ({ x: i, v: metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed })) : [];
    const buildPath = (pts: { x: number; v: number }[]) => { const pts2 = pts.filter(p => p.v > 0).map(p => ({ x: xScale(p.x), y: yScale(p.v) })); if (pts2.length < 2) return ''; const d = [`M${pts2[0].x} ${pts2[0].y}`]; for (let i = 0; i < pts2.length - 1; i++) { const p0 = pts2[i - 1] || pts2[i]; const p1 = pts2[i]; const p2 = pts2[i + 1]; const p3 = pts2[i + 2] || p2; const cp1x = p1.x + (p2.x - p0.x) / 6; const cp1y = p1.y + (p2.y - p0.y) / 6; const cp2x = p2.x - (p3.x - p1.x) / 6; const cp2y = p2.y - (p3.y - p1.y) / 6; d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`); } return d.join(' '); };
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
    const yTicks = 4;
    const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

    const active = hoverIdx != null ? buckets[hoverIdx] : null;

    return (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
            <div className="flex items-start justify-between mb-6 sticky top-14 z-20 bg-white border-b border-transparent pb-2">
                <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 tracking-tight flex items-center gap-2">Audience Growth
                        <span className="relative group inline-flex items-center">
                            <Info className="w-4 h-4 text-gray-400 group-hover:text-gray-600 cursor-pointer" />
                            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-6 z-30 hidden group-hover:block w-80 bg-white border border-gray-200 text-gray-800 text-[11px] leading-snug p-3 rounded-lg shadow-xl">
                                <span className="font-semibold block mb-1">What is this?</span>
                                Tracks additions to your ACTIVE email audience over time (current emailable profiles only). Created = profile added (signup or import). First Active = first recorded event. Subscribed = inferred organic signup (consent + first activity). Imports without consent aren’t counted as Subscribed.
                            </span>
                        </span>
                    </h3>
                </div>
                <div className="flex gap-3 text-sm items-start">
                    <div className="relative">
                        <select value={metric} onChange={e => setMetric(e.target.value as Metric)} className="appearance-none px-3 h-9 pr-8 rounded-lg border bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                            <option value="created">Created</option>
                            <option value="firstActive">First Active</option>
                            <option value="subscribed">Subscribed</option>
                        </select>
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
                    </div>
                </div>
            </div>
            <div className="flex items-start justify-between mb-4">
                <div />
                <div className="text-right">
                    <div className="flex items-center justify-end gap-2 mb-0.5">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Total {metric === 'created' ? 'Created' : metric === 'firstActive' ? 'First Active' : 'Subscribed'}</div>
                        {pctChange != null && <span className={`text-[11px] font-medium flex items-center gap-0.5 ${pctChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{pctChange >= 0 ? '↑' : '↓'} {Math.abs(pctChange).toFixed(1)}%</span>}
                    </div>
                    <div className="text-4xl font-bold text-gray-900 tabular-nums">{total.toLocaleString()}</div>
                </div>
            </div>
            <div className="relative" style={{ width: '100%' }}>
                <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block select-none">
                    <defs>
                        <linearGradient id="ag-line" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.4} /></linearGradient>
                        <linearGradient id="ag-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} /></linearGradient>
                    </defs>
                    {areaD && <path d={areaD} fill="url(#ag-area)" stroke="none" />}
                    {pathD && <path d={pathD} fill="none" stroke="url(#ag-line)" strokeWidth={2} />}
                    {/* Y axis */}
                    {/* Y axis ticks (labels only, no horizontal grid lines) */}
                    {yTickValues.map(v => {
                        const y = yScale(v); return (
                            <g key={v}>
                                <text x={padLeft - 6} y={y + 3} fontSize={10} fill="#6b7280" textAnchor="end" className="tabular-nums">{v.toLocaleString()}</text>
                            </g>
                        );
                    })}
                    {/* X axis baseline */}
                    <line x1={padLeft} x2={width - padRight} y1={innerH} y2={innerH} stroke="#e5e7eb" />
                    {/* X axis ticks */}
                    {tickIndices.map(i => {
                        const b = buckets[i];
                        const x = xScale(i) - 30;
                        return <text key={i} x={x} y={height - 15} fontSize={11} fill="#6b7280" textAnchor="start">{b.label}</text>;
                    })}
                    {/* Hover hit zones */}
                    {buckets.map((b, i) => { const x = xScale(i); const cellW = innerW / Math.max(1, (buckets.length - 1)); return <rect key={i} x={x - cellW / 2} y={0} width={cellW} height={height} fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />; })}
                </svg>
                {active && hoverIdx != null && (
                    <div className="pointer-events-none absolute z-20 px-3 py-2 bg-white text-gray-900 text-xs rounded-lg shadow-lg border border-gray-200" style={{ left: `${(xScale(hoverIdx) / width) * 100}%`, top: '10%', transform: 'translate(-50%, 0)' }}>
                        <div className="font-medium mb-0.5 text-gray-900">{active.label}</div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500">Created</span><span className="tabular-nums">{active.countCreated.toLocaleString()}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500">First Active</span><span className="tabular-nums">{active.countFirst.toLocaleString()}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-gray-500">Subscribed</span><span className="tabular-nums">{active.countSubscribed.toLocaleString()}</span></div>
                    </div>
                )}
            </div>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="border border-gray-200 rounded-2xl p-5 bg-white">
                    <div className="text-gray-500 mb-2 font-medium text-sm">Created</div>
                    <div className="text-gray-900 font-semibold tabular-nums text-2xl md:text-3xl leading-none">{buckets.reduce((s, b) => s + b.countCreated, 0).toLocaleString()}</div>
                </div>
                <div className="border border-gray-200 rounded-2xl p-5 bg-white">
                    <div className="text-gray-500 mb-2 font-medium text-sm">First Active</div>
                    <div className="text-gray-900 font-semibold tabular-nums text-2xl md:text-3xl leading-none">{buckets.reduce((s, b) => s + b.countFirst, 0).toLocaleString()}</div>
                </div>
                <div className="border border-gray-200 rounded-2xl p-5 bg-white">
                    <div className="text-gray-500 mb-2 font-medium text-sm">Subscribed</div>
                    <div className="text-gray-900 font-semibold tabular-nums text-2xl md:text-3xl leading-none">{buckets.reduce((s, b) => s + b.countSubscribed, 0).toLocaleString()}</div>
                </div>
            </div>
            {/* Disclaimer removed; information lives in tooltip only */}
        </div>
    );
}
