"use client";
import React, { useMemo, useState } from 'react';
import { UploadCloud, ListChecks, Info, CalendarRange } from 'lucide-react';
import Papa from 'papaparse';
import { ProcessedSubscriber } from '../../lib/data/dataTypes';
import { SubscriberTransformer } from '../../lib/data/transformers/subscriberTransformer';

type Props = {
    dateRange?: '30d' | '60d' | '90d' | '120d' | '180d' | '365d' | 'all' | 'custom';
    customFrom?: string; // YYYY-MM-DD
    customTo?: string;   // YYYY-MM-DD
    referenceDate?: Date; // anchor for presets; falls back to now
};

const CustomSegmentBlock: React.FC<Props> = ({ dateRange = 'all', customFrom, customTo, referenceDate }) => {
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
    // Anchor "now" to the provided referenceDate (from main dashboard) when available
    const now = useMemo(() => (referenceDate ? new Date(referenceDate) : new Date()), [referenceDate]);
    const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time', []);
    const formatCurrency2 = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatPercent1 = (value: number) => `${value.toFixed(1)}%`;
    // Delta percent formatting: keep 1 decimal up to 99.9%; at >= 100% drop decimals and add grouping (e.g., 1,234%)
    const formatDeltaPercent = (value: number) => {
        const abs = Math.abs(value);
        if (abs >= 100) {
            const rounded = Math.round(value);
            return `${rounded.toLocaleString()}%`;
        }
        return `${value.toFixed(1)}%`;
    };

    type WindowStat = { count: number; pct: number };
    type SegmentStats = {
        totalRevenue: number;
        members: number;
        aov: number; // totalRevenue / totalOrders
        revenuePerMember: number; // totalRevenue / members
        ordersPerMember: number; // totalOrders / members
        buyers: number;
        buyersPct: number;
        repeatBuyers: number;
        repeatBuyersPct: number;
        totalOrders: number;
        predictedLtvIncrease: number;
        averageDaysBetweenOrders: number;
        ltvRepeatBuyerAvg: number;
        created: Record<number, WindowStat>; // days -> {count,pct}
        engaged: Record<number, WindowStat>; // days -> {count,pct}
        nonSuppressed: WindowStat; // pct uses members
        neverActive: WindowStat; // pct uses members
        emailStatus: {
            optInPct: number; // SUBSCRIBED
            notSubscribedPct: number; // consent != SUBSCRIBED
            spamPct: number;
            userSuppressedPct: number;
        };
    };

    const computeStats = (subs: ProcessedSubscriber[]): SegmentStats => {
        const members = subs.length;
        const sum = (arr: any[], get: (t: any) => number) => arr.reduce((acc, t) => acc + (get(t) || 0), 0);
        const totalRevenue = sum(subs, s => (s.historicClv ?? s.totalClv) || 0);
        const totalOrders = sum(subs, s => s.totalOrders || 0);
        const buyers = subs.filter(s => s.isBuyer).length;
        const repeatBuyers = subs.filter(s => (s.totalOrders || 0) >= 2).length;
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerMember = members > 0 ? totalRevenue / members : 0;
        const ordersPerMember = members > 0 ? totalOrders / members : 0;
        const predictedLtvIncrease = sum(subs, s => s.predictedClv || 0);
        const buyersPct = members > 0 ? (buyers / members) * 100 : 0;
        const repeatBuyersPct = members > 0 ? (repeatBuyers / members) * 100 : 0;
        const ltvRepeatBuyerAvg = (() => {
            const repeats = subs.filter(s => (s.totalOrders || 0) >= 2);
            if (!repeats.length) return 0;
            const total = sum(repeats, s => (s.historicClv ?? s.totalClv) || 0);
            return total / repeats.length;
        })();

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

        const createdDays = [30, 60, 90, 120] as const;
        const engagedDays = [30, 60, 90, 120] as const;

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
        const spamCount = subs.filter(s => hasAnySuppression(s, spamTokens)).length;
        const userSuppCount = subs.filter(s => hasAnySuppression(s, userSuppTokens)).length;
        // Consent metrics
        const consent = (s: ProcessedSubscriber) => (s.emailConsentRaw || '').toUpperCase().trim();
        const optInCount = subs.filter(s => consent(s) === 'SUBSCRIBED').length;
        const notSubscribedCount = members - optInCount;

        return {
            totalRevenue,
            members,
            aov,
            revenuePerMember,
            ordersPerMember,
            buyers,
            buyersPct,
            repeatBuyers,
            repeatBuyersPct,
            totalOrders,
            predictedLtvIncrease,
            averageDaysBetweenOrders,
            ltvRepeatBuyerAvg,
            created,
            engaged,
            nonSuppressed: { count: nonSuppressedCount, pct: percentage(nonSuppressedCount, members) },
            neverActive: { count: neverActiveCount, pct: percentage(neverActiveCount, members) },
            emailStatus: {
                optInPct: percentage(optInCount, members),
                notSubscribedPct: percentage(notSubscribedCount, members),
                spamPct: percentage(spamCount, members),
                userSuppressedPct: percentage(userSuppCount, members),
            },
        };
    };

    // Created date filter derived from main date selector (props)
    const parseBoundary = (d: string | undefined | null, endOfDay = false): Date | null => {
        if (!d) return null;
        const [y, m, day] = d.split('-').map(Number);
        if (!y || !m || !day) return null;
        return new Date(y, m - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    };
    const computeFromToForPreset = useMemo(() => {
        if (dateRange === 'custom' && customFrom && customTo) {
            return { from: parseBoundary(customFrom, false), to: parseBoundary(customTo, true) };
        }
        if (dateRange === 'all') return { from: null as Date | null, to: null as Date | null };
        const days = typeof dateRange === 'string' && /\d+d/.test(dateRange) ? parseInt(dateRange.replace('d', '')) : 0;
        if (!days) return { from: null as Date | null, to: null as Date | null };
        const anchor = referenceDate ? new Date(referenceDate) : new Date();
        const to = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 23, 59, 59, 999);
        const from = new Date(to);
        from.setDate(from.getDate() - days + 1);
        from.setHours(0, 0, 0, 0);
        return { from, to };
    }, [dateRange, customFrom, customTo, referenceDate]);

    const filterByCreatedRange = (subs: ProcessedSubscriber[]): ProcessedSubscriber[] => {
        const fromDate = computeFromToForPreset.from;
        const toDate = computeFromToForPreset.to;
        if (!fromDate && !toDate) return subs;
        return subs.filter(s => {
            const created = s.profileCreated instanceof Date ? s.profileCreated : null;
            if (!created) return false;
            if (fromDate && created < fromDate) return false;
            if (toDate && created > toDate) return false;
            return true;
        });
    };

    const filteredA = useMemo(() => filterByCreatedRange(segmentASubscribers), [segmentASubscribers, computeFromToForPreset]);
    const filteredB = useMemo(() => filterByCreatedRange(segmentBSubscribers), [segmentBSubscribers, computeFromToForPreset]);

    const statsA = useMemo(() => (filteredA.length ? computeStats(filteredA) : null), [filteredA]);
    const statsB = useMemo(() => (filteredB.length ? computeStats(filteredB) : null), [filteredB]);

    // Compute created_at coverage for uploaded segments and detect if selected filter window is entirely outside
    const dateFmt = (d: Date | null) => d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : 'N/A';
    const createdSpan = (subs: ProcessedSubscriber[]) => {
        const dates = subs.map(s => (s.profileCreated instanceof Date ? s.profileCreated : null)).filter((d): d is Date => !!d);
        if (dates.length === 0) return { min: null as Date | null, max: null as Date | null };
        const min = new Date(Math.min(...dates.map(d => d.getTime())));
        const max = new Date(Math.max(...dates.map(d => d.getTime())));
        return { min, max };
    };
    const spanA = useMemo(() => createdSpan(segmentASubscribers), [segmentASubscribers]);
    const spanB = useMemo(() => createdSpan(segmentBSubscribers), [segmentBSubscribers]);
    const winFrom = computeFromToForPreset.from;
    const winTo = computeFromToForPreset.to;
    // "Outside" when both bounds exist and the entire selected window doesn't intersect the created range at all
    const outsideA = useMemo(() => {
        if (!spanA.min || !spanA.max || !winFrom || !winTo) return false;
        return (winTo < spanA.min) || (winFrom > spanA.max);
    }, [spanA, winFrom, winTo]);
    const outsideB = useMemo(() => {
        if (!spanB.min || !spanB.max || !winFrom || !winTo) return false;
        return (winTo < spanB.min) || (winFrom > spanB.max);
    }, [spanB, winFrom, winTo]);

    const relativeDeltaText = (a: number, b: number): { text: string; value?: number; isNA: boolean } => {
        if (a === 0) {
            if (b === 0) return { text: '—', isNA: true };
            return { text: 'N/A (no baseline)', isNA: true };
        }
        const v = ((b - a) / a) * 100;
        return { text: formatDeltaPercent(v), value: v, isNA: false };
    };

    const deltaColor = (value: number | undefined, favorableWhenHigher: boolean): string => {
        if (value === undefined || Math.abs(value) < 1e-12) return 'text-gray-500 dark:text-gray-400';
        const positive = value > 0;
        const favorable = favorableWhenHigher ? positive : !positive;
        // Improve dark-mode contrast for positive/negative tints
        return favorable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    };

    const cardBase = `bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6`;
    const labelClass = `text-sm font-medium text-gray-500 dark:text-gray-400`;
    const valueClass = `text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums`;
    const compareValueClass = `text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums`;
    const deltaClass = `text-sm font-semibold tabular-nums`;

    const renderSingleCards = (s: SegmentStats) => (
        <>
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Revenue & Value</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className={cardBase} title="Sum of Historic Customer Lifetime Value for all members in the segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Total Revenue</p></div>
                    <p className={valueClass}>{formatCurrency2(s.totalRevenue)}</p>
                </div>
                <div className={cardBase} title="Average Order Value across all orders in this segment (Total Revenue / Total Orders)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>AOV</p></div>
                    <p className={valueClass}>{formatCurrency2(s.aov)}</p>
                </div>
                <div className={cardBase} title="Average revenue contributed by each member (Total Revenue / Members)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Revenue per Member</p></div>
                    <p className={valueClass}>{formatCurrency2(s.revenuePerMember)}</p>
                </div>
                <div className={cardBase} title="Sum of Predicted Customer Lifetime Value for all profiles in this segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Predicted LTV Increase</p></div>
                    <p className={valueClass}>{formatCurrency2(s.predictedLtvIncrease)}</p>
                </div>
            </div>

            {/* Row 2: Customer Base */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer Base</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className={cardBase} title="Total number of profiles in the uploaded segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Members</p></div>
                    <p className={valueClass}>{s.members.toLocaleString()}</p>
                </div>
                <div className={cardBase} title="Profiles that have placed at least one order (from CSV isBuyer flag)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Buyer Count</p></div>
                    <p className={valueClass}>{s.buyers.toLocaleString()}</p>
                </div>
                <div className={cardBase} title="Buyers / Members">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Buyers</p></div>
                    <p className={valueClass}>{formatPercent1(s.buyersPct)}</p>
                </div>
                <div className={cardBase} title="Members with 2+ orders / Members">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Repeat Buyers</p></div>
                    <p className={valueClass}>{formatPercent1(s.repeatBuyersPct)}</p>
                </div>
            </div>

            {/* Row 3: Order Behavior */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Order Behavior</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className={cardBase} title="Sum of total orders across profiles in this segment">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Total Orders</p></div>
                    <p className={valueClass}>{s.totalOrders.toLocaleString()}</p>
                </div>
                <div className={cardBase} title="Average number of orders per member (Total Orders / Members)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Avg Orders per Member</p></div>
                    <p className={valueClass}>{s.ordersPerMember.toFixed(2)}</p>
                </div>
                <div className={cardBase} title="Average of the CSV column 'Average Days Between Orders' across profiles that have a value">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Average Days Between Orders</p></div>
                    <p className={valueClass}>{s.averageDaysBetweenOrders.toFixed(1)}</p>
                </div>
                <div className={cardBase} title="Average lifetime revenue among repeat buyers (2+ orders)">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>LTV (Repeat Buyers)</p></div>
                    <p className={valueClass}>{formatCurrency2(s.ltvRepeatBuyerAvg)}</p>
                </div>
            </div>

            {/* Row 4: Acquisition – New Profiles Created */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Acquisition</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 60, 90, 120].map(days => (
                    <div key={`created-${days}`} className={cardBase} title={`Profiles created in the last ${days} days (anchored to selected date)`}>
                        <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Created in last {days} days</p></div>
                        <p className={valueClass}>{s.created[days].count.toLocaleString()} ({formatPercent1(s.created[days].pct)})</p>
                    </div>
                ))}
            </div>

            {/* Row 5: Engagement – Recency Buckets */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Engagement</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 60, 90, 120].map(days => (
                    <div key={`engaged-${days}`} className={cardBase} title={`Profiles with an email open or click in the last ${days} days (anchored to selected date)`}>
                        <div className="flex items-center gap-3 mb-2"><p className={labelClass}>Engaged in last {days} days</p></div>
                        <p className={valueClass}>{s.engaged[days].count.toLocaleString()} ({formatPercent1(s.engaged[days].pct)})</p>
                    </div>
                ))}
            </div>

            {/* Row 6: Deliverability & List Health */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Deliverability & List Health</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={cardBase} title="Percentage of profiles with Email Marketing Consent = SUBSCRIBED">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Opt‑in Rate</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.optInPct)}</p>
                </div>
                <div className={cardBase} title="Profiles that have Email Marketing Consent other than SUBSCRIBED">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Not Subscribed</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.notSubscribedPct)}</p>
                </div>
                <div className={cardBase} title="Email Suppressions contains SPAM_COMPLAINT/MARKED_AS_SPAM/SPAM">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% Spam Complaint</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.spamPct)}</p>
                </div>
                <div className={cardBase} title="Email Suppressions contains USER_SUPPRESSED/SUPPRESSED/MANUAL_SUPPRESSION">
                    <div className="flex items-center gap-3 mb-2"><p className={labelClass}>% User Suppressed</p></div>
                    <p className={valueClass}>{formatPercent1(s.emailStatus.userSuppressedPct)}</p>
                </div>
            </div>
        </>
    );

    const renderCompareRow = (label: string, title: string, aText: string, bText: string, delta: { text: string; value?: number; isNA: boolean }, favorableWhenHigher: boolean) => {
        const bTintClass = !delta.isNA && delta.value !== undefined && Math.abs(delta.value) > 1e-12
            ? `${deltaColor(delta.value, favorableWhenHigher)}`
            : '';
        const deltaTintClass = delta.isNA ? 'text-gray-500 dark:text-gray-400' : deltaColor(delta.value, favorableWhenHigher);
        return (
            <div className={cardBase} title={title}>
                <div className="flex items-center gap-3 mb-2"><p className={labelClass}>{label}</p></div>
                <div className={`${compareValueClass}`}><span className="text-xs font-medium text-gray-500 mr-2">A:</span>{aText}</div>
                <div className={`flex items-baseline justify-between ${compareValueClass}`}>
                    <div><span className="text-xs font-medium text-gray-500 mr-2">B:</span><span className={bTintClass}>{bText}</span></div>
                    <div className={`${deltaClass} ${deltaTintClass}`}>{delta.text}</div>
                </div>
            </div>
        );
    };

    const renderCompare = (a: SegmentStats, b: SegmentStats) => (
        <>
            {/* Row 1: Revenue & Value */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Revenue & Value</span></div>
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
                    'Predicted LTV Increase',
                    'Sum of Predicted Customer Lifetime Value for all profiles in this segment',
                    formatCurrency2(a.predictedLtvIncrease),
                    formatCurrency2(b.predictedLtvIncrease),
                    relativeDeltaText(a.predictedLtvIncrease, b.predictedLtvIncrease),
                    true
                )}
            </div>
            {/* Row 2: Customer Base */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer Base</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {renderCompareRow(
                    'Members',
                    'Total number of profiles in the uploaded segment',
                    a.members.toLocaleString(),
                    b.members.toLocaleString(),
                    relativeDeltaText(a.members, b.members),
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
                    '% Buyers',
                    'Buyers / Members',
                    formatPercent1(a.buyersPct),
                    formatPercent1(b.buyersPct),
                    relativeDeltaText(a.buyersPct, b.buyersPct),
                    true
                )}
                {renderCompareRow(
                    '% Repeat Buyers',
                    'Members with 2+ orders / Members',
                    formatPercent1(a.repeatBuyersPct),
                    formatPercent1(b.repeatBuyersPct),
                    relativeDeltaText(a.repeatBuyersPct, b.repeatBuyersPct),
                    true
                )}
            </div>

            {/* Row 3: Order Behavior */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Order Behavior</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {renderCompareRow(
                    'Total Orders',
                    'Sum of total orders across profiles in this segment',
                    a.totalOrders.toLocaleString(),
                    b.totalOrders.toLocaleString(),
                    relativeDeltaText(a.totalOrders, b.totalOrders),
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
                {renderCompareRow(
                    'Average Days Between Orders',
                    "Average of the CSV column 'Average Days Between Orders' across profiles that have a value",
                    a.averageDaysBetweenOrders.toFixed(1),
                    b.averageDaysBetweenOrders.toFixed(1),
                    relativeDeltaText(a.averageDaysBetweenOrders, b.averageDaysBetweenOrders),
                    false // lower is better
                )}
                {renderCompareRow(
                    'LTV (Repeat Buyers)',
                    'Average lifetime revenue among repeat buyers (2+ orders)',
                    formatCurrency2(a.ltvRepeatBuyerAvg),
                    formatCurrency2(b.ltvRepeatBuyerAvg),
                    relativeDeltaText(a.ltvRepeatBuyerAvg, b.ltvRepeatBuyerAvg),
                    true
                )}
            </div>

            {/* Row 4: Acquisition */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Acquisition</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 60, 90, 120].map(days => (
                    renderCompareRow(
                        `Created in last ${days} days`,
                        `Profiles created in the last ${days} days (anchored to selected date)`,
                        `${a.created[days].count.toLocaleString()} (${formatPercent1(a.created[days].pct)})`,
                        `${b.created[days].count.toLocaleString()} (${formatPercent1(b.created[days].pct)})`,
                        relativeDeltaText(a.created[days].pct, b.created[days].pct),
                        true
                    )
                ))}
            </div>

            {/* Row 5: Engagement */}
            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Engagement</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[30, 60, 90, 120].map(days => (
                    renderCompareRow(
                        `Engaged in last ${days} days`,
                        `Profiles with an email open or click in the last ${days} days (anchored to selected date)`,
                        `${a.engaged[days].count.toLocaleString()} (${formatPercent1(a.engaged[days].pct)})`,
                        `${b.engaged[days].count.toLocaleString()} (${formatPercent1(b.engaged[days].pct)})`,
                        relativeDeltaText(a.engaged[days].pct, b.engaged[days].pct),
                        true
                    )
                ))}
            </div>

            <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Deliverability & List Health</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {renderCompareRow(
                    '% Opt‑in Rate',
                    'Percentage of profiles with Email Marketing Consent = SUBSCRIBED',
                    formatPercent1(a.emailStatus.optInPct),
                    formatPercent1(b.emailStatus.optInPct),
                    relativeDeltaText(a.emailStatus.optInPct, b.emailStatus.optInPct),
                    true
                )}
                {renderCompareRow(
                    '% Not Subscribed',
                    'Profiles that have Email Marketing Consent other than SUBSCRIBED',
                    formatPercent1(a.emailStatus.notSubscribedPct),
                    formatPercent1(b.emailStatus.notSubscribedPct),
                    relativeDeltaText(a.emailStatus.notSubscribedPct, b.emailStatus.notSubscribedPct),
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
                {/* Created date filter is now driven by main dashboard selector; no local controls here. */}
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

                {/* Outside-of-range notices (below upload buttons, more visible as dashed cards) */}
                {(outsideA || outsideB) && (
                    <div className="mb-6 flex flex-col gap-3">
                        {outsideA && (
                            <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-6 bg-white dark:bg-gray-900 flex flex-col items-center justify-center text-center">
                                <CalendarRange className="w-10 h-10 text-gray-300 mb-3" />
                                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Selected date filter is outside the created‑at window for Segment A</h4>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Profiles were created between {dateFmt(spanA.min)} and {dateFmt(spanA.max)}.</p>
                            </div>
                        )}
                        {outsideB && (
                            <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-6 bg-white dark:bg-gray-900 flex flex-col items-center justify-center text-center">
                                <CalendarRange className="w-10 h-10 text-gray-300 mb-3" />
                                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Selected date filter is outside the created‑at window for Segment B</h4>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Profiles were created between {dateFmt(spanB.min)} and {dateFmt(spanB.max)}.</p>
                            </div>
                        )}
                    </div>
                )}

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
