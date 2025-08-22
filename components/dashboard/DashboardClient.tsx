"use client";
import React, { useMemo, useState, useEffect, useDeferredValue } from 'react';
import { DataManager } from '../../lib/data/dataManager';
import MetricCard from './MetricCard';
import DayOfWeekPerformance from './DayOfWeekPerformance';
import HourOfDayPerformance from './HourOfDayPerformance';
import AudienceCharts from './AudienceCharts';
import FlowStepAnalysis from './FlowStepAnalysis';
import CustomSegmentBlock from './CustomSegmentBlock';
import { BarChart3, Calendar, ChevronDown, Mail, Send, Zap, Star, Upload as UploadIcon, X } from 'lucide-react';
import UploadWizard from '../../components/UploadWizard';

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function formatPercent(value: number) { return `${value.toFixed(2)}%`; }
function formatNumber(value: number) { return Math.round(value).toLocaleString('en-US'); }

export default function DashboardClient({ businessName, userId }: { businessName?: string; userId?: string }) {
    // Set user ID for data isolation
    useEffect(() => {
        if (userId) {
            DataManager.setUserId(userId);
            console.log('DashboardClient: Set userId for data isolation:', userId?.substring(0, 8));
        }
    }, [userId]);

    const dm = useMemo(() => DataManager.getInstance(), []);

    // Error handling state
    const [dashboardError, setDashboardError] = useState<string | null>(null);

    // Lightweight data refresh when uploads complete (no saved reports UI)
    const [dataVersion, setDataVersion] = useState(0);
    useEffect(() => {
        const onCreated = () => {
            // UploadWizard loaded new CSVs into DataManager; trigger a re-render and close modal
            setDataVersion(v => v + 1);
            setShowUploadModal(false);
        };
        const onHydrated = () => setDataVersion(v => v + 1);
        window.addEventListener('em:snapshot-created', onCreated as EventListener);
        window.addEventListener('em:dataset-hydrated', onHydrated as EventListener);
        // On mount, ensure DataManager pulls from durable storage; retry briefly if empty
        let active = true;
        (async () => {
            console.log('DashboardClient: Attempting data hydration, userId:', userId?.substring(0, 8));
            for (let i = 0; i < 5 && active; i++) {
                const ok = await DataManager.getInstance().ensureHydrated();
                if (ok) {
                    console.log('DashboardClient: Data hydrated successfully on attempt', i + 1);
                    setDataVersion(v => v + 1);
                    break;
                }
                await new Promise(r => setTimeout(r, 150));
            }
            if (active && !DataManager.getInstance().hasRealData()) {
                console.log('DashboardClient: No data found after hydration attempts');
            }
        })();
        return () => {
            window.removeEventListener('em:snapshot-created', onCreated as EventListener);
            window.removeEventListener('em:dataset-hydrated', onHydrated as EventListener);
            active = false;
        };
    }, []);

    // Download and process CSV files from server if no local data exists
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // If we already have data (from IDB/localStorage), skip
                if (dm.getCampaigns().length || dm.getFlowEmails().length || dm.getSubscribers().length) return;

                console.log('No local data found, downloading from server...');

                // Check if we have any snapshots
                const list = await fetch('/api/snapshots/list', { cache: 'no-store' });
                if (!list.ok) {
                    console.log('Failed to fetch snapshots list:', list.status);
                    return;
                }
                const j = await list.json().catch(() => ({}));
                const latest = (j.snapshots || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                if (!latest?.id) {
                    console.log('No snapshots found for user');
                    return;
                }

                console.log('Found latest snapshot:', latest.id);

                // Download CSV files and process them
                const csvTypes = ['campaigns', 'flows', 'subscribers'];
                const csvFiles: { [key: string]: File } = {};

                for (const type of csvTypes) {
                    try {
                        const response = await fetch(`/api/snapshots/download-csv?type=${type}`, { cache: 'no-store' });
                        if (response.ok) {
                            const csvText = await response.text();
                            if (csvText.trim()) {
                                const blob = new Blob([csvText], { type: 'text/csv' });
                                csvFiles[type] = new File([blob], `${type}.csv`, { type: 'text/csv' });
                                console.log(`Downloaded ${type}.csv (${csvText.length} chars)`);
                            }
                        } else {
                            console.warn(`Failed to download ${type}.csv: ${response.status}`);
                        }
                    } catch (err) {
                        console.warn(`Error downloading ${type}.csv:`, err);
                    }
                }

                // If we have at least one CSV file, process them
                if (Object.keys(csvFiles).length > 0) {
                    console.log('Processing downloaded CSV files...');
                    const result = await dm.loadCSVFiles({
                        campaigns: csvFiles.campaigns,
                        flows: csvFiles.flows,
                        subscribers: csvFiles.subscribers,
                    });

                    if (result.success) {
                        console.log('Successfully loaded data from server CSV files');
                        if (cancelled) return;
                        setDataVersion(v => v + 1);
                        // Dispatch event to notify other components
                        window.dispatchEvent(new CustomEvent('em:dataset-hydrated'));
                    } else {
                        console.error('Failed to process CSV files:', result.errors);
                        setDashboardError(`Failed to process server data: ${result.errors.join(', ')}`);
                    }
                } else {
                    console.log('No CSV files downloaded');
                }
            } catch (err) {
                console.error('Error loading data from server:', err);
                setDashboardError(`Failed to load data from server: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        })();
        return () => { cancelled = true; };
    }, [dm]);

    // Date range and granularity state
    const [dateRange, setDateRange] = useState<'30d' | '60d' | '90d' | '120d' | '180d' | '365d' | 'all' | 'custom'>('30d');
    const [customFrom, setCustomFrom] = useState<string | undefined>(undefined); // YYYY-MM-DD
    const [customTo, setCustomTo] = useState<string | undefined>(undefined); // YYYY-MM-DD
    const customActive = dateRange === 'custom' && customFrom && customTo;
    const customDays = useMemo(() => {
        if (!customActive) return 0;
        const from = new Date(customFrom!); from.setHours(0, 0, 0, 0);
        const to = new Date(customTo!); to.setHours(23, 59, 59, 999);
        const diff = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1; // inclusive
        return Math.max(diff, 1);
    }, [customActive, customFrom, customTo]);
    const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');

    // Safe granularity calculation with error handling
    const safeGranularity = useMemo(() => {
        try {
            // Ensure we have data before calculating granularity
            if (dm.getCampaigns().length === 0 && dm.getFlowEmails().length === 0) {
                return 'daily'; // Safe fallback when no data
            }

            if (customActive && customDays > 0) {
                return dm.getGranularityForDateRange(`${customDays}d`);
            } else if (dateRange === 'all') {
                return dm.getGranularityForDateRange('all');
            } else {
                return dm.getGranularityForDateRange(dateRange === 'custom' ? '30d' : dateRange);
            }
        } catch (error: any) {
            console.error('Error calculating granularity:', error);
            setDashboardError(`Granularity calculation error: ${error?.message || 'Unknown error'}`);
            return 'daily'; // Safe fallback
        }
    }, [dateRange, customActive, customDays, dm, dataVersion]); // Add dataVersion to dependencies

    // Update granularity safely
    useEffect(() => {
        if (!dashboardError) {
            setGranularity(safeGranularity);
        }
    }, [safeGranularity, dashboardError]);

    // Keep date inputs in sync with selected preset; default to Last 30 days
    // moved below after dependent variables are declared

    // UI state
    const [selectedFlow, setSelectedFlow] = useState<string>('all');
    const [selectedCampaignMetric, setSelectedCampaignMetric] = useState<string>('revenue');
    const [displayedCampaigns, setDisplayedCampaigns] = useState<number>(5);
    const [stickyBar, setStickyBar] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);

    useEffect(() => {
        const onScroll = () => setStickyBar(window.scrollY > 100);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Data
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ALL_CAMPAIGNS = useMemo(() => dm.getCampaigns(), [dm, dataVersion]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ALL_FLOWS = useMemo(() => dm.getFlowEmails(), [dm, dataVersion]);
    const hasData = ALL_CAMPAIGNS.length > 0 || ALL_FLOWS.length > 0;
    // Anchor to the latest date within the currently visible subset (campaigns + selected flow)
    const REFERENCE_DATE = useMemo(() => {
        const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow);
        const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime());
        const flowTs = flowSubset.map(f => f.sentDate.getTime());
        const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n));
        return all.length ? new Date(Math.max(...all)) : new Date();
    }, [ALL_CAMPAIGNS, ALL_FLOWS, selectedFlow]);

    // Filters (inclusive, full-day bounds)
    const filteredCampaigns = useMemo(() => {
        if (!hasData) return [] as typeof ALL_CAMPAIGNS;
        let list = ALL_CAMPAIGNS;
        if (dateRange === 'custom' && customActive) {
            const from = new Date(customFrom!); from.setHours(0, 0, 0, 0);
            const to = new Date(customTo!); to.setHours(23, 59, 59, 999);
            list = list.filter(c => c.sentDate >= from && c.sentDate <= to);
        } else if (dateRange !== 'all') {
            const days = parseInt(dateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            list = list.filter(c => c.sentDate >= start && c.sentDate <= end);
        }
        return list;
    }, [ALL_CAMPAIGNS, dateRange, REFERENCE_DATE, hasData, customActive, customFrom, customTo]);

    const filteredFlowEmails = useMemo(() => {
        if (!hasData) return [] as typeof ALL_FLOWS;
        let flows = ALL_FLOWS;
        if (selectedFlow !== 'all') flows = flows.filter(f => f.flowName === selectedFlow);
        if (dateRange === 'custom' && customActive) {
            const from = new Date(customFrom!); from.setHours(0, 0, 0, 0);
            const to = new Date(customTo!); to.setHours(23, 59, 59, 999);
            flows = flows.filter(f => f.sentDate >= from && f.sentDate <= to);
        } else if (dateRange !== 'all') {
            const days = parseInt(dateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            flows = flows.filter(f => f.sentDate >= start && f.sentDate <= end);
        }
        return flows;
    }, [ALL_FLOWS, selectedFlow, dateRange, REFERENCE_DATE, hasData, customActive, customFrom, customTo]);

    // Period-over-period calc using base datasets anchored to REFERENCE_DATE
    const calcPoP = useMemo(() => {
        const negative = new Set(['unsubscribeRate', 'spamRate', 'bounceRate']);
        const pick = (key: string, agg: any) => {
            switch (key) {
                case 'totalRevenue': return agg.totalRevenue;
                case 'avgOrderValue':
                case 'averageOrderValue': return agg.avgOrderValue;
                case 'revenuePerEmail': return agg.revenuePerEmail;
                case 'openRate': return agg.openRate;
                case 'clickRate': return agg.clickRate;
                case 'clickToOpenRate': return agg.clickToOpenRate;
                case 'emailsSent': return agg.emailsSent;
                case 'totalOrders': return agg.totalOrders;
                case 'conversionRate': return agg.conversionRate;
                case 'unsubscribeRate': return agg.unsubscribeRate;
                case 'spamRate': return agg.spamRate;
                case 'bounceRate': return agg.bounceRate;
                default: return 0;
            }
        };
        return (
            metricKey: string,
            dataset: 'all' | 'campaigns' | 'flows',
            options?: { flowName?: string }
        ) => {
            const isAll = dateRange === 'all';
            const periodDays = dateRange === 'custom' ? customDays : parseInt(String(dateRange).replace('d', ''));
            if (!Number.isFinite(periodDays) || periodDays <= 0 || isAll) {
                return { changePercent: 0, isPositive: true, previousValue: 0, previousPeriod: undefined as any };
            }

            // Anchor to visible end-of-day, but use unfiltered base arrays for period comparisons
            const endDate = new Date(REFERENCE_DATE); endDate.setHours(23, 59, 59, 999);
            const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - periodDays + 1); startDate.setHours(0, 0, 0, 0);
            const prevEndDate = new Date(startDate); prevEndDate.setDate(prevEndDate.getDate() - 1); prevEndDate.setHours(23, 59, 59, 999);
            const prevStartDate = new Date(prevEndDate); prevStartDate.setDate(prevStartDate.getDate() - periodDays + 1); prevStartDate.setHours(0, 0, 0, 0);

            let campaignsToUse = ALL_CAMPAIGNS;
            let flowsToUse = ALL_FLOWS;
            if (dataset === 'campaigns') flowsToUse = [] as any;
            if (dataset === 'flows') campaignsToUse = [] as any;
            const flowName = options?.flowName;
            if (dataset === 'flows' && flowName && flowName !== 'all') {
                flowsToUse = flowsToUse.filter(f => f.flowName === flowName);
            }

            const current = dm.getAggregatedMetricsForPeriod(campaignsToUse as any, flowsToUse as any, startDate, endDate);
            const previous = dm.getAggregatedMetricsForPeriod(campaignsToUse as any, flowsToUse as any, prevStartDate, prevEndDate);

            const currentValue = pick(metricKey, current);
            const previousValue = pick(metricKey, previous);
            let changePercent = 0;
            if (previousValue !== 0) changePercent = ((currentValue - previousValue) / previousValue) * 100;
            else if (currentValue > 0) changePercent = 100;
            const isPositive = negative.has(metricKey) ? changePercent < 0 : changePercent > 0;
            return { changePercent, isPositive, previousValue, previousPeriod: { startDate: prevStartDate, endDate: prevEndDate } };
        };
    }, [dateRange, dm, customDays, REFERENCE_DATE, ALL_CAMPAIGNS, ALL_FLOWS]);
    const defCampaigns = useDeferredValue(filteredCampaigns);
    const defFlows = useDeferredValue(filteredFlowEmails);

    // Sync date inputs with active preset (including initial 30d); skip when in custom mode
    useEffect(() => {
        if (!hasData) return;
        if (dateRange === 'custom') return;
        const to = new Date(REFERENCE_DATE);
        const toISO = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${da}`;
        };
        if (dateRange === 'all') {
            const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow);
            const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime());
            const flowTs = flowSubset.map(f => f.sentDate.getTime());
            const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n));
            if (all.length) {
                const from = new Date(Math.min(...all));
                setCustomFrom(toISO(from));
                setCustomTo(toISO(to));
            } else {
                setCustomFrom(undefined);
                setCustomTo(undefined);
            }
        } else {
            const days = parseInt(String(dateRange).replace('d', ''));
            if (Number.isFinite(days)) {
                const from = new Date(to); from.setDate(from.getDate() - days + 1);
                setCustomFrom(toISO(from));
                setCustomTo(toISO(to));
            }
        }
    }, [dateRange, REFERENCE_DATE, selectedFlow, ALL_CAMPAIGNS, ALL_FLOWS, hasData]);

    // Overview metrics (all emails)

    const overviewMetrics = useMemo(() => {
        const all = [...defCampaigns, ...defFlows];
        if (all.length === 0) return null as any;
        const totalRevenue = all.reduce((s, e) => s + e.revenue, 0);
        const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        const mk = (key: string, value: number) => {
            const d = calcPoP(key, 'all');
            return { value, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
        };

        return {
            totalRevenue: mk('totalRevenue', totalRevenue),
            averageOrderValue: mk('avgOrderValue', avgOrderValue),
            revenuePerEmail: mk('revenuePerEmail', revenuePerEmail),
            openRate: mk('openRate', openRate),
            clickRate: mk('clickRate', clickRate),
            clickToOpenRate: mk('clickToOpenRate', clickToOpenRate),
            emailsSent: mk('emailsSent', totalEmailsSent),
            totalOrders: mk('totalOrders', totalOrders),
            conversionRate: mk('conversionRate', conversionRate),
            unsubscribeRate: mk('unsubscribeRate', unsubscribeRate),
            spamRate: mk('spamRate', spamRate),
            bounceRate: mk('bounceRate', bounceRate),
        };
    }, [defCampaigns, defFlows, calcPoP]);

    // Campaign-only metrics
    const campaignMetrics = useMemo(() => {
        const all = defCampaigns;
        if (all.length === 0) return null as any;
        const totalRevenue = all.reduce((s, e) => s + e.revenue, 0);
        const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        const mk = (key: string, value: number) => {
            const d = calcPoP(key, 'campaigns');
            return { value, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
        };

        return {
            totalRevenue: mk('totalRevenue', totalRevenue),
            averageOrderValue: mk('avgOrderValue', avgOrderValue),
            revenuePerEmail: mk('revenuePerEmail', revenuePerEmail),
            openRate: mk('openRate', openRate),
            clickRate: mk('clickRate', clickRate),
            clickToOpenRate: mk('clickToOpenRate', clickToOpenRate),
            emailsSent: mk('emailsSent', totalEmailsSent),
            totalOrders: mk('totalOrders', totalOrders),
            conversionRate: mk('conversionRate', conversionRate),
            unsubscribeRate: mk('unsubscribeRate', unsubscribeRate),
            spamRate: mk('spamRate', spamRate),
            bounceRate: mk('bounceRate', bounceRate),
        };
    }, [defCampaigns, calcPoP]);

    // Flow-only metrics
    const flowMetrics = useMemo(() => {
        const all = defFlows;
        if (all.length === 0) return null as any;
        const totalRevenue = all.reduce((s, e) => s + e.revenue, 0);
        const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        const mk = (key: string, value: number) => {
            const d = calcPoP(key, 'flows', { flowName: selectedFlow });
            return { value, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
        };

        return {
            totalRevenue: mk('totalRevenue', totalRevenue),
            averageOrderValue: mk('avgOrderValue', avgOrderValue),
            revenuePerEmail: mk('revenuePerEmail', revenuePerEmail),
            openRate: mk('openRate', openRate),
            clickRate: mk('clickRate', clickRate),
            clickToOpenRate: mk('clickToOpenRate', clickToOpenRate),
            emailsSent: mk('emailsSent', totalEmailsSent),
            totalOrders: mk('totalOrders', totalOrders),
            conversionRate: mk('conversionRate', conversionRate),
            unsubscribeRate: mk('unsubscribeRate', unsubscribeRate),
            spamRate: mk('spamRate', spamRate),
            bounceRate: mk('bounceRate', bounceRate),
        };
    }, [defFlows, calcPoP]);

    // Sparkline data
    const effectiveSeriesRange = dateRange === 'custom' && customActive ? 'custom' : dateRange;
    const overviewSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'revenue', effectiveSeriesRange, granularity, customFrom, customTo),
        averageOrderValue: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'avgOrderValue', effectiveSeriesRange, granularity, customFrom, customTo),
        revenuePerEmail: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'revenuePerEmail', effectiveSeriesRange, granularity, customFrom, customTo),
        openRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'openRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'clickRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickToOpenRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'clickToOpenRate', effectiveSeriesRange, granularity, customFrom, customTo),
        emailsSent: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'emailsSent', effectiveSeriesRange, granularity, customFrom, customTo),
        totalOrders: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'totalOrders', effectiveSeriesRange, granularity, customFrom, customTo),
        conversionRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'conversionRate', effectiveSeriesRange, granularity, customFrom, customTo),
        unsubscribeRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'unsubscribeRate', effectiveSeriesRange, granularity, customFrom, customTo),
        spamRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'spamRate', effectiveSeriesRange, granularity, customFrom, customTo),
        bounceRate: dm.getMetricTimeSeries(defCampaigns as any, defFlows as any, 'bounceRate', effectiveSeriesRange, granularity, customFrom, customTo),
    }), [defCampaigns, defFlows, effectiveSeriesRange, granularity, dm, customFrom, customTo]);

    const campaignSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries(defCampaigns as any, [], 'revenue', effectiveSeriesRange, granularity, customFrom, customTo),
        averageOrderValue: dm.getMetricTimeSeries(defCampaigns as any, [], 'avgOrderValue', effectiveSeriesRange, granularity, customFrom, customTo),
        revenuePerEmail: dm.getMetricTimeSeries(defCampaigns as any, [], 'revenuePerEmail', effectiveSeriesRange, granularity, customFrom, customTo),
        openRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'openRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'clickRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickToOpenRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'clickToOpenRate', effectiveSeriesRange, granularity, customFrom, customTo),
        emailsSent: dm.getMetricTimeSeries(defCampaigns as any, [], 'emailsSent', effectiveSeriesRange, granularity, customFrom, customTo),
        totalOrders: dm.getMetricTimeSeries(defCampaigns as any, [], 'totalOrders', effectiveSeriesRange, granularity, customFrom, customTo),
        conversionRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'conversionRate', effectiveSeriesRange, granularity, customFrom, customTo),
        unsubscribeRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'unsubscribeRate', effectiveSeriesRange, granularity, customFrom, customTo),
        spamRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'spamRate', effectiveSeriesRange, granularity, customFrom, customTo),
        bounceRate: dm.getMetricTimeSeries(defCampaigns as any, [], 'bounceRate', effectiveSeriesRange, granularity, customFrom, customTo),
    }), [defCampaigns, effectiveSeriesRange, granularity, dm, customFrom, customTo]);

    const flowSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries([], defFlows as any, 'revenue', effectiveSeriesRange, granularity, customFrom, customTo),
        averageOrderValue: dm.getMetricTimeSeries([], defFlows as any, 'avgOrderValue', effectiveSeriesRange, granularity, customFrom, customTo),
        revenuePerEmail: dm.getMetricTimeSeries([], defFlows as any, 'revenuePerEmail', effectiveSeriesRange, granularity, customFrom, customTo),
        openRate: dm.getMetricTimeSeries([], defFlows as any, 'openRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickRate: dm.getMetricTimeSeries([], defFlows as any, 'clickRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickToOpenRate: dm.getMetricTimeSeries([], defFlows as any, 'clickToOpenRate', effectiveSeriesRange, granularity, customFrom, customTo),
        emailsSent: dm.getMetricTimeSeries([], defFlows as any, 'emailsSent', effectiveSeriesRange, granularity, customFrom, customTo),
        totalOrders: dm.getMetricTimeSeries([], defFlows as any, 'totalOrders', effectiveSeriesRange, granularity, customFrom, customTo),
        conversionRate: dm.getMetricTimeSeries([], defFlows as any, 'conversionRate', effectiveSeriesRange, granularity, customFrom, customTo),
        unsubscribeRate: dm.getMetricTimeSeries([], defFlows as any, 'unsubscribeRate', effectiveSeriesRange, granularity, customFrom, customTo),
        spamRate: dm.getMetricTimeSeries([], defFlows as any, 'spamRate', effectiveSeriesRange, granularity, customFrom, customTo),
        bounceRate: dm.getMetricTimeSeries([], defFlows as any, 'bounceRate', effectiveSeriesRange, granularity, customFrom, customTo),
    }), [defFlows, effectiveSeriesRange, granularity, dm, customFrom, customTo]);

    const uniqueFlowNames = useMemo(() => Array.from(new Set(ALL_FLOWS.filter(e => (e.status || '').toLowerCase() === 'live').map(e => e.flowName))).sort(), [ALL_FLOWS]);

    const campaignMetricOptions = [
        { value: 'revenue', label: 'Revenue' },
        { value: 'avgOrderValue', label: 'Avg Order Value' },
        { value: 'revenuePerEmail', label: 'Revenue per Email' },
        { value: 'openRate', label: 'Open Rate' },
        { value: 'clickRate', label: 'Click Rate' },
        { value: 'clickToOpenRate', label: 'Click-to-Open Rate' },
        { value: 'emailsSent', label: 'Emails Sent' },
        { value: 'totalOrders', label: 'Total Orders' },
        { value: 'conversionRate', label: 'Conversion Rate' },
        { value: 'unsubscribeRate', label: 'Unsubscribe Rate' },
        { value: 'spamRate', label: 'Spam Rate' },
        { value: 'bounceRate', label: 'Bounce Rate' },
    ];

    const formatMetricValue = (v: number, metric: string) => {
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) return formatCurrency(v);
        if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) return formatPercent(v);
        return formatNumber(v);
    };

    const getSortedCampaigns = () => {
        return [...defCampaigns].sort((a, b) => {
            const av = Number((a as any)[selectedCampaignMetric]) || 0;
            const bv = Number((b as any)[selectedCampaignMetric]) || 0;
            return bv - av;
        });
    };

    // Error boundary for dashboard
    if (dashboardError) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6">
                <div className="max-w-md mx-auto text-center">
                    <h2 className="text-lg font-semibold text-red-600 mb-4">Dashboard Error</h2>
                    <p className="text-gray-600 dark:text-gray-300 mb-6">{dashboardError}</p>
                    <div className="space-x-4">
                        <button
                            onClick={() => {
                                setDashboardError(null);
                                setDataVersion(v => v + 1);
                            }}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                            Retry
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Export PDF feature removed per request

    return (
        <div className="min-h-screen relative">
            {/* Loading overlay */}
            {isCalculating && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-2xl border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center space-x-3">
                            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                            <span className="text-gray-900 dark:text-gray-100 font-medium">
                                Calculating metrics for selected time period...
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal for uploading new reports */}
            {showUploadModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowUploadModal(false)} />
                    <div className="relative z-[61] w-[min(100%,900px)] max-h-[90vh] overflow-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">Upload New Reports</h3>
                            <button onClick={() => setShowUploadModal(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-5 h-5" /></button>
                        </div>
                        {/* Lightweight wizard suited for modal */}
                        <UploadWizard />
                    </div>
                </div>
            )}

            {/* Top header */}
            <div className="pt-4 sm:pt-6">
                <div className="max-w-7xl mx-auto">
                    <div className="p-6 sm:p-8 mb-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Performance Dashboard</h1>
                                {/* show business below title for PDF context */}
                                {businessName && (
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{businessName}</p>
                                )}
                                {/* Removed on-screen Range • Granularity summary */}
                            </div>
                            <div className="flex items-center gap-2 relative">
                                {/* Reports UI removed */}
                                {/* Upload */}
                                <button onClick={() => setShowUploadModal(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <UploadIcon className="h-4 w-4" />
                                    Upload New Reports
                                </button>
                                {/* Export PDF removed */}
                                {/* Account link removed per request; kept only in header */}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters bar */}
            <div className="sticky top-0 z-50 pt-2">
                <div className="max-w-7xl mx-auto px-4">
                    <div className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${stickyBar ? 'shadow-lg' : 'shadow-sm'} px-3 py-2`}>
                        <div className="flex items-center justify-center gap-3 flex-nowrap whitespace-nowrap">
                            {/* Manual first */}
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-4 h-4 text-gray-500" />
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Date Range:</span>
                                <input
                                    type="date"
                                    value={customFrom || ''}
                                    onChange={(e) => {
                                        const v = e.target.value || undefined;
                                        setCustomFrom(v);
                                        if (v && customTo && new Date(v) > new Date(customTo)) setCustomTo(v);
                                        setDateRange('custom');
                                    }}
                                    className="px-2 py-1 rounded text-xs border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                                />
                                <span className="text-xs text-gray-500">to</span>
                                <input
                                    type="date"
                                    value={customTo || ''}
                                    onChange={(e) => {
                                        const v = e.target.value || undefined;
                                        setCustomTo(v);
                                        if (v && customFrom && new Date(v) < new Date(customFrom)) setCustomFrom(v);
                                        setDateRange('custom');
                                    }}
                                    className="px-2 py-1 rounded text-xs border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                                />
                                {customActive && (
                                    <button
                                        onClick={() => { setCustomFrom(undefined); setCustomTo(undefined); setDateRange('30d'); }}
                                        className="ml-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            {/* Presets as dropdown (title inside dropdown) */}
                            <div className="flex flex-col items-start gap-1">
                                <div className="relative">
                                    <select
                                        value={dateRange === 'custom' ? '' : (dateRange as any)}
                                        onChange={(e) => {
                                            const v = (e.target.value || '30d') as any;
                                            setIsCalculating(true);

                                            // compute dates for inputs when using presets
                                            const to = new Date(REFERENCE_DATE);
                                            const toISO = (d: Date) => {
                                                const y = d.getFullYear();
                                                const m = String(d.getMonth() + 1).padStart(2, '0');
                                                const da = String(d.getDate()).padStart(2, '0');
                                                return `${y}-${m}-${da}`;
                                            };
                                            if (v === 'all') {
                                                const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow);
                                                const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime());
                                                const flowTs = flowSubset.map(f => f.sentDate.getTime());
                                                const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n));
                                                if (all.length) {
                                                    const from = new Date(Math.min(...all));
                                                    setCustomFrom(toISO(from));
                                                    setCustomTo(toISO(to));
                                                } else {
                                                    setCustomFrom(undefined);
                                                    setCustomTo(undefined);
                                                }
                                            } else {
                                                const days = parseInt(String(v).replace('d', ''));
                                                if (Number.isFinite(days)) {
                                                    const from = new Date(to); from.setDate(from.getDate() - days + 1);
                                                    setCustomFrom(toISO(from));
                                                    setCustomTo(toISO(to));
                                                }
                                            }
                                            setDateRange(v);

                                            // Add delay to show loading state, then hide it
                                            setTimeout(() => setIsCalculating(false), 1000);
                                        }}
                                        className="appearance-none px-2 py-1 pr-8 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                                    >
                                        <option value="" disabled>Presets</option>
                                        <option value="30d">Last 30 days</option>
                                        <option value="60d">Last 60 days</option>
                                        <option value="90d">Last 90 days</option>
                                        <option value="120d">Last 120 days</option>
                                        <option value="180d">Last 180 days</option>
                                        <option value="365d">Last 365 days</option>
                                        <option value="all">All time</option>
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <BarChart3 className="w-4 h-4 text-gray-500" />
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Granularity:</span>
                                <div className="flex gap-1.5 ml-2 flex-nowrap">
                                    {(['daily', 'weekly', 'monthly'] as const).map(g => (
                                        <button
                                            key={g}
                                            onClick={() => setGranularity(g)}
                                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors
                                                ${granularity === g
                                                    ? 'bg-purple-600 text-white border-purple-600'
                                                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}
                                        >
                                            {g.charAt(0).toUpperCase() + g.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content wrapper */}
            <div>
                {/* Data Coverage Notice updated to use last visible date from filters */}
                {hasData && (
                    <div className="py-3">
                        <div className="max-w-7xl mx-auto">
                            <div className="mx-4 sm:mx-6">
                                <div className="p-0 text-purple-700 dark:text-purple-200">
                                    <span className="text-xs">
                                        <span className="font-medium">Data Coverage Notice:</span>
                                        {(() => {
                                            const dates = [...defCampaigns, ...defFlows].map(e => e.sentDate.getTime());
                                            const lastVisible = dates.length ? new Date(Math.max(...dates)) : dm.getLastEmailDate();
                                            return ` All charts reflect data up to ${lastVisible.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`;
                                        })()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className={`${stickyBar ? 'mt-0' : ''} p-6`}>
                    <div className="max-w-7xl mx-auto space-y-8">
                        {/* Email Performance Overview */}
                        {overviewMetrics && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <Mail className="w-5 h-5 text-purple-600" />
                                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Email Performance Overview</h2>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    <div className="avoid-break"><MetricCard
                                        title="Total Revenue"
                                        value={formatCurrency(overviewMetrics.totalRevenue.value)}
                                        change={overviewMetrics.totalRevenue.change}
                                        isPositive={overviewMetrics.totalRevenue.isPositive}
                                        previousValue={overviewMetrics.totalRevenue.previousValue}
                                        previousPeriod={overviewMetrics.totalRevenue.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="revenue"
                                        sparklineData={overviewSeries.totalRevenue}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Average Order Value"
                                        value={formatCurrency(overviewMetrics.averageOrderValue.value)}
                                        change={overviewMetrics.averageOrderValue.change}
                                        isPositive={overviewMetrics.averageOrderValue.isPositive}
                                        previousValue={overviewMetrics.averageOrderValue.previousValue}
                                        previousPeriod={overviewMetrics.averageOrderValue.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="avgOrderValue"
                                        sparklineData={overviewSeries.averageOrderValue}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Revenue per Email"
                                        value={formatCurrency(overviewMetrics.revenuePerEmail.value)}
                                        change={overviewMetrics.revenuePerEmail.change}
                                        isPositive={overviewMetrics.revenuePerEmail.isPositive}
                                        previousValue={overviewMetrics.revenuePerEmail.previousValue}
                                        previousPeriod={overviewMetrics.revenuePerEmail.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="revenuePerEmail"
                                        sparklineData={overviewSeries.revenuePerEmail}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Open Rate"
                                        value={formatPercent(overviewMetrics.openRate.value)}
                                        change={overviewMetrics.openRate.change}
                                        isPositive={overviewMetrics.openRate.isPositive}
                                        previousValue={overviewMetrics.openRate.previousValue}
                                        previousPeriod={overviewMetrics.openRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="openRate"
                                        sparklineData={overviewSeries.openRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Click Rate"
                                        value={formatPercent(overviewMetrics.clickRate.value)}
                                        change={overviewMetrics.clickRate.change}
                                        isPositive={overviewMetrics.clickRate.isPositive}
                                        previousValue={overviewMetrics.clickRate.previousValue}
                                        previousPeriod={overviewMetrics.clickRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="clickRate"
                                        sparklineData={overviewSeries.clickRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Click-to-Open Rate"
                                        value={formatPercent(overviewMetrics.clickToOpenRate.value)}
                                        change={overviewMetrics.clickToOpenRate.change}
                                        isPositive={overviewMetrics.clickToOpenRate.isPositive}
                                        previousValue={overviewMetrics.clickToOpenRate.previousValue}
                                        previousPeriod={overviewMetrics.clickToOpenRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="clickToOpenRate"
                                        sparklineData={overviewSeries.clickToOpenRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Emails Sent"
                                        value={formatNumber(overviewMetrics.emailsSent.value)}
                                        change={overviewMetrics.emailsSent.change}
                                        isPositive={overviewMetrics.emailsSent.isPositive}
                                        previousValue={overviewMetrics.emailsSent.previousValue}
                                        previousPeriod={overviewMetrics.emailsSent.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="emailsSent"
                                        sparklineData={overviewSeries.emailsSent}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Total Orders"
                                        value={formatNumber(overviewMetrics.totalOrders.value)}
                                        change={overviewMetrics.totalOrders.change}
                                        isPositive={overviewMetrics.totalOrders.isPositive}
                                        previousValue={overviewMetrics.totalOrders.previousValue}
                                        previousPeriod={overviewMetrics.totalOrders.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="totalOrders"
                                        sparklineData={overviewSeries.totalOrders}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Conversion Rate"
                                        value={formatPercent(overviewMetrics.conversionRate.value)}
                                        change={overviewMetrics.conversionRate.change}
                                        isPositive={overviewMetrics.conversionRate.isPositive}
                                        previousValue={overviewMetrics.conversionRate.previousValue}
                                        previousPeriod={overviewMetrics.conversionRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="conversionRate"
                                        sparklineData={overviewSeries.conversionRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Unsubscribe Rate"
                                        value={formatPercent(overviewMetrics.unsubscribeRate.value)}
                                        change={overviewMetrics.unsubscribeRate.change}
                                        isPositive={overviewMetrics.unsubscribeRate.isPositive}
                                        previousValue={overviewMetrics.unsubscribeRate.previousValue}
                                        previousPeriod={overviewMetrics.unsubscribeRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="unsubscribeRate"
                                        sparklineData={overviewSeries.unsubscribeRate}
                                        isNegativeMetric
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Spam Rate"
                                        value={formatPercent(overviewMetrics.spamRate.value)}
                                        change={overviewMetrics.spamRate.change}
                                        isPositive={overviewMetrics.spamRate.isPositive}
                                        previousValue={overviewMetrics.spamRate.previousValue}
                                        previousPeriod={overviewMetrics.spamRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="spamRate"
                                        sparklineData={overviewSeries.spamRate}
                                        isNegativeMetric
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Bounce Rate"
                                        value={formatPercent(overviewMetrics.bounceRate.value)}
                                        change={overviewMetrics.bounceRate.change}
                                        isPositive={overviewMetrics.bounceRate.isPositive}
                                        previousValue={overviewMetrics.bounceRate.previousValue}
                                        previousPeriod={overviewMetrics.bounceRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="bounceRate"
                                        sparklineData={overviewSeries.bounceRate}
                                        isNegativeMetric
                                    /></div>
                                </div>
                            </section>
                        )}

                        {/* Campaign Performance */}
                        {campaignMetrics && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <Send className="w-5 h-5 text-purple-600" />
                                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Campaign Performance</h2>
                                    {/* Campaign dropdown removed: always showing all campaigns within date range */}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    <div className="avoid-break"><MetricCard
                                        title="Total Revenue"
                                        value={formatCurrency(campaignMetrics.totalRevenue.value)}
                                        change={campaignMetrics.totalRevenue.change}
                                        isPositive={campaignMetrics.totalRevenue.isPositive}
                                        previousValue={campaignMetrics.totalRevenue.previousValue}
                                        previousPeriod={campaignMetrics.totalRevenue.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="revenue"
                                        sparklineData={campaignSeries.totalRevenue}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Average Order Value"
                                        value={formatCurrency(campaignMetrics.averageOrderValue.value)}
                                        change={campaignMetrics.averageOrderValue.change}
                                        isPositive={campaignMetrics.averageOrderValue.isPositive}
                                        previousValue={campaignMetrics.averageOrderValue.previousValue}
                                        previousPeriod={campaignMetrics.averageOrderValue.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="avgOrderValue"
                                        sparklineData={campaignSeries.averageOrderValue}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Revenue per Email"
                                        value={formatCurrency(campaignMetrics.revenuePerEmail.value)}
                                        change={campaignMetrics.revenuePerEmail.change}
                                        isPositive={campaignMetrics.revenuePerEmail.isPositive}
                                        previousValue={campaignMetrics.revenuePerEmail.previousValue}
                                        previousPeriod={campaignMetrics.revenuePerEmail.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="revenuePerEmail"
                                        sparklineData={campaignSeries.revenuePerEmail}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Open Rate"
                                        value={formatPercent(campaignMetrics.openRate.value)}
                                        change={campaignMetrics.openRate.change}
                                        isPositive={campaignMetrics.openRate.isPositive}
                                        previousValue={campaignMetrics.openRate.previousValue}
                                        previousPeriod={campaignMetrics.openRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="openRate"
                                        sparklineData={campaignSeries.openRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Click Rate"
                                        value={formatPercent(campaignMetrics.clickRate.value)}
                                        change={campaignMetrics.clickRate.change}
                                        isPositive={campaignMetrics.clickRate.isPositive}
                                        previousValue={campaignMetrics.clickRate.previousValue}
                                        previousPeriod={campaignMetrics.clickRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="clickRate"
                                        sparklineData={campaignSeries.clickRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Click-to-Open Rate"
                                        value={formatPercent(campaignMetrics.clickToOpenRate.value)}
                                        change={campaignMetrics.clickToOpenRate.change}
                                        isPositive={campaignMetrics.clickToOpenRate.isPositive}
                                        previousValue={campaignMetrics.clickToOpenRate.previousValue}
                                        previousPeriod={campaignMetrics.clickToOpenRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="clickToOpenRate"
                                        sparklineData={campaignSeries.clickToOpenRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Emails Sent"
                                        value={formatNumber(campaignMetrics.emailsSent.value)}
                                        change={campaignMetrics.emailsSent.change}
                                        isPositive={campaignMetrics.emailsSent.isPositive}
                                        previousValue={campaignMetrics.emailsSent.previousValue}
                                        previousPeriod={campaignMetrics.emailsSent.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="emailsSent"
                                        sparklineData={campaignSeries.emailsSent}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Total Orders"
                                        value={formatNumber(campaignMetrics.totalOrders.value)}
                                        change={campaignMetrics.totalOrders.change}
                                        isPositive={campaignMetrics.totalOrders.isPositive}
                                        previousValue={campaignMetrics.totalOrders.previousValue}
                                        previousPeriod={campaignMetrics.totalOrders.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="totalOrders"
                                        sparklineData={campaignSeries.totalOrders}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Conversion Rate"
                                        value={formatPercent(campaignMetrics.conversionRate.value)}
                                        change={campaignMetrics.conversionRate.change}
                                        isPositive={campaignMetrics.conversionRate.isPositive}
                                        previousValue={campaignMetrics.conversionRate.previousValue}
                                        previousPeriod={campaignMetrics.conversionRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="conversionRate"
                                        sparklineData={campaignSeries.conversionRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Unsubscribe Rate"
                                        value={formatPercent(campaignMetrics.unsubscribeRate.value)}
                                        change={campaignMetrics.unsubscribeRate.change}
                                        isPositive={campaignMetrics.unsubscribeRate.isPositive}
                                        previousValue={campaignMetrics.unsubscribeRate.previousValue}
                                        previousPeriod={campaignMetrics.unsubscribeRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="unsubscribeRate"
                                        sparklineData={campaignSeries.unsubscribeRate}
                                        isNegativeMetric
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Spam Rate"
                                        value={formatPercent(campaignMetrics.spamRate.value)}
                                        change={campaignMetrics.spamRate.change}
                                        isPositive={campaignMetrics.spamRate.isPositive}
                                        previousValue={campaignMetrics.spamRate.previousValue}
                                        previousPeriod={campaignMetrics.spamRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="spamRate"
                                        sparklineData={campaignSeries.spamRate}
                                        isNegativeMetric
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Bounce Rate"
                                        value={formatPercent(campaignMetrics.bounceRate.value)}
                                        change={campaignMetrics.bounceRate.change}
                                        isPositive={campaignMetrics.bounceRate.isPositive}
                                        previousValue={campaignMetrics.bounceRate.previousValue}
                                        previousPeriod={campaignMetrics.bounceRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="bounceRate"
                                        sparklineData={campaignSeries.bounceRate}
                                        isNegativeMetric
                                    /></div>
                                </div>
                            </section>
                        )}

                        {/* Campaign Performance by Day/Hour */}
                        <div className="space-y-6">
                            <div className="avoid-break"><DayOfWeekPerformance filteredCampaigns={defCampaigns as any} dateRange={dateRange} /></div>
                            <div className="avoid-break"><HourOfDayPerformance filteredCampaigns={defCampaigns as any} dateRange={dateRange} /></div>
                        </div>

                        {/* Top Campaigns */}
                        {campaignMetrics && (
                            <section>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <Star className="w-5 h-5 text-purple-600" />
                                        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Top Campaigns ({getSortedCampaigns().length})</h3>
                                    </div>
                                    <div className="relative">
                                        <select
                                            value={selectedCampaignMetric}
                                            onChange={(e) => setSelectedCampaignMetric(e.target.value)}
                                            className="appearance-none px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                                        >
                                            {campaignMetricOptions.map(metric => (
                                                <option key={metric.value} value={metric.value}>{metric.label}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                                    </div>
                                </div>

                                <div className="border rounded-lg overflow-hidden border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                                    {getSortedCampaigns().slice(0, displayedCampaigns).map((campaign, index) => (
                                        <div key={campaign.id} className={`p-4 avoid-break ${index !== 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3 mb-1.5">
                                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium bg-purple-100 text-purple-900">{index + 1}</span>
                                                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{campaign.subject}</h4>
                                                    </div>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">Sent on {campaign.sentDate.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatMetricValue((campaign as any)[selectedCampaignMetric] as number, selectedCampaignMetric)}</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">{campaignMetricOptions.find(m => m.value === selectedCampaignMetric)?.label}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {(() => {
                                        const sorted = getSortedCampaigns();
                                        return displayedCampaigns < sorted.length && (
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-900/50">
                                                <button onClick={() => setDisplayedCampaigns(n => n + 5)} className="px-4 py-2 rounded-lg font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition-colors">
                                                    Load More ({Math.min(5, sorted.length - displayedCampaigns)} more)
                                                </button>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </section>
                        )}

                        {/* Flow Performance */}
                        {flowMetrics && (
                            <section>
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap className="w-5 h-5 text-purple-600" />
                                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Flow Performance</h2>
                                    <div className="ml-auto relative">
                                        <select
                                            value={selectedFlow}
                                            onChange={e => setSelectedFlow(e.target.value)}
                                            className="appearance-none px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                                        >
                                            <option value="all">All flows</option>
                                            {Array.from(new Set(ALL_FLOWS
                                                .filter(f => (f.status || '').toLowerCase() === 'live')
                                                .map(f => f.flowName)))
                                                .sort()
                                                .map(name => <option key={name} value={name}>{name}</option>)}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    <div className="avoid-break"><MetricCard
                                        title="Total Revenue"
                                        value={formatCurrency(flowMetrics.totalRevenue.value)}
                                        change={flowMetrics.totalRevenue.change}
                                        isPositive={flowMetrics.totalRevenue.isPositive}
                                        previousValue={flowMetrics.totalRevenue.previousValue}
                                        previousPeriod={flowMetrics.totalRevenue.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="revenue"
                                        sparklineData={flowSeries.totalRevenue}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Average Order Value"
                                        value={formatCurrency(flowMetrics.averageOrderValue.value)}
                                        change={flowMetrics.averageOrderValue.change}
                                        isPositive={flowMetrics.averageOrderValue.isPositive}
                                        previousValue={flowMetrics.averageOrderValue.previousValue}
                                        previousPeriod={flowMetrics.averageOrderValue.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="avgOrderValue"
                                        sparklineData={flowSeries.averageOrderValue}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Revenue per Email"
                                        value={formatCurrency(flowMetrics.revenuePerEmail.value)}
                                        change={flowMetrics.revenuePerEmail.change}
                                        isPositive={flowMetrics.revenuePerEmail.isPositive}
                                        previousValue={flowMetrics.revenuePerEmail.previousValue}
                                        previousPeriod={flowMetrics.revenuePerEmail.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="revenuePerEmail"
                                        sparklineData={flowSeries.revenuePerEmail}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Open Rate"
                                        value={formatPercent(flowMetrics.openRate.value)}
                                        change={flowMetrics.openRate.change}
                                        isPositive={flowMetrics.openRate.isPositive}
                                        previousValue={flowMetrics.openRate.previousValue}
                                        previousPeriod={flowMetrics.openRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="openRate"
                                        sparklineData={flowSeries.openRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Click Rate"
                                        value={formatPercent(flowMetrics.clickRate.value)}
                                        change={flowMetrics.clickRate.change}
                                        isPositive={flowMetrics.clickRate.isPositive}
                                        previousValue={flowMetrics.clickRate.previousValue}
                                        previousPeriod={flowMetrics.clickRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="clickRate"
                                        sparklineData={flowSeries.clickRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Click-to-Open Rate"
                                        value={formatPercent(flowMetrics.clickToOpenRate.value)}
                                        change={flowMetrics.clickToOpenRate.change}
                                        isPositive={flowMetrics.clickToOpenRate.isPositive}
                                        previousValue={flowMetrics.clickToOpenRate.previousValue}
                                        previousPeriod={flowMetrics.clickToOpenRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="clickToOpenRate"
                                        sparklineData={flowSeries.clickToOpenRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Emails Sent"
                                        value={formatNumber(flowMetrics.emailsSent.value)}
                                        change={flowMetrics.emailsSent.change}
                                        isPositive={flowMetrics.emailsSent.isPositive}
                                        previousValue={flowMetrics.emailsSent.previousValue}
                                        previousPeriod={flowMetrics.emailsSent.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="emailsSent"
                                        sparklineData={flowSeries.emailsSent}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Total Orders"
                                        value={formatNumber(flowMetrics.totalOrders.value)}
                                        change={flowMetrics.totalOrders.change}
                                        isPositive={flowMetrics.totalOrders.isPositive}
                                        previousValue={flowMetrics.totalOrders.previousValue}
                                        previousPeriod={flowMetrics.totalOrders.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="totalOrders"
                                        sparklineData={flowSeries.totalOrders}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Conversion Rate"
                                        value={formatPercent(flowMetrics.conversionRate.value)}
                                        change={flowMetrics.conversionRate.change}
                                        isPositive={flowMetrics.conversionRate.isPositive}
                                        previousValue={flowMetrics.conversionRate.previousValue}
                                        previousPeriod={flowMetrics.conversionRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="conversionRate"
                                        sparklineData={flowSeries.conversionRate}
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Unsubscribe Rate"
                                        value={formatPercent(flowMetrics.unsubscribeRate.value)}
                                        change={flowMetrics.unsubscribeRate.change}
                                        isPositive={flowMetrics.unsubscribeRate.isPositive}
                                        previousValue={flowMetrics.unsubscribeRate.previousValue}
                                        previousPeriod={flowMetrics.unsubscribeRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="unsubscribeRate"
                                        sparklineData={flowSeries.unsubscribeRate}
                                        isNegativeMetric
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Spam Rate"
                                        value={formatPercent(flowMetrics.spamRate.value)}
                                        change={flowMetrics.spamRate.change}
                                        isPositive={flowMetrics.spamRate.isPositive}
                                        previousValue={flowMetrics.spamRate.previousValue}
                                        previousPeriod={flowMetrics.spamRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="spamRate"
                                        sparklineData={flowSeries.spamRate}
                                        isNegativeMetric
                                    /></div>
                                    <div className="avoid-break"><MetricCard
                                        title="Bounce Rate"
                                        value={formatPercent(flowMetrics.bounceRate.value)}
                                        change={flowMetrics.bounceRate.change}
                                        isPositive={flowMetrics.bounceRate.isPositive}
                                        previousValue={flowMetrics.bounceRate.previousValue}
                                        previousPeriod={flowMetrics.bounceRate.previousPeriod}
                                        dateRange={dateRange}
                                        metricKey="bounceRate"
                                        sparklineData={flowSeries.bounceRate}
                                        isNegativeMetric
                                    /></div>
                                </div>
                            </section>
                        )}

                        {/* Flow Step Analysis (wrapper heading removed; component renders its own title) */}
                        <section>
                            <FlowStepAnalysis
                                dateRange={dateRange}
                                granularity={granularity}
                                customFrom={customFrom}
                                customTo={customTo}
                            />
                        </section>

                        {/* Audience Overview */}
                        <div><AudienceCharts /></div>

                        {/* Analyze Custom Segment (last) */}
                        <section>
                            <CustomSegmentBlock />
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
