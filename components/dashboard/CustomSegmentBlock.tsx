"use client";
import React, { useState } from 'react';
import { UploadCloud, ListChecks } from 'lucide-react';
import Papa from 'papaparse';
import { ProcessedSubscriber } from '../../lib/data/dataTypes';
import { SubscriberTransformer } from '../../lib/data/transformers/subscriberTransformer';

const CustomSegmentBlock: React.FC = () => {
    const [segmentSubscribers, setSegmentSubscribers] = useState<ProcessedSubscriber[]>([]);
    const [segmentName, setSegmentName] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [selectedFileName, setSelectedFileName] = useState<string>('');
    const fileInputId = 'custom-segment-file-input';

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFileName(file.name);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const transformer = new SubscriberTransformer();
                    const processed = transformer.transform(results.data as any);
                    setSegmentSubscribers(processed);
                    setSegmentName(file.name.replace(/\.csv$/i, ''));
                    setError('');
                } catch (err) { setError('Failed to parse segment CSV. Please check the format.'); }
            },
            error: () => setError('Failed to read CSV file.')
        });
    };

    const totalRevenue = segmentSubscribers.reduce((sum, sub) => sum + ((sub.historicClv ?? sub.totalClv) || 0), 0);
    const buyerCount = segmentSubscribers.filter(sub => sub.isBuyer).length;
    const totalOrders = segmentSubscribers.reduce((sum, sub) => sum + (sub.totalOrders || 0), 0);
    const revenuePerMember = segmentSubscribers.length > 0 ? totalRevenue / segmentSubscribers.length : 0;
    const aovPerBuyer = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const predictedLtvIncrease = segmentSubscribers.reduce((sum, sub) => sum + (sub.predictedClv || 0), 0);

    const avgDaysBetweenOrdersValues = segmentSubscribers
        .map(s => (s.avgDaysBetweenOrders ?? null))
        .filter((v): v is number => v !== null && !isNaN(v));
    const averageDaysBetweenOrders = avgDaysBetweenOrdersValues.length > 0
        ? avgDaysBetweenOrdersValues.reduce((a, b) => a + b, 0) / avgDaysBetweenOrdersValues.length
        : 0;

    const nonSuppressedCount = segmentSubscribers.filter(s => s.canReceiveEmail === true).length;

    const neverActiveCount = segmentSubscribers.filter(s => !s.firstActiveRaw && !s.lastActive).length;

    const hasAnySuppression = (s: ProcessedSubscriber, tokens: string[]) => {
        const list = (s.emailSuppressions || []).map(t => t.toUpperCase());
        return tokens.some(t => list.includes(t));
    };
    const unsubTokens = ['UNSUBSCRIBE', 'UNSUBSCRIBED', 'GLOBAL_UNSUBSCRIBE'];
    const spamTokens = ['SPAM_COMPLAINT', 'MARKED_AS_SPAM', 'SPAM'];
    const userSuppTokens = ['USER_SUPPRESSED', 'SUPPRESSED', 'MANUAL_SUPPRESSION'];

    const unsubscribedCount = segmentSubscribers.filter(s => hasAnySuppression(s, unsubTokens)).length;
    const spamComplaintCount = segmentSubscribers.filter(s => hasAnySuppression(s, spamTokens)).length;
    const userSuppressedCount = segmentSubscribers.filter(s => hasAnySuppression(s, userSuppTokens)).length;
    const optInCount = segmentSubscribers.filter(s => (s.emailConsentRaw || '').toUpperCase().trim() !== 'NEVER_SUBSCRIBED').length;

    const now = new Date();
    const anchorActivityDate: Date = (() => {
        let maxDate: Date | null = null;
        segmentSubscribers.forEach(sub => {
            const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
            const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;
            const activity = lastOpen && lastClick
                ? (lastOpen.getTime() > lastClick.getTime() ? lastOpen : lastClick)
                : (lastOpen || lastClick);
            if (activity) { if (!maxDate || activity.getTime() > maxDate.getTime()) { maxDate = activity; } }
        });
        return maxDate || now;
    })();

    const engagedWithin = (days: number) =>
        segmentSubscribers.filter(sub => {
            const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
            const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;
            const activity = lastOpen && lastClick
                ? (lastOpen.getTime() > lastClick.getTime() ? lastOpen : lastClick)
                : (lastOpen || lastClick);
            if (!activity) return false;
            const startWindow = new Date(anchorActivityDate.getTime() - days * 24 * 60 * 60 * 1000);
            return activity.getTime() >= startWindow.getTime() && activity.getTime() <= anchorActivityDate.getTime();
        }).length;

    const createdWithin = (days: number) =>
        segmentSubscribers.filter(sub => {
            const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
            if (!created) return false;
            const startWindow = new Date(anchorActivityDate.getTime() - days * 24 * 60 * 60 * 1000);
            return created.getTime() >= startWindow.getTime() && created.getTime() <= anchorActivityDate.getTime();
        }).length;

    const percent = (count: number) =>
        segmentSubscribers.length > 0 ? (count / segmentSubscribers.length) * 100 : 0;

    const formatPercent = (value: number) => {
        const formatted = value.toFixed(1);
        const num = parseFloat(formatted);
        return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
    };

    const cardBase = `bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6`;
    const labelClass = `text-sm font-medium text-gray-500 dark:text-gray-400`;
    const valueClass = `text-2xl font-bold text-gray-900 dark:text-gray-100`;

    return (
        <div className="mt-8">
            <div className="flex items-center gap-3 mb-4">
                <UploadCloud className="w-6 h-6 text-purple-600" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analyze Custom Segment</h2>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 mb-8 hover:shadow-xl transition-all duration-200">
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                    Upload a subscriber CSV to analyze growth, engagement recency, deliverability, opt‑in rate, and revenue indicators such as Predicted LTV and AOV. Use this to evaluate a specific audience without changing your main dashboard.
                </p>
                <div className="mb-4 flex items-center gap-3 flex-wrap">
                    <label htmlFor={fileInputId} className="inline-flex items-center px-3 py-2 rounded-lg cursor-pointer border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:border-purple-500" title="Choose a CSV file">
                        Choose File
                    </label>
                    <input id={fileInputId} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                    {selectedFileName && (<div className="text-sm text-gray-700 dark:text-gray-300 break-all flex-1 min-w-0">{selectedFileName}</div>)}
                    {selectedFileName && (
                        <button type="button" onClick={() => { setSegmentSubscribers([]); setSegmentName(''); setSelectedFileName(''); setError(''); const input = document.getElementById(fileInputId) as HTMLInputElement | null; if (input) input.value = ''; }} className="ml-auto px-3 py-2 rounded-lg text-sm font-medium border bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700" title="Reset the custom segment">
                            Reset
                        </button>
                    )}
                </div>
                {error && <div className="text-red-500 mb-4">{error}</div>}
                {segmentSubscribers.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <ListChecks className="w-5 h-5 text-purple-600" />
                            <span className="text-lg font-semibold break-all text-gray-900 dark:text-gray-100">{segmentName}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            <div className={cardBase} title="Sum of Historic Customer Lifetime Value for all members in the segment">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Total Revenue</p>
                                </div>
                                <p className={valueClass}>{totalRevenue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}</p>
                            </div>
                            <div className={cardBase} title="Total number of profiles in the uploaded segment">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Members</p>
                                </div>
                                <p className={valueClass}>{segmentSubscribers.length.toLocaleString()}</p>
                            </div>
                            <div className={cardBase} title="Average Order Value across all orders in this segment (Total Revenue / Total Orders)">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>AOV</p>
                                </div>
                                <p className={valueClass}>{aovPerBuyer.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}</p>
                            </div>
                            <div className={cardBase} title="Average revenue contributed by each member (Total Revenue / Members)">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Revenue per Member</p>
                                </div>
                                <p className={valueClass}>{revenuePerMember.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}</p>
                            </div>
                        </div>

                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Created</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            {[30, 60, 90, 180].map(days => {
                                const count = createdWithin(days);
                                const title = `Profiles created in the last ${days} days (anchored to most recent email activity on ${anchorActivityDate.toLocaleDateString()})`;
                                return (
                                    <div key={`created-${days}`} className={cardBase} title={title}>
                                        <div className="flex items-center gap-3 mb-2">
                                            <p className={labelClass}>Created in last {days} days</p>
                                        </div>
                                        <p className={valueClass}>{count.toLocaleString()} ({formatPercent(percent(count))})</p>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Engaged</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            {[30, 90, 120, 180].map(days => {
                                const count = engagedWithin(days);
                                return (
                                    <div key={`engaged-${days}`} className={cardBase} title={`Profiles with an email open or click in the last ${days} days (anchored to most recent email activity on ${anchorActivityDate.toLocaleDateString()})`}>
                                        <div className="flex items-center gap-3 mb-2">
                                            <p className={labelClass}>Engaged in last {days} days</p>
                                        </div>
                                        <p className={valueClass}>{count.toLocaleString()} ({formatPercent(percent(count))})</p>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Additional Metrics</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            <div className={cardBase} title="Sum of Predicted Customer Lifetime Value for all profiles in this segment">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Predicted LTV Increase</p>
                                </div>
                                <p className={valueClass}>{predictedLtvIncrease.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}</p>
                            </div>
                            <div className={cardBase} title="Average of the CSV column 'Average Days Between Orders' across profiles that have a value">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Average Days Between Orders</p>
                                </div>
                                <p className={valueClass}>{averageDaysBetweenOrders.toFixed(2)}</p>
                            </div>
                            <div className={cardBase} title="Email Suppressions equal to [] (consent ignored)">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Non‑Suppressed</p>
                                </div>
                                <p className={valueClass}>{nonSuppressedCount.toLocaleString()} ({formatPercent(percent(nonSuppressedCount))})</p>
                            </div>
                            <div className={cardBase} title="Profiles with no First Active and no Last Active dates">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>Never Active</p>
                                </div>
                                <p className={valueClass}>{neverActiveCount.toLocaleString()} ({formatPercent(percent(neverActiveCount))})</p>
                            </div>
                        </div>

                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Email Status</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className={cardBase} title="Email Suppressions contains UNSUBSCRIBE/UNSUBSCRIBED/GLOBAL_UNSUBSCRIBE">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>% Unsubscribed</p>
                                </div>
                                <p className={valueClass}>{formatPercent(percent(unsubscribedCount))}</p>
                            </div>
                            <div className={cardBase} title="Email Suppressions contains SPAM_COMPLAINT/MARKED_AS_SPAM/SPAM">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>% Spam Complaint</p>
                                </div>
                                <p className={valueClass}>{formatPercent(percent(spamComplaintCount))}</p>
                            </div>
                            <div className={cardBase} title="Email Suppressions contains USER_SUPPRESSED/SUPPRESSED/MANUAL_SUPPRESSION">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>% User Suppressed</p>
                                </div>
                                <p className={valueClass}>{formatPercent(percent(userSuppressedCount))}</p>
                            </div>
                            <div className={cardBase} title="Percentage with Email Marketing Consent not equal to 'NEVER_SUBSCRIBED'">
                                <div className="flex items-center gap-3 mb-2">
                                    <p className={labelClass}>% Opt‑in Rate</p>
                                </div>
                                <p className={valueClass}>{formatPercent(percent(optInCount))}</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomSegmentBlock;
