"use client";
import React, { useMemo, useState } from 'react';
import { UploadCloud, ListChecks } from 'lucide-react';
import Papa from 'papaparse';
import { ProcessedSubscriber } from '../../lib/data/dataTypes';
import { SubscriberTransformer } from '../../lib/data/transformers/subscriberTransformer';

const CustomSegmentBlock: React.FC = () => {
    // Segment A
    const [segmentASubscribers, setSegmentASubscribers] = useState<ProcessedSubscriber[]>([]);
    const [segmentAName, setSegmentAName] = useState<string>('');
    const [fileNameA, setFileNameA] = useState<string>('');
    const [errorA, setErrorA] = useState<string>('');
    const fileInputIdA = 'custom-segment-file-input-a';
    // Segment B (optional)
    const [segmentBSubscribers, setSegmentBSubscribers] = useState<ProcessedSubscriber[]>([]);
    const [segmentBName, setSegmentBName] = useState<string>('');
    const [fileNameB, setFileNameB] = useState<string>('');
    const [errorB, setErrorB] = useState<string>('');
    const fileInputIdB = 'custom-segment-file-input-b';

    const parseCsvInto = (
        file: File,
        setters: {
            setSubs: (v: ProcessedSubscriber[]) => void;
            setName: (v: string) => void;
            setError: (v: string) => void;
            setFileName: (v: string) => void;
        }
    ) => {
        const { setSubs, setName, setError, setFileName } = setters;
        setFileName(file.name);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const transformer = new SubscriberTransformer();
                    const processed = transformer.transform(results.data as any);
                    setSubs(processed);
                    setName(file.name.replace(/\.csv$/i, ''));
                    setError('');
                } catch (err) {
                    setError('Failed to parse segment CSV. Please check the format.');
                }
            },
            error: () => setError('Failed to read CSV file.'),
        });
    };

    // Helpers and formatting
    const now = useMemo(() => new Date(), []);
    const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time', []);
    const formatCurrency2 = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatPercent1 = (value: number) => `${value.toFixed(1)}%`;

    type WindowStat = { count: number; pct: number };
    type SegmentStats = {
        totalRevenue: number;
        members: number;
        aov: number; // totalRevenue / totalOrders
        revenuePerMember: number; // totalRevenue / members
        ordersPerMember: number; // totalOrders / members
        buyers: number;
        totalOrders: number;
        predictedLtvIncrease: number;
        averageDaysBetweenOrders: number;
        created: Record<number, WindowStat>; // days -> {count,pct}
        engaged: Record<number, WindowStat>; // days -> {count,pct}
        nonSuppressed: WindowStat; // pct uses members
        neverActive: WindowStat; // pct uses members
        emailStatus: {
            unsubscribedPct: number;
            spamPct: number;
            userSuppressedPct: number;
            optInPct: number;
        };
    };

    const computeStats = (subs: ProcessedSubscriber[]): SegmentStats => {
        const members = subs.length;
        const sum = (arr: any[], get: (t: any) => number) => arr.reduce((acc, t) => acc + (get(t) || 0), 0);
        const totalRevenue = sum(subs, s => (s.historicClv ?? s.totalClv) || 0);
        const totalOrders = sum(subs, s => s.totalOrders || 0);
        const buyers = subs.filter(s => s.isBuyer).length;
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerMember = members > 0 ? totalRevenue / members : 0;
        const ordersPerMember = members > 0 ? totalOrders / members : 0;
        const predictedLtvIncrease = sum(subs, s => s.predictedClv || 0);

        const avgDaysValues = subs.map(s => (s.avgDaysBetweenOrders ?? null)).filter((v): v is number => v !== null && !isNaN(v));
        const averageDaysBetweenOrders = avgDaysValues.length > 0 ? avgDaysValues.reduce((a, b) => a + b, 0) / avgDaysValues.length : 0;

        const percentage = (count: number, denom: number) => (denom > 0 ? (count / denom) * 100 : 0);
        const withinDaysCreated = (days: number) =>
            subs.filter(s => {
                const created = s.profileCreated instanceof Date ? s.profileCreated : null;
                if (!created) return false;
                const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
                return created.getTime() >= start.getTime() && created.getTime() <= now.getTime();
            }).length;
        const withinDaysEngaged = (days: number) =>
            subs.filter(s => {
                const lastOpen = s.lastOpen instanceof Date ? s.lastOpen : null;
                const lastClick = s.lastClick instanceof Date ? s.lastClick : null;
                const activity = lastOpen && lastClick ? (lastOpen.getTime() > lastClick.getTime() ? lastOpen : lastClick) : (lastOpen || lastClick);
                if (!activity) return false;
                const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
                return activity.getTime() >= start.getTime() && activity.getTime() <= now.getTime();
            }).length;

        const createdDays = [30, 60, 90, 180] as const;
        const engagedDays = [30, 90, 120, 180] as const;

        const created: Record<number, WindowStat> = {};
        createdDays.forEach(d => { const c = withinDaysCreated(d); created[d] = { count: c, pct: percentage(c, members) }; });
        const engaged: Record<number, WindowStat> = {};
        engagedDays.forEach(d => { const c = withinDaysEngaged(d); engaged[d] = { count: c, pct: percentage(c, members) }; });

        const nonSuppressedCount = subs.filter(s => s.canReceiveEmail === true).length;
        const neverActiveCount = subs.filter(s => !s.firstActiveRaw && !s.lastActive).length;

        const hasAnySuppression = (s: ProcessedSubscriber, tokens: string[]) => {
            const list = (s.emailSuppressions || []).map(t => t.toUpperCase());
            return tokens.some(t => list.includes(t));
        };
        const unsubTokens = ['UNSUBSCRIBE', 'UNSUBSCRIBED', 'GLOBAL_UNSUBSCRIBE'];
        const spamTokens = ['SPAM_COMPLAINT', 'MARKED_AS_SPAM', 'SPAM'];
        const userSuppTokens = ['USER_SUPPRESSED', 'SUPPRESSED', 'MANUAL_SUPPRESSION'];
        const unsubCount = subs.filter(s => hasAnySuppression(s, unsubTokens)).length;
        const spamCount = subs.filter(s => hasAnySuppression(s, spamTokens)).length;
        const userSuppCount = subs.filter(s => hasAnySuppression(s, userSuppTokens)).length;
        const optInCount = subs.filter(s => (s.emailConsentRaw || '').toUpperCase().trim() !== 'NEVER_SUBSCRIBED').length;

        return {
            totalRevenue,
            members,
            aov,
            revenuePerMember,
            ordersPerMember,
            buyers,
            totalOrders,
            predictedLtvIncrease,
            averageDaysBetweenOrders,
            created,
            engaged,
            nonSuppressed: { count: nonSuppressedCount, pct: percentage(nonSuppressedCount, members) },
            neverActive: { count: neverActiveCount, pct: percentage(neverActiveCount, members) },
            emailStatus: {
                unsubscribedPct: percentage(unsubCount, members),
                spamPct: percentage(spamCount, members),
                userSuppressedPct: percentage(userSuppCount, members),
                optInPct: percentage(optInCount, members),
            },
        };
    };

    // Created absolute date range filter (account timezone - using local browser timezone here)
    const [createdFrom, setCreatedFrom] = useState<string>(''); // YYYY-MM-DD
    const [createdTo, setCreatedTo] = useState<string>('');     // YYYY-MM-DD

    const parseBoundary = (d: string | undefined | null, endOfDay = false): Date | null => {
        if (!d) return null;
        // Interpret the date as local timezone midnight/start or end of day
        const [y, m, day] = d.split('-').map(Number);
        if (!y || !m || !day) return null;
        if (endOfDay) {
            return new Date(y, m - 1, day, 23, 59, 59, 999);
        }
        return new Date(y, m - 1, day, 0, 0, 0, 0);
    };

    const filterByCreatedRange = (subs: ProcessedSubscriber[]): ProcessedSubscriber[] => {
        const fromDate = parseBoundary(createdFrom, false);
        const toDate = parseBoundary(createdTo, true);
        if (!fromDate && !toDate) return subs;
        return subs.filter(s => {
            const created = s.profileCreated instanceof Date ? s.profileCreated : null;
            if (!created) return false;
            if (fromDate && created < fromDate) return false;
            if (toDate && created > toDate) return false;
            return true;
        });
    };

    const filteredA = useMemo(() => filterByCreatedRange(segmentASubscribers), [segmentASubscribers, createdFrom, createdTo]);
    const filteredB = useMemo(() => filterByCreatedRange(segmentBSubscribers), [segmentBSubscribers, createdFrom, createdTo]);

    const statsA = useMemo(() => (filteredA.length ? computeStats(filteredA) : null), [filteredA]);
    const statsB = useMemo(() => (filteredB.length ? computeStats(filteredB) : null), [filteredB]);

    const relativeDeltaText = (a: number, b: number): { text: string; value?: number; isNA: boolean } => {
        if (a === 0) {
            if (b === 0) return { text: '—', isNA: true };
            return { text: 'N/A (no baseline)', isNA: true };
        }
        const v = ((b - a) / a) * 100;
        return { text: formatPercent1(v), value: v, isNA: false };
    };

    const deltaColor = (value: number | undefined, favorableWhenHigher: boolean): string => {
        if (value === undefined || Math.abs(value) < 1e-12) return 'text-gray-500 dark:text-gray-400';
        const positive = value > 0;
        const favorable = favorableWhenHigher ? positive : !positive;
        return favorable ? 'text-emerald-600' : 'text-rose-600';
    };

    const cardBase = `bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6`;
    const labelClass = `text-sm font-medium text-gray-500 dark:text-gray-400`;
    const valueClass = `text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums`;
    const deltaClass = `text-sm font-semibold tabular-nums`;

    const renderSingleCards = (s: SegmentStats) => (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className={cardBase} title="Sum of Historic Customer Lifetime Value for all members in the segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Total Revenue</p></div>
                    <p className={valueClass}>{formatCurrency2(s.totalRevenue)}</p>
                </div>
                <div className={cardBase} title="Total number of profiles in the uploaded segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Members</p></div>
                    <p className={valueClass}>{s.members.toLocaleString()}</p>
                </div>
                <div className={cardBase} title="Average Order Value across all orders in this segment (Total Revenue / Total Orders)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>AOV</p></div>
                    <p className={valueClass}>{formatCurrency2(s.aov)}</p>
                </div>
                <div className={cardBase} title="Average revenue contributed by each member (Total Revenue / Members)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Revenue per Member</p></div>
                    <p className={valueClass}>{formatCurrency2(s.revenuePerMember)}</p>
                </div>
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Created</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 60, 90, 180].map(days => (
                    <div key={`created-${days}`} className={cardBase} title={`Profiles created in the last ${days} days (anchored to today)`}>
                        <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Created in last {days} days</p></div>
                        <p className={valueClass}>{s.created[days].count.toLocaleString()} ({formatPercent1(s.created[days].pct)})</p>
                    </div>
                ))}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Engaged</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 90, 120, 180].map(days => (
                    <div key={`engaged-${days}`} className={cardBase} title={`Profiles with an email open or click in the last ${days} days (anchored to today)`}>
                        <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Engaged in last {days} days</p></div>
                        <p className={valueClass}>{s.engaged[days].count.toLocaleString()} ({formatPercent1(s.engaged[days].pct)})</p>
                    </div>
                ))}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Additional Metrics</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className={cardBase} title="Sum of Predicted Customer Lifetime Value for all profiles in this segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Predicted LTV Increase</p></div>
                    <p className={valueClass}>{formatCurrency2(s.predictedLtvIncrease)}</p>
                </div>
                <div className={cardBase} title="Average of the CSV column 'Average Days Between Orders' across profiles that have a value">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Average Days Between Orders</p></div>
                    <p className={valueClass}>{s.averageDaysBetweenOrders.toFixed(1)}</p>
                </div>
                <div className={cardBase} title="Email Suppressions equal to [] (consent ignored)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Non‑Suppressed</p></div>
                    <p className={valueClass}>{s.nonSuppressed.count.toLocaleString()} ({formatPercent1(s.nonSuppressed.pct)})</p>
                </div>
                <div className={cardBase} title="Profiles with no First Active and no Last Active dates">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Never Active</p></div>
                    <p className={valueClass}>{s.neverActive.count.toLocaleString()} ({formatPercent1(s.neverActive.pct)})</p>
                </div>
                <div className={cardBase} title="Profiles that have placed at least one order (from CSV isBuyer flag)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Buyer Count</p></div>
                    <p className={valueClass}>{s.buyers.toLocaleString()}</p>
                </div>
                <div className={cardBase} title="Sum of total orders across profiles in this segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Total Orders</p></div>
                    <p className={valueClass}>{s.totalOrders.toLocaleString()}</p>
                </div>
                <div className={cardBase} title="Average number of orders per member (Total Orders / Members)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Avg Orders per Member</p></div>
                    <p className={valueClass}>{s.ordersPerMember.toFixed(2)}</p>
                </div>
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Email Status</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={cardBase} title="Email Suppressions contains UNSUBSCRIBE/UNSUBSCRIBED/GLOBAL_UNSUBSCRIBE">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Unsubscribed</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.unsubscribedPct)}</p>
                </div>
                <div className={cardBase} title="Email Suppressions contains SPAM_COMPLAINT/MARKED_AS_SPAM/SPAM">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Spam Complaint</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.spamPct)}</p>
                </div>
                <div className={cardBase} title="Email Suppressions contains USER_SUPPRESSED/SUPPRESSED/MANUAL_SUPPRESSION">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% User Suppressed</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.userSuppressedPct)}</p>
                </div>
                <div className={cardBase} title="Percentage with Email Marketing Consent not equal to 'NEVER_SUBSCRIBED'">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Opt‑in Rate</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.optInPct)}</p>
                </div>
            </div>
        </>
    );

    const renderCompareRow = (label: string, title: string, aText: string, bText: string, delta: { text: string; value?: number; isNA: boolean }, favorableWhenHigher: boolean) => {
        const bTintClass = !delta.isNA && delta.value !== undefined && Math.abs(delta.value) > 1e-12
            ? deltaColor(delta.value, favorableWhenHigher)
            : '';
        const deltaTintClass = delta.isNA ? 'text-gray-500 dark:text-gray-400' : deltaColor(delta.value, favorableWhenHigher);
        return (
            <div className={cardBase} title={title}>
                <div className="flex items-center gap-3 mb-2"><p className={labelClass}>{label}</p></div>
                <div className={`${valueClass}`}><span className="text-xs font-medium text-gray-500 mr-2">A:</span>{aText}</div>
                <div className={`flex items-baseline justify-between ${valueClass} ${bTintClass}`}>
                    <div><span className="text-xs font-medium text-gray-500 mr-2">B:</span>{bText}</div>
                    <div className={`${deltaClass} ${deltaTintClass}`}>{delta.text}</div>
                </div>
            </div>
        );
    };

    const renderCompare = (a: SegmentStats, b: SegmentStats) => (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {renderCompareRow(
                    'Total Revenue',
                    'Sum of Historic Customer Lifetime Value for all members in the segment',
                    formatCurrency2(a.totalRevenue),
                    formatCurrency2(b.totalRevenue),
                    relativeDeltaText(a.totalRevenue, b.totalRevenue),
                    true
                )}
                {renderCompareRow(
                    'Members',
                    'Total number of profiles in the uploaded segment',
                    a.members.toLocaleString(),
                    b.members.toLocaleString(),
                    relativeDeltaText(a.members, b.members),
                    true
                )}
                {renderCompareRow(
                    'AOV',
                    'Average Order Value across all orders in this segment (Total Revenue / Total Orders)',
                    formatCurrency2(a.aov),
                    formatCurrency2(b.aov),
                    relativeDeltaText(a.aov, b.aov),
                    true
                )}
                {renderCompareRow(
                    'Revenue per Member',
                    'Average revenue contributed by each member (Total Revenue / Members)',
                    formatCurrency2(a.revenuePerMember),
                    formatCurrency2(b.revenuePerMember),
                    relativeDeltaText(a.revenuePerMember, b.revenuePerMember),
                    true
                )}
                {renderCompareRow(
                    'Avg Orders per Member',
                    'Average number of orders per member (Total Orders / Members)',
                    a.ordersPerMember.toFixed(2),
                    b.ordersPerMember.toFixed(2),
                    relativeDeltaText(a.ordersPerMember, b.ordersPerMember),
                    true
                )}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Created</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 60, 90, 180].map(days => (
                    renderCompareRow(
                        `Created in last ${days} days`,
                        `Profiles created in the last ${days} days (anchored to today)`,
                        `${a.created[days].count.toLocaleString()} (${formatPercent1(a.created[days].pct)})`,
                        `${b.created[days].count.toLocaleString()} (${formatPercent1(b.created[days].pct)})`,
                        relativeDeltaText(a.created[days].pct, b.created[days].pct),
                        true
                    )
                ))}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Engaged</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 90, 120, 180].map(days => (
                    renderCompareRow(
                        `Engaged in last ${days} days`,
                        `Profiles with an email open or click in the last ${days} days (anchored to today)`,
                        `${a.engaged[days].count.toLocaleString()} (${formatPercent1(a.engaged[days].pct)})`,
                        `${b.engaged[days].count.toLocaleString()} (${formatPercent1(b.engaged[days].pct)})`,
                        relativeDeltaText(a.engaged[days].pct, b.engaged[days].pct),
                        true
                    )
                ))}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Additional Metrics</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {renderCompareRow(
                    'Predicted LTV Increase',
                    'Sum of Predicted Customer Lifetime Value for all profiles in this segment',
                    formatCurrency2(a.predictedLtvIncrease),
                    formatCurrency2(b.predictedLtvIncrease),
                    relativeDeltaText(a.predictedLtvIncrease, b.predictedLtvIncrease),
                    true
                )}
                {renderCompareRow(
                    'Average Days Between Orders',
                    "Average of the CSV column 'Average Days Between Orders' across profiles that have a value",
                    a.averageDaysBetweenOrders.toFixed(1),
                    b.averageDaysBetweenOrders.toFixed(1),
                    relativeDeltaText(a.averageDaysBetweenOrders, b.averageDaysBetweenOrders),
                    false // lower is better
                )}
                {renderCompareRow(
                    'Non‑Suppressed',
                    'Email Suppressions equal to [] (consent ignored)',
                    `${a.nonSuppressed.count.toLocaleString()} (${formatPercent1(a.nonSuppressed.pct)})`,
                    `${b.nonSuppressed.count.toLocaleString()} (${formatPercent1(b.nonSuppressed.pct)})`,
                    relativeDeltaText(a.nonSuppressed.pct, b.nonSuppressed.pct),
                    true
                )}
                {renderCompareRow(
                    'Never Active',
                    'Profiles with no First Active and no Last Active dates',
                    `${a.neverActive.count.toLocaleString()} (${formatPercent1(a.neverActive.pct)})`,
                    `${b.neverActive.count.toLocaleString()} (${formatPercent1(b.neverActive.pct)})`,
                    relativeDeltaText(a.neverActive.pct, b.neverActive.pct),
                    true
                )}
                {renderCompareRow(
                    'Buyer Count',
                    'Profiles that have placed at least one order (from CSV isBuyer flag)',
                    a.buyers.toLocaleString(),
                    b.buyers.toLocaleString(),
                    relativeDeltaText(a.buyers, b.buyers),
                    true
                )}
                {renderCompareRow(
                    'Total Orders',
                    'Sum of total orders across profiles in this segment',
                    a.totalOrders.toLocaleString(),
                    b.totalOrders.toLocaleString(),
                    relativeDeltaText(a.totalOrders, b.totalOrders),
                    true
                )}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Email Status</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {renderCompareRow(
                    '% Unsubscribed',
                    'Email Suppressions contains UNSUBSCRIBE/UNSUBSCRIBED/GLOBAL_UNSUBSCRIBE',
                    formatPercent1(a.emailStatus.unsubscribedPct),
                    formatPercent1(b.emailStatus.unsubscribedPct),
                    relativeDeltaText(a.emailStatus.unsubscribedPct, b.emailStatus.unsubscribedPct),
                    false // lower is better
                )}
                {renderCompareRow(
                    '% Spam Complaint',
                    'Email Suppressions contains SPAM_COMPLAINT/MARKED_AS_SPAM/SPAM',
                    formatPercent1(a.emailStatus.spamPct),
                    formatPercent1(b.emailStatus.spamPct),
                    relativeDeltaText(a.emailStatus.spamPct, b.emailStatus.spamPct),
                    false // lower is better
                )}
                {renderCompareRow(
                    '% User Suppressed',
                    'Email Suppressions contains USER_SUPPRESSED/SUPPRESSED/MANUAL_SUPPRESSION',
                    formatPercent1(a.emailStatus.userSuppressedPct),
                    formatPercent1(b.emailStatus.userSuppressedPct),
                    relativeDeltaText(a.emailStatus.userSuppressedPct, b.emailStatus.userSuppressedPct),
                    false // lower is better
                )}
                {renderCompareRow(
                    '% Opt‑in Rate',
                    "Percentage with Email Marketing Consent not equal to 'NEVER_SUBSCRIBED'",
                    formatPercent1(a.emailStatus.optInPct),
                    formatPercent1(b.emailStatus.optInPct),
                    relativeDeltaText(a.emailStatus.optInPct, b.emailStatus.optInPct),
                    true
                )}
            </div>
        </>
    );

    const hasA = segmentASubscribers.length > 0;
    const hasB = segmentBSubscribers.length > 0;

    return (
        <div className="mt-8">
            <div className="flex items-center gap-3 mb-4">
                <UploadCloud className="w-6 h-6 text-purple-600" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analyze Custom Segment</h2>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 mb-8 hover:shadow-xl transition-all duration-200">
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                    Upload one or two subscriber CSVs to analyze growth, engagement recency, deliverability, opt‑in rate, and revenue indicators such as Predicted LTV and AOV. With two uploads, Segment B is compared to Segment A.
                </p>
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Filter by Created date</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Timezone: {timezone}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">From</label>
                            <input type="date" value={createdFrom} onChange={e => setCreatedFrom(e.target.value)} className="h-9 px-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">To</label>
                            <input type="date" value={createdTo} onChange={e => setCreatedTo(e.target.value)} className="h-9 px-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => { setCreatedFrom(''); setCreatedTo(''); }} className="h-9 px-3 rounded-lg text-sm font-medium border bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700">
                                Clear
                            </button>
                            <div className="text-xs text-gray-500 dark:text-gray-400 self-center">Applies to both segments and all metrics</div>
                        </div>
                    </div>
                </div>
                <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Segment A</label>
                        <div className="flex items-center gap-3 flex-wrap">
                            <label htmlFor={fileInputIdA} className="inline-flex items-center px-3 py-2 rounded-lg cursor-pointer border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:border-purple-500" title="Choose a CSV file">
                                Choose File
                            </label>
                            <input id={fileInputIdA} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseCsvInto(f, { setSubs: setSegmentASubscribers, setName: setSegmentAName, setError: setErrorA, setFileName: setFileNameA }); }} />
                            {fileNameA && (<div className="text-sm text-gray-700 dark:text-gray-300 break-all flex-1 min-w-0">{fileNameA}</div>)}
                            {fileNameA && (
                                <button type="button" onClick={() => { setSegmentASubscribers([]); setSegmentAName(''); setFileNameA(''); setErrorA(''); const input = document.getElementById(fileInputIdA) as HTMLInputElement | null; if (input) input.value = ''; }} className="ml-auto px-3 py-2 rounded-lg text-sm font-medium border bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700" title="Reset Segment A">
                                    Reset
                                </button>
                            )}
                        </div>
                        {hasA && (
                            <input value={segmentAName} onChange={e => setSegmentAName(e.target.value)} placeholder="Segment A label" className="h-9 px-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        )}
                        {errorA && <div className="text-red-500 text-sm">{errorA}</div>}
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Segment B (optional)</label>
                        <div className="flex items-center gap-3 flex-wrap">
                            <label htmlFor={fileInputIdB} className="inline-flex items-center px-3 py-2 rounded-lg cursor-pointer border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:border-purple-500" title="Choose a CSV file">
                                Choose File
                            </label>
                            <input id={fileInputIdB} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseCsvInto(f, { setSubs: setSegmentBSubscribers, setName: setSegmentBName, setError: setErrorB, setFileName: setFileNameB }); }} />
                            {fileNameB && (<div className="text-sm text-gray-700 dark:text-gray-300 break-all flex-1 min-w-0">{fileNameB}</div>)}
                            {fileNameB && (
                                <button type="button" onClick={() => { setSegmentBSubscribers([]); setSegmentBName(''); setFileNameB(''); setErrorB(''); const input = document.getElementById(fileInputIdB) as HTMLInputElement | null; if (input) input.value = ''; }} className="ml-auto px-3 py-2 rounded-lg text-sm font-medium border bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700" title="Reset Segment B">
                                    Reset
                                </button>
                            )}
                        </div>
                        {hasB && (
                            <input value={segmentBName} onChange={e => setSegmentBName(e.target.value)} placeholder="Segment B label" className="h-9 px-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        )}
                        {errorB && <div className="text-red-500 text-sm">{errorB}</div>}
                    </div>
                </div>

                {hasA && !hasB && statsA && (
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <ListChecks className="w-5 h-5 text-purple-600" />
                            <span className="text-lg font-semibold break-all text-gray-900 dark:text-gray-100">{segmentAName || fileNameA}</span>
                        </div>
                        {renderSingleCards(statsA)}
                    </div>
                )}

                {hasA && hasB && statsA && statsB && (
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <ListChecks className="w-5 h-5 text-purple-600" />
                            <span className="text-lg font-semibold break-all text-gray-900 dark:text-gray-100">Compare: {segmentAName || fileNameA} vs {segmentBName || fileNameB}</span>
                        </div>
                        {renderCompare(statsA, statsB)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomSegmentBlock;
