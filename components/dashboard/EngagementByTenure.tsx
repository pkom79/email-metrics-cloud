"use client";
import React, { useMemo } from 'react';
import { Grid as GridIcon, Info } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import type { ProcessedSubscriber } from '../../lib/data/dataTypes';
import { DataManager } from '../../lib/data/dataManager';
import TooltipPortal from '../TooltipPortal';

interface Props {
    subscribers: ProcessedSubscriber[];
    dateRange: string;
    customTo?: string;
}

// Compute full months difference between two dates (anchor >= start)
function diffInFullMonths(anchor: Date, start: Date): number {
    let months = (anchor.getFullYear() - start.getFullYear()) * 12 + (anchor.getMonth() - start.getMonth());
    // If anchor day is earlier than start day, subtract one month to count only full months elapsed
    if (anchor.getDate() < start.getDate()) months -= 1;
    return Math.max(0, months);
}

function daysBetween(a: Date, b: Date) {
    const MS = 1000 * 60 * 60 * 24;
    const da = new Date(a); da.setHours(0, 0, 0, 0);
    const db = new Date(b); db.setHours(0, 0, 0, 0);
    return Math.floor((da.getTime() - db.getTime()) / MS);
}

export default function EngagementByTenure({ subscribers, dateRange, customTo }: Props) {
    const dm = DataManager.getInstance();

    const anchor = useMemo(() => {
        if (dateRange === 'custom' && customTo) {
            const d = new Date(customTo + 'T23:59:59');
            return isNaN(d.getTime()) ? dm.getLastEmailDate() : d;
        }
        return dm.getLastEmailDate();
    }, [dm, dateRange, customTo]);

    const model = useMemo(() => {
        if (!subscribers?.length) return null;

        // Age buckets in months based on profileCreated only
        const ageDefs = [
            { key: '0_6m', label: '0–6 months', minM: 0, maxM: 5 },   // 0..5 full months
            { key: '6_12m', label: '6–12 months', minM: 6, maxM: 11 },
            { key: '1_2y', label: '1–2 years', minM: 12, maxM: 23 },
            { key: '2y_plus', label: '2+ years', minM: 24, maxM: Infinity },
        ];

        // Engagement buckets in days since last engagement (latest of open/click)
        // Mutually exclusive; use 121+ to avoid overlap with 91–120
        const engDefs = [
            { key: '0_30', label: '0–30 days', minD: 0, maxD: 30 },
            { key: '31_60', label: '31–60 days', minD: 31, maxD: 60 },
            { key: '61_90', label: '61–90 days', minD: 61, maxD: 90 },
            { key: '91_120', label: '91–120 days', minD: 91, maxD: 120 },
            { key: '121_plus', label: '120+ days', minD: 121, maxD: Infinity },
            { key: 'never', label: 'Never engaged', minD: null as number | null, maxD: null as number | null },
        ];

        // Initialize counts
        const rows = ageDefs.map(a => ({ key: a.key, label: a.label, denom: 0, cells: engDefs.map(e => ({ key: e.key, count: 0 })) }));

        for (const s of subscribers) {
            const created = s.profileCreated instanceof Date ? s.profileCreated : null;
            if (!created) continue; // exclude unknown age

            const ageMonths = diffInFullMonths(anchor, created);
            const ageIdx = ageDefs.findIndex(a => ageMonths >= a.minM && ageMonths <= a.maxM);
            if (ageIdx === -1) continue;

            rows[ageIdx].denom += 1;

            const lastOpen = s.lastOpen instanceof Date ? s.lastOpen : null;
            const lastClick = s.lastClick instanceof Date ? s.lastClick : null;
            const last = (lastOpen && lastClick) ? (lastOpen > lastClick ? lastOpen : lastClick) : (lastOpen || lastClick);

            if (!last) {
                const cell = rows[ageIdx].cells.find(c => c.key === 'never');
                if (cell) cell.count += 1;
                continue;
            }

            const d = daysBetween(anchor, last);
            for (const e of engDefs) {
                if (e.key === 'never') continue;
                // e.minD and e.maxD are numbers for non-'never' buckets
                const minD = e.minD as number;
                const maxD = e.maxD as number;
                if (d >= minD && d <= maxD) {
                    const cell = rows[ageIdx].cells.find(c => c.key === e.key);
                    if (cell) cell.count += 1;
                    break;
                }
            }
        }

        // Compute percentages per row (row-normalized), include zeros
        const table = rows.map(r => {
            const percents = r.cells.map(c => ({ key: c.key, percent: r.denom > 0 ? (c.count / r.denom) * 100 : 0, count: c.count }));
            const rowMax = Math.max(...percents.map(p => p.percent), 0);
            return { key: r.key, label: r.label, denom: r.denom, percents, rowMax };
        });

        return { engDefs, table };
    }, [subscribers, anchor]);

    if (!model) return null;

    const { engDefs, table } = model;

    // Color helper: purple scale based on row-normalized intensity
    const colorFor = (percent: number, rowMax: number) => {
        const intensity = rowMax > 0 ? percent / rowMax : 0;
        // Map to a few tailwind shades for accessibility
        if (intensity >= 0.8) return 'bg-purple-700 text-white';
        if (intensity >= 0.6) return 'bg-purple-600 text-white';
        if (intensity >= 0.4) return 'bg-purple-500 text-white';
        if (intensity >= 0.25) return 'bg-purple-400 text-purple-900';
        if (intensity > 0) return 'bg-purple-200 text-purple-900';
        return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
    };

    const fmtP = (v: number) => {
        const abs = Math.abs(v);
        if (abs >= 10) return v.toFixed(1) + '%';
        if (abs >= 1) return v.toFixed(1) + '%';
        return v.toFixed(2) + '%';
    };

    return (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center gap-2 mb-3">
                <GridIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Engagement by Profile Age</h3>
                <InfoTooltipIcon
                    placement="bottom-start"
                    content={(
                        <div className="space-y-2">
                            <p className="font-semibold">What</p>
                            <p>How engagement changes by profile age segment.</p>
                            <p className="font-semibold">How</p>
                            <p>Shows what share of each profile age segment engaged recently versus not.</p>
                            <p className="font-semibold">Why</p>
                            <p>Win back older segments. Nurture new ones to build habits.</p>
                        </div>
                    )}
                />
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full border-separate" style={{ borderSpacing: 0 }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-white dark:bg-gray-900 text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1 border-b border-gray-200 dark:border-gray-800">{/* intentionally blank header */}</th>
                            {engDefs.map((e) => (
                                <th key={e.key} className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1 border-b border-gray-200 dark:border-gray-800 text-center whitespace-nowrap">{e.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {table.map((row) => (
                            <tr key={row.key}>
                                <td className="sticky left-0 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-2 py-1 border-b border-gray-100 dark:border-gray-800 font-medium whitespace-nowrap">{row.label} <span className="text-xs text-gray-500 dark:text-gray-400">({row.denom.toLocaleString()})</span></td>
                                {row.percents.map((cell) => (
                                    <td key={cell.key} className="px-2 py-1 border-b border-gray-100 dark:border-gray-800">
                                        <TooltipPortal
                                            placement="auto"
                                            content={(
                                                <div className="w-64 text-xs text-gray-700 dark:text-gray-300">
                                                    <div className="mb-2">
                                                        <span className="font-semibold text-gray-900 dark:text-gray-100">Profile Age: </span>
                                                        <span>{row.label}</span>
                                                    </div>
                                                    <div className="mb-2">
                                                        <span className="font-semibold text-gray-900 dark:text-gray-100">Last Engaged: </span>
                                                        <span>{engDefs.find(e => e.key === cell.key)?.label}</span>
                                                    </div>
                                                    <div className="mb-0.5">
                                                        <span className="font-semibold text-gray-900 dark:text-gray-100">Share: </span>
                                                        <span>{fmtP(cell.percent)}</span>
                                                    </div>
                                                </div>
                                            )}
                                        >
                                            <div className={`rounded-md h-7 flex items-center justify-center ${colorFor(cell.percent, row.rowMax)}`}>
                                                <span className="text-xs font-semibold tabular-nums">{fmtP(cell.percent)}</span>
                                            </div>
                                        </TooltipPortal>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
