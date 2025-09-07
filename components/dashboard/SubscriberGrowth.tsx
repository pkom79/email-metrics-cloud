"use client";
import React, { useMemo, useState } from 'react';
import SelectBase from "../ui/SelectBase";
import { Users, Info } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

interface Props { dateRange: string; granularity: 'daily' | 'weekly' | 'monthly'; customFrom?: string; customTo?: string; }

type Metric = 'created' | 'firstActive' | 'subscribed';

interface Bucket { label: string; countCreated: number; countFirst: number; countSubscribed: number; }

export default function SubscriberGrowth({ dateRange, granularity, customFrom, customTo }: Props) {
    const dm = DataManager.getInstance();
    const subs = dm.getSubscribers();
    const [metric, setMetric] = useState<Metric>('created');

    const range = useMemo(() => {
        try {
            if (dateRange === 'custom' && customFrom && customTo) return { start: new Date(customFrom + 'T00:00:00'), end: new Date(customTo + 'T23:59:59') };
            if (dateRange === 'all') {
                const dates = subs.map(s => s.profileCreated.getTime());
                if (!dates.length) return null; return { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) };
            }
            const days = parseInt(dateRange.replace('d', '')) || 30;
            const end = dm.getLastEmailDate() || new Date(); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            return { start, end };
        } catch { return null; }
    }, [dateRange, customFrom, customTo, subs, dm]);

    const buckets = useMemo(() => {
        if (!range) return [] as Bucket[];
        const { start, end } = range;
        const res: Bucket[] = [];
        const push = (label: string) => { res.push({ label, countCreated: 0, countFirst: 0, countSubscribed: 0 }); };
        // build bucket boundaries
        const cursor = new Date(start);
        const formatLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (granularity === 'daily') {
            while (cursor <= end) { push(formatLabel(cursor)); cursor.setDate(cursor.getDate() + 1); }
        } else if (granularity === 'weekly') {
            while (cursor <= end) { push(formatLabel(cursor)); cursor.setDate(cursor.getDate() + 7); }
        } else {
            while (cursor <= end) { push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`); cursor.setMonth(cursor.getMonth() + 1); }
        }
        const idxFor = (d: Date) => {
            if (granularity === 'daily') return Math.floor((d.getTime() - start.getTime()) / (86400000));
            if (granularity === 'weekly') return Math.floor((d.getTime() - start.getTime()) / (86400000 * 7));
            return (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
        };
        subs.forEach(s => {
            const created = s.profileCreated; if (created >= start && created <= end) { const i = idxFor(created); if (res[i]) res[i].countCreated++; }
            const first = s.firstActiveRaw || s.firstActive; if (first && first >= start && first <= end) { const i = idxFor(first); if (res[i]) res[i].countFirst++; }
            // subscribed: emailConsent true & firstActiveRaw exists as sign-up date surrogate
            if (s.emailConsent && s.firstActive && s.firstActive >= start && s.firstActive <= end) { const i = idxFor(s.firstActive); if (res[i]) res[i].countSubscribed++; }
        });
        return res;
    }, [subs, range, granularity]);

    const total = useMemo(() => buckets.reduce((s, b) => s + (metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed), 0), [buckets, metric]);

    if (!buckets.length) return null;

    const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.countCreated, b.countFirst, b.countSubscribed)));

    const seriesVals = buckets.map((b, i) => {
        const v = metric === 'created' ? b.countCreated : metric === 'firstActive' ? b.countFirst : b.countSubscribed; return { x: i, v };
    });

    const width = 900; const height = 140; const innerH = 110; const padLeft = 40; const padRight = 20; const innerW = width - padLeft - padRight;
    const xScale = (i: number) => buckets.length <= 1 ? padLeft + innerW / 2 : padLeft + (i / (buckets.length - 1)) * innerW;
    const yScale = (v: number) => innerH - (v / maxVal) * (innerH - 10);
    const pathD = (() => { const pts = seriesVals.filter(p => p.v > 0).map(p => ({ x: xScale(p.x), y: yScale(p.v) })); if (pts.length < 2) return ''; const d = [`M${pts[0].x} ${pts[0].y}`]; for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2; const cp1x = p1.x + (p2.x - p0.x) / 6; const cp1y = p1.y + (p2.y - p0.y) / 6; const cp2x = p2.x - (p3.x - p1.x) / 6; const cp2y = p2.y - (p3.y - p1.y) / 6; d.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`); } return d.join(' '); })();
    const areaD = pathD ? `${pathD} L ${xScale(seriesVals[seriesVals.length - 1].x)} ${innerH} L ${xScale(seriesVals[0].x)} ${innerH} Z` : '';

    return (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8">
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 tracking-tight">Subscriber Growth</h3>
                </div>
                <div className="flex gap-3 text-sm">
                    <div className="relative">
                        <SelectBase value={metric} onChange={e => setMetric((e.target as HTMLSelectElement).value as Metric)} className="px-3 h-9 pr-8 rounded-lg border bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
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
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-0.5">Total {metric === 'created' ? 'Created' : metric === 'firstActive' ? 'First Active' : 'Subscribed'}</div>
                    <div className="text-3xl font-bold text-gray-900 tabular-nums">{total.toLocaleString()}</div>
                </div>
            </div>
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block select-none">
                <defs>
                    <linearGradient id="sg-line" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.4} /></linearGradient>
                    <linearGradient id="sg-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} /></linearGradient>
                </defs>
                {areaD && <path d={areaD} fill="url(#sg-area)" stroke="none" />}
                {pathD && <path d={pathD} fill="none" stroke="url(#sg-line)" strokeWidth={2} />}
                {buckets.map((b, i) => { const x = xScale(i); return <text key={i} x={x} y={height - 10} fontSize={11} fill="#6b7280" textAnchor="middle">{b.label}</text>; })}
                <line x1={padLeft} x2={width - padRight} y1={innerH} y2={innerH} stroke="#e5e7eb" />
            </svg>
            <div className="mt-6 grid grid-cols-3 gap-4 text-xs">
                <div className="border border-gray-200 rounded-lg p-3"><div className="text-gray-500 mb-1 font-medium">Created</div><div className="text-gray-900 font-semibold tabular-nums">{buckets.reduce((s, b) => s + b.countCreated, 0).toLocaleString()}</div></div>
                <div className="border border-gray-200 rounded-lg p-3"><div className="text-gray-500 mb-1 font-medium">First Active</div><div className="text-gray-900 font-semibold tabular-nums">{buckets.reduce((s, b) => s + b.countFirst, 0).toLocaleString()}</div></div>
                <div className="border border-gray-200 rounded-lg p-3"><div className="text-gray-500 mb-1 font-medium">Subscribed</div><div className="text-gray-900 font-semibold tabular-nums">{buckets.reduce((s, b) => s + b.countSubscribed, 0).toLocaleString()}</div></div>
            </div>
            <div className="mt-4 text-[11px] text-gray-500 flex items-center gap-2"><Info className="w-3 h-3" /> Created = Profile Created On; First Active = first event; Subscribed = inferred from consent.</div>
        </div>
    );
}
