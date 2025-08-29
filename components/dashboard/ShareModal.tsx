'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Share2, Copy, Link, Calendar, Eye, Trash2, ExternalLink, ChevronDown, AlertTriangle } from 'lucide-react';
import { DataManager } from '../../lib/data/dataManager';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    snapshotId: string;
    snapshotLabel: string;
    dateRange: string; // '30d' | 'all' | 'custom'
    customFrom?: string | null;
    customTo?: string | null;
    granularity: string;
    compareMode: string; // 'prev-period' | 'prev-year'
}

interface Share {
    id: string;
    title: string;
    description?: string;
    sharedByName?: string;
    shareUrl: string;
    createdAt: string;
    expiresAt?: string;
    isActive: boolean;
    accessCount: number;
    lastAccessedAt?: string;
}

export default function ShareModal({ isOpen, onClose, snapshotId, snapshotLabel, dateRange, customFrom, customTo, granularity, compareMode }: ShareModalProps) {
    const [shares, setShares] = useState<Share[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

    // Form state for creating new share
    const [title, setTitle] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [expiresIn, setExpiresIn] = useState<string>('1hour');

    const loadShares = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const response = await fetch(`/api/snapshots/share?snapshotId=${snapshotId}`);
            if (!response.ok) {
                throw new Error('Failed to load shares');
            }

            const data = await response.json();
            setShares(data.shares || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [snapshotId]);

    useEffect(() => {
        if (isOpen) {
            loadShares();
            setTitle(`${snapshotLabel} - Dashboard`);
            setName('');
            setDescription('');
            setExpiresIn('1hour');
        }
    }, [isOpen, snapshotId, snapshotLabel, loadShares]);

    const computeWindow = () => {
        try {
            const dm = DataManager.getInstance();
            const all = [...dm.getCampaigns(), ...dm.getFlowEmails()].filter(e => e.sentDate instanceof Date && !isNaN(e.sentDate.getTime()));
            if (!all.length) return { start: null, end: null };
            let endDate = new Date(Math.max(...all.map(e => e.sentDate.getTime())));
            endDate.setHours(0, 0, 0, 0);
            let startDate: Date;
            if (dateRange === 'custom' && customFrom && customTo) {
                startDate = new Date(customFrom + 'T00:00:00');
                endDate = new Date(customTo + 'T00:00:00');
            } else if (dateRange === 'all') {
                startDate = new Date(Math.min(...all.map(e => e.sentDate.getTime())));
                startDate.setHours(0, 0, 0, 0);
            } else {
                const days = parseInt(dateRange.replace('d', '')) || 30;
                startDate = new Date(endDate); startDate.setDate(startDate.getDate() - days + 1);
            }
            return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
        } catch { return { start: null, end: null }; }
    };

    const createShare = async () => {
        if (!title.trim()) {
            setError('Title is required');
            return;
        }

        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        try {
            setIsCreating(true);
            setError(null);

            // Get current CSV data from DataManager
            const dm = DataManager.getInstance();
            const csvData: Record<string, string> = {};

            try {
                // Helper function to convert data to CSV
                const arrayToCSV = (data: any[]) => {
                    if (data.length === 0) return '';

                    const headers = Object.keys(data[0]);
                    const csvRows = [headers.join(',')];

                    for (const row of data) {
                        const values = headers.map(header => {
                            const value = row[header];
                            // Escape CSV values that contain commas, quotes, or newlines
                            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                                return `"${value.replace(/"/g, '""')}"`;
                            }
                            return value;
                        });
                        csvRows.push(values.join(','));
                    }

                    return csvRows.join('\n');
                };

                // Helper function to convert processed campaigns back to raw CSV format
                const processedCampaignsToRawCSV = (campaigns: any[]) => {
                    return campaigns.map(campaign => ({
                        'Campaign Name': campaign.campaignName || '',
                        'Subject': campaign.subject || '',
                        'Send Time': campaign.sentDate ? new Date(campaign.sentDate).toISOString() : '',
                        'Send Weekday': campaign.sentDate ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(campaign.sentDate).getDay()] : '',
                        'Total Recipients': campaign.emailsSent || 0,
                        'Unique Placed Order': campaign.totalOrders || 0,
                        'Placed Order Rate': campaign.conversionRate ? (campaign.conversionRate / 100).toFixed(4) : '0',
                        'Revenue': campaign.revenue || 0,
                        'Unique Opens': campaign.uniqueOpens || 0,
                        'Open Rate': campaign.openRate ? (campaign.openRate / 100).toFixed(4) : '0',
                        'Total Opens': campaign.uniqueOpens || 0, // Approximate with unique opens
                        'Unique Clicks': campaign.uniqueClicks || 0,
                        'Click Rate': campaign.clickRate ? (campaign.clickRate / 100).toFixed(4) : '0',
                        'Total Clicks': campaign.uniqueClicks || 0, // Approximate with unique clicks
                        'Unsubscribes': campaign.unsubscribesCount || 0,
                        'Spam Complaints': campaign.spamComplaintsCount || 0,
                        'Spam Complaints Rate': campaign.spamRate ? (campaign.spamRate / 100).toFixed(4) : '0',
                        'Successful Deliveries': campaign.emailsSent || 0,
                        'Bounces': campaign.bouncesCount || 0,
                        'Bounce Rate': campaign.bounceRate ? (campaign.bounceRate / 100).toFixed(4) : '0',
                        'Campaign ID': campaign.id?.toString() || '',
                        'Campaign Channel': 'Email'
                    }));
                };

                // Helper function to convert processed flows back to raw CSV format
                const processedFlowsToRawCSV = (flows: any[]) => {
                    return flows.map(flow => ({
                        'Day': flow.sentDate ? new Date(flow.sentDate).toISOString().split('T')[0] : '',
                        'Flow ID': flow.flowId || '',
                        'Flow Name': flow.flowName || '',
                        'Flow Message ID': flow.flowMessageId || '',
                        'Flow Message Name': flow.emailName || '',
                        'Flow Message Channel': 'Email',
                        'Status': flow.status || 'Sent',
                        'Delivered': flow.emailsSent || 0,
                        'Bounced': flow.bouncesCount || 0,
                        'Bounce Rate': flow.bounceRate ? (flow.bounceRate / 100).toFixed(4) : '0',
                        'Unique Opens': flow.uniqueOpens || 0,
                        'Open Rate': flow.openRate ? (flow.openRate / 100).toFixed(4) : '0',
                        'Total Opens': flow.uniqueOpens || 0,
                        'Unique Clicks': flow.uniqueClicks || 0,
                        'Click Rate': flow.clickRate ? (flow.clickRate / 100).toFixed(4) : '0',
                        'Total Clicks': flow.uniqueClicks || 0,
                        'Unique Placed Order': flow.totalOrders || 0,
                        'Placed Order': flow.totalOrders || 0,
                        'Placed Order Rate': flow.conversionRate ? (flow.conversionRate / 100).toFixed(4) : '0',
                        'Revenue': flow.revenue || 0
                    }));
                };

                // Helper function to convert processed subscribers back to raw CSV format  
                const processedSubscribersToRawCSV = (subscribers: any[]) => {
                    return subscribers.map(subscriber => ({
                        'Email': subscriber.email || '',
                        'Klaviyo ID': subscriber.id?.toString() || '',
                        'First Name': subscriber.firstName || '',
                        'Last Name': subscriber.lastName || '',
                        'City': subscriber.city || '',
                        'State / Region': subscriber.region || '',
                        'Country': subscriber.country || '',
                        'Zip Code': subscriber.zipCode || '',
                        'Source': subscriber.source || '',
                        'Email Marketing Consent': 'subscribed',
                        'Profile Created On': subscriber.subscribedAt ? new Date(subscriber.subscribedAt).toISOString() : '',
                        'Date Added': subscriber.subscribedAt ? new Date(subscriber.subscribedAt).toISOString() : ''
                    }));
                };

                // Export current data as CSV strings
                const campaigns = dm.getCampaigns();
                const flows = dm.getFlowEmails();
                const subscribers = dm.getSubscribers();

                if (campaigns.length > 0) {
                    const rawCampaigns = processedCampaignsToRawCSV(campaigns);
                    csvData.campaigns = arrayToCSV(rawCampaigns);
                }

                if (flows.length > 0) {
                    const rawFlows = processedFlowsToRawCSV(flows);
                    csvData.flows = arrayToCSV(rawFlows);
                }

                if (subscribers.length > 0) {
                    const rawSubscribers = processedSubscribersToRawCSV(subscribers);
                    csvData.subscribers = arrayToCSV(rawSubscribers);
                }

                console.log('Extracted CSV data:', {
                    campaigns: csvData.campaigns ? `${csvData.campaigns.split('\n').length} rows` : 'none',
                    flows: csvData.flows ? `${csvData.flows.split('\n').length} rows` : 'none',
                    subscribers: csvData.subscribers ? `${csvData.subscribers.split('\n').length} rows` : 'none'
                });

            } catch (dataError) {
                console.warn('Could not extract CSV data:', dataError);
            }

            const window = computeWindow();

            // Build reduced static snapshot JSON directly from DataManager to ensure parity with main dashboard metrics
            const buildClientStaticSnapshot = () => {
                try {
                    const dm = DataManager.getInstance();
                    const allCampaigns = dm.getCampaigns();
                    const allFlows = dm.getFlowEmails();
                    const subscribers = dm.getSubscribers();
                    if (!allCampaigns.length && !allFlows.length) return null;
                    if (!window.start || !window.end) return null;
                    const start = new Date(window.start + 'T00:00:00Z');
                    const end = new Date(window.end + 'T23:59:59Z');

                    const inRange = (d: Date) => d >= start && d <= end;
                    const campaigns = allCampaigns.filter(c => c.sentDate && inRange(c.sentDate));
                    const flows = allFlows.filter(f => f.sentDate && inRange(f.sentDate));

                    // Helper to sum metrics on a collection (campaign + flow email objects share field names used below)
                    const zero = { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribes: 0, spamComplaints: 0, bounces: 0 };
                    const sumGeneric = (rows: any[]) => rows.reduce((acc, e) => {
                        acc.revenue += e.revenue || 0;
                        acc.emailsSent += e.emailsSent || 0;
                        acc.totalOrders += e.totalOrders || 0;
                        acc.uniqueOpens += e.uniqueOpens || 0;
                        acc.uniqueClicks += e.uniqueClicks || 0;
                        acc.unsubscribes += e.unsubscribesCount || e.unsubscribes || 0;
                        acc.spamComplaints += e.spamComplaintsCount || e.spamComplaints || 0;
                        acc.bounces += e.bouncesCount || e.bounces || 0;
                        return acc;
                    }, { ...zero });

                    const allEmails = [...campaigns.map(c => ({ category: 'campaign', ...c })), ...flows.map(f => ({ category: 'flow', ...f }))];
                    const totalsAll = sumGeneric(allEmails);
                    const totalsCampaigns = sumGeneric(allEmails.filter(e => e.category === 'campaign'));
                    const totalsFlows = sumGeneric(allEmails.filter(e => e.category === 'flow'));

                    const mkDerived = (t: typeof totalsAll) => ({
                        openRate: t.emailsSent ? Math.min(100, (t.uniqueOpens / t.emailsSent) * 100) : 0,
                        clickRate: t.emailsSent ? Math.min(100, (t.uniqueClicks / t.emailsSent) * 100) : 0,
                        clickToOpenRate: t.uniqueOpens ? Math.min(100, (t.uniqueClicks / t.uniqueOpens) * 100) : 0,
                        conversionRate: t.uniqueClicks ? Math.min(100, (t.totalOrders / t.uniqueClicks) * 100) : 0,
                        revenuePerEmail: t.emailsSent ? t.revenue / t.emailsSent : 0,
                        avgOrderValue: t.totalOrders ? t.revenue / t.totalOrders : 0,
                        unsubscribeRate: t.emailsSent ? Math.min(100, (t.unsubscribes / t.emailsSent) * 100) : 0,
                        spamRate: t.emailsSent ? Math.min(100, (t.spamComplaints / t.emailsSent) * 100) : 0,
                        bounceRate: t.emailsSent ? Math.min(100, (t.bounces / t.emailsSent) * 100) : 0,
                    });

                    // Daily aggregation
                    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
                    const dailyMapAll = new Map<string, typeof zero>();
                    const dailyMapCampaigns = new Map<string, typeof zero>();
                    const dailyMapFlows = new Map<string, typeof zero>();
                    const addDaily = (map: Map<string, typeof zero>, e: any) => {
                        const k = dayKey(e.sentDate);
                        const cur = map.get(k) || { ...zero };
                        cur.revenue += e.revenue || 0;
                        cur.emailsSent += e.emailsSent || 0;
                        cur.totalOrders += e.totalOrders || 0;
                        cur.uniqueOpens += e.uniqueOpens || 0;
                        cur.uniqueClicks += e.uniqueClicks || 0;
                        cur.unsubscribes += e.unsubscribesCount || e.unsubscribes || 0;
                        cur.spamComplaints += e.spamComplaintsCount || e.spamComplaints || 0;
                        cur.bounces += e.bouncesCount || e.bounces || 0;
                        map.set(k, cur);
                    };
                    for (const e of allEmails) { if (!e.sentDate) continue; addDaily(dailyMapAll, e); if (e.category === 'campaign') addDaily(dailyMapCampaigns, e); else addDaily(dailyMapFlows, e); }
                    const toDaily = (map: Map<string, typeof zero>) => [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, v]) => ({ date, ...v }));

                    // Previous period
                    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
                    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23, 59, 59, 999);
                    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1)); prevStart.setHours(0, 0, 0, 0);
                    const inPrev = (d: Date) => d >= prevStart && d <= prevEnd;
                    const prevEmails = ([] as any[]).concat(allCampaigns as any[], allFlows as any[]).filter(e => e.sentDate && inPrev(e.sentDate));
                    const prevAll = sumGeneric(prevEmails);
                    const prevCampaigns = sumGeneric(prevEmails.filter(e => (e as any).campaignName));
                    const prevFlows = sumGeneric(prevEmails.filter(e => (e as any).flowName || (e as any).flowMessageId));

                    const subscribed = subscribers.filter((s: any) => /subscribed/i.test(s.emailMarketingConsent || s.consent || 'subscribed')).length;
                    const audienceOverview = subscribers.length ? {
                        totalSubscribers: subscribers.length,
                        subscribedCount: subscribed,
                        unsubscribedCount: subscribers.length - subscribed,
                        percentSubscribed: subscribers.length ? (subscribed / subscribers.length) * 100 : 0,
                    } : undefined;

                    const snapshot = {
                        meta: {
                            snapshotId: 'client-static',
                            generatedAt: new Date().toISOString(),
                            accountId: 'local',
                            uploadId: 'local',
                            dateRange: { start: window.start, end: window.end },
                            granularity: 'daily' as const,
                            compareRange: { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) },
                            sections: [
                                ...(audienceOverview ? ['audienceOverview'] : []),
                                'emailPerformance', 'campaignPerformance', 'flowPerformance'
                            ]
                        },
                        audienceOverview,
                        emailPerformance: {
                            totals: totalsAll,
                            derived: mkDerived(totalsAll),
                            previous: prevEmails.length ? { totals: prevAll, derived: mkDerived(prevAll), range: { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) } } : undefined,
                            daily: toDaily(dailyMapAll)
                        },
                        campaignPerformance: totalsCampaigns.emailsSent ? {
                            totals: totalsCampaigns,
                            derived: mkDerived(totalsCampaigns),
                            previous: prevCampaigns.emailsSent ? { totals: prevCampaigns, derived: mkDerived(prevCampaigns), range: { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) } } : undefined,
                            daily: toDaily(dailyMapCampaigns)
                        } : undefined,
                        flowPerformance: totalsFlows.emailsSent ? {
                            totals: totalsFlows,
                            derived: mkDerived(totalsFlows),
                            previous: prevFlows.emailsSent ? { totals: prevFlows, derived: mkDerived(prevFlows), range: { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) } } : undefined,
                            daily: toDaily(dailyMapFlows)
                        } : undefined
                    };
                    return snapshot;
                } catch (e) {
                    console.warn('Failed building client static snapshot', e);
                    return null;
                }
            };
            const staticSnapshot = buildClientStaticSnapshot();
            // Build a minimal sharedBundle using same logic as DashboardHeavy for exact metric parity
            const buildSharedBundle = () => {
                try {
                    const dm = DataManager.getInstance();
                    if (!window.start || !window.end) return null;
                    const start = new Date(window.start + 'T00:00:00');
                    const end = new Date(window.end + 'T23:59:59');
                    const inRange = (d: Date) => d >= start && d <= end;
                    const campaigns = dm.getCampaigns().filter(c => c.sentDate && inRange(c.sentDate));
                    const flows = dm.getFlowEmails().filter(f => f.sentDate && inRange(f.sentDate));
                    if (!campaigns.length && !flows.length) return null;
                    const all = [...campaigns, ...flows];
                    const sum = (rows: any[]) => rows.reduce((acc, e) => { acc.revenue += e.revenue; acc.emailsSent += e.emailsSent; acc.totalOrders += e.totalOrders; acc.uniqueOpens += e.uniqueOpens; acc.uniqueClicks += e.uniqueClicks; acc.unsubscribes += e.unsubscribesCount; acc.spamComplaints += e.spamComplaintsCount; acc.bounces += e.bouncesCount; return acc; }, { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribes: 0, spamComplaints: 0, bounces: 0 });
                    const mkDerived = (t: any) => ({
                        avgOrderValue: t.totalOrders ? t.revenue / t.totalOrders : 0,
                        revenuePerEmail: t.emailsSent ? t.revenue / t.emailsSent : 0,
                        openRate: t.emailsSent ? (t.uniqueOpens / t.emailsSent) * 100 : 0,
                        clickRate: t.emailsSent ? (t.uniqueClicks / t.emailsSent) * 100 : 0,
                        clickToOpenRate: t.uniqueOpens ? (t.uniqueClicks / t.uniqueOpens) * 100 : 0,
                        conversionRate: t.uniqueClicks ? (t.totalOrders / t.uniqueClicks) * 100 : 0,
                        unsubscribeRate: t.emailsSent ? (t.unsubscribes / t.emailsSent) * 100 : 0,
                        spamRate: t.emailsSent ? (t.spamComplaints / t.emailsSent) * 100 : 0,
                        bounceRate: t.emailsSent ? (t.bounces / t.emailsSent) * 100 : 0,
                    });
                    const totalsAll = sum(all);
                    const totalsCampaigns = sum(campaigns);
                    const totalsFlows = sum(flows);
                    const previousPeriod = (() => {
                        const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
                        const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23, 59, 59, 999);
                        const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1)); prevStart.setHours(0, 0, 0, 0);
                        const inPrev = (d: Date) => d >= prevStart && d <= prevEnd;
                        const prevAll = all.filter(e => e.sentDate && inPrev(e.sentDate));
                        const prevCamp = campaigns.filter(e => e.sentDate && inPrev(e.sentDate));
                        const prevFlow = flows.filter(e => e.sentDate && inPrev(e.sentDate));
                        return { prevStart, prevEnd, prevAll, prevCamp, prevFlow };
                    })();
                    const prevTotalsAll = sum(previousPeriod.prevAll);
                    const prevTotalsCamp = sum(previousPeriod.prevCamp);
                    const prevTotalsFlow = sum(previousPeriod.prevFlow);
                    const dailyMap = new Map<string, any>();
                    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
                    for (const e of all) { const k = dayKey(e.sentDate); const cur = dailyMap.get(k) || { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribes: 0, spamComplaints: 0, bounces: 0 }; cur.revenue += e.revenue; cur.emailsSent += e.emailsSent; cur.totalOrders += e.totalOrders; cur.uniqueOpens += e.uniqueOpens; cur.uniqueClicks += e.uniqueClicks; cur.unsubscribes += e.unsubscribesCount; cur.spamComplaints += e.spamComplaintsCount; cur.bounces += e.bouncesCount; dailyMap.set(k, cur); }
                    const daily = [...dailyMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, v]) => ({ date, ...v }));
                    const changePct = (cur: number, prev: number) => prev ? ((cur - prev) / prev) * 100 : 0;
                    const metricBundle = (totals: any, prev: any) => {
                        const d = mkDerived(totals); const pd = mkDerived(prev);
                        return {
                            totals,
                            derived: d,
                            previous: { totals: prev, derived: pd },
                            changes: {
                                revenue: changePct(totals.revenue, prev.revenue),
                                avgOrderValue: changePct(d.avgOrderValue, pd.avgOrderValue),
                                totalOrders: changePct(totals.totalOrders, prev.totalOrders),
                                conversionRate: changePct(d.conversionRate, pd.conversionRate),
                                openRate: changePct(d.openRate, pd.openRate),
                                clickRate: changePct(d.clickRate, pd.clickRate),
                                clickToOpenRate: changePct(d.clickToOpenRate, pd.clickToOpenRate),
                                revenuePerEmail: changePct(d.revenuePerEmail, pd.revenuePerEmail),
                                emailsSent: changePct(totals.emailsSent, prev.emailsSent),
                                unsubscribeRate: changePct(d.unsubscribeRate, pd.unsubscribeRate),
                                spamRate: changePct(d.spamRate, pd.spamRate),
                                bounceRate: changePct(d.bounceRate, pd.bounceRate)
                            },
                            daily
                        };
                    };
                    const audience = (() => {
                        const subs = dm.getSubscribers();
                        if (!subs.length) return undefined;
                        const subscribed = subs.filter(s => /subscribed/i.test((s as any).emailMarketingConsent || (s as any).consent || 'subscribed')).length;
                        return { totalSubscribers: subs.length, subscribedCount: subscribed, unsubscribedCount: subs.length - subscribed, percentSubscribed: subs.length ? (subscribed / subs.length) * 100 : 0 };
                    })();
                    return {
                        meta: { start: window.start, end: window.end, generatedAt: new Date().toISOString() },
                        audienceOverview: audience,
                        emailPerformance: metricBundle(totalsAll, prevTotalsAll),
                        campaignPerformance: totalsCampaigns.emailsSent ? metricBundle(totalsCampaigns, prevTotalsCamp) : undefined,
                        flowPerformance: totalsFlows.emailsSent ? metricBundle(totalsFlows, prevTotalsFlow) : undefined
                    };
                } catch (e) {
                    console.warn('buildSharedBundle failed', e); return null;
                }
            };
            let sharedBundle = buildSharedBundle();
            if (sharedBundle) {
                // Canonicalize: add schemaVersion + meta.granularity + compareMode; if original had meta merge them
                const originalMeta = (sharedBundle as any).meta || {};
                sharedBundle = {
                    ...sharedBundle,
                    schemaVersion: 1,
                    meta: {
                        ...originalMeta,
                        start: window.start,
                        end: window.end,
                        granularity,
                        compareMode,
                        generatedAt: new Date().toISOString()
                    }
                } as any;
            }
            // Legacy compatibility path: if we also built a broader staticSnapshot (server-style) keep it only if needed for fallbacks.
            // Preferred path: store just sharedBundle (smallest accurate representation)
            let snapshotPayload: any = null;
            if (sharedBundle) snapshotPayload = sharedBundle; else if (staticSnapshot) snapshotPayload = staticSnapshot; // fallback
            const response = await fetch('/api/snapshots/share', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    snapshotId,
                    title: title.trim(),
                    name: name.trim(),
                    description: description.trim() || null,
                    expiresIn: expiresIn || null,
                    createSnapshot: !snapshotId || snapshotId === 'temp-snapshot'
                    , rangeStart: window.start, rangeEnd: window.end
                    , granularity, compareMode
                    , staticSnapshotJson: snapshotPayload || undefined
                    // Note: csvData temporarily removed to avoid 413 Request Too Large errors
                    // TODO: Implement chunked CSV upload for large datasets
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create share');
            }

            const data = await response.json();

            // Reset form
            setTitle(`${snapshotLabel} - Dashboard`);
            setName('');
            setDescription('');
            setExpiresIn('1hour');

            // Reload shares
            await loadShares();

            // Auto-copy the new share URL
            if (data.shareUrl) {
                await copyToClipboard(data.shareUrl);
            }

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsCreating(false);
        }
    };

    const deleteShare = async (shareId: string) => {
        try {
            const response = await fetch('/api/snapshots/share', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shareId, action: 'delete' })
            });

            if (!response.ok) {
                throw new Error('Failed to delete share');
            }

            await loadShares();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const copyToClipboard = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopiedUrl(url);
            setTimeout(() => setCopiedUrl(null), 2000);
        } catch (err) {
            console.error('Failed to copy to clipboard');
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const isExpired = (expiresAt?: string) => {
        return expiresAt && new Date(expiresAt) < new Date();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <Share2 className="w-6 h-6 text-purple-600" />
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Share Dashboard
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 max-h-[calc(90vh-80px)] overflow-y-auto">
                    {/* Create New Share */}
                    <div className="mb-8">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                            Create New Share Link
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Title *
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    placeholder="Dashboard title for recipients"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Your Name *
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    placeholder="Your name (will be shown to recipients)"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Description (optional)
                                </label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={2}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    placeholder="Optional description for recipients"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Expires
                                </label>
                                <div className="relative">
                                    <select
                                        value={expiresIn}
                                        onChange={(e) => setExpiresIn(e.target.value)}
                                        className="appearance-none w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    >
                                        <option value="1hour">1 hour</option>
                                        <option value="1day">1 day</option>
                                        <option value="7days">7 days</option>
                                        <option value="30days">30 days</option>
                                        <option value="">Never expires (not recommended)</option>
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                                </div>
                            </div>

                            {/* Security Disclaimer */}
                            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                                            Sharing Sensitive Information
                                        </h4>
                                        <p className="text-sm text-amber-700 dark:text-amber-300">
                                            You are about to share potentially sensitive business data including email metrics,
                                            subscriber information, and performance analytics. Please ensure you trust the recipients
                                            and consider using shorter expiration times for better security.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={createShare}
                                disabled={isCreating || !title.trim() || !name.trim()}
                                className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isCreating ? 'Creating...' : 'Create Share Link'}
                            </button>
                        </div>
                    </div>

                    {/* Existing Shares */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                            Existing Share Links
                        </h3>

                        {isLoading ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                            </div>
                        ) : shares.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                <Link className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>No share links created yet</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {shares.map((share) => (
                                    <div
                                        key={share.id}
                                        className={`border rounded-lg p-4 ${isExpired(share.expiresAt) || !share.isActive
                                            ? 'border-gray-300 dark:border-gray-700 opacity-60'
                                            : 'border-gray-200 dark:border-gray-700'
                                            }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                                    {share.title}
                                                </h4>
                                                {share.description && (
                                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                        {share.description}
                                                    </p>
                                                )}

                                                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        <span>Created {formatDate(share.createdAt)}</span>
                                                    </div>
                                                    {share.expiresAt && (
                                                        <div className={`flex items-center gap-1 ${isExpired(share.expiresAt) ? 'text-red-500' : ''
                                                            }`}>
                                                            <span>
                                                                {isExpired(share.expiresAt) ? 'Expired' : 'Expires'} {formatDate(share.expiresAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {isExpired(share.expiresAt) && (
                                                        <div className="flex items-center gap-1 text-red-500">
                                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400">
                                                                Expired
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 mt-3">
                                                    <input
                                                        type="text"
                                                        value={share.shareUrl}
                                                        readOnly
                                                        className="flex-1 text-sm px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-600 dark:text-gray-400"
                                                    />
                                                    <button
                                                        onClick={() => copyToClipboard(share.shareUrl)}
                                                        className={`px-3 py-1 rounded text-sm transition-colors ${copiedUrl === share.shareUrl
                                                            ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                                            }`}
                                                        disabled={isExpired(share.expiresAt) || !share.isActive}
                                                    >
                                                        {copiedUrl === share.shareUrl ? 'Copied!' : <Copy className="w-4 h-4" />}
                                                    </button>
                                                    <a
                                                        href={share.shareUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-3 py-1 bg-purple-100 text-purple-600 hover:bg-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded text-sm transition-colors"
                                                    >
                                                        <ExternalLink className="w-4 h-4" />
                                                    </a>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => deleteShare(share.id)}
                                                className="ml-4 p-2 text-gray-400 hover:text-red-500 transition-colors"
                                                title="Delete share"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
