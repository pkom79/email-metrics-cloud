"use client";
import React, { useMemo, useState, useEffect, useDeferredValue, useRef, useCallback } from 'react';
import { DataManager } from '../../lib/data/dataManager';
import MetricCard from './MetricCard';
import DayOfWeekPerformance from './DayOfWeekPerformance';
import HourOfDayPerformance from './HourOfDayPerformance';
import AudienceCharts from './AudienceCharts';
import FlowStepAnalysis from './FlowStepAnalysis';
import CustomSegmentBlock from './CustomSegmentBlock';
import { BarChart3, Calendar, ChevronDown, Mail, Send, Zap, Star, Upload as UploadIcon, X } from 'lucide-react';
import UploadWizard from '../../components/UploadWizard';
import { supabase } from '../../lib/supabase/client';

function formatCurrency(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function formatPercent(value: number) { const formatted = value.toFixed(2); const num = parseFloat(formatted); return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : `${formatted}%`; }
function formatNumber(value: number) { return Math.round(value).toLocaleString('en-US'); }

// Consolidated data loading function to prevent race conditions
async function loadAccountData(dm: any, accountId: string): Promise<boolean> {
    try {
        // Clear existing data before switching accounts
        if (typeof (dm as any).clearAllData === 'function') {
            (dm as any).clearAllData();
        }

        // Fetch snapshots for account
        const listResponse = await fetch(`/api/snapshots/list?account_id=${accountId}`, { cache: 'no-store' });
        if (!listResponse.ok) return false;

        const listData = await listResponse.json().catch(() => ({}));
        if (!listData.snapshots?.length) return false;

        // Fetch CSV files
        const csvTypes = ['campaigns', 'flows', 'subscribers'];
        const files: Record<string, File> = {};

        for (const type of csvTypes) {
            try {
                const csvResponse = await fetch(`/api/snapshots/download-csv?type=${type}&account_id=${accountId}`, { cache: 'no-store' });
                if (csvResponse.ok) {
                    const text = await csvResponse.text();
                    if (text.trim()) {
                        const blob = new Blob([text], { type: 'text/csv' });
                        files[type] = new File([blob], `${type}.csv`, { type: 'text/csv' });
                    }
                }
            } catch (error) {
                console.warn(`Failed to load ${type} CSV:`, error);
            }
        }

        if (Object.keys(files).length > 0) {
            await dm.loadCSVFiles({
                campaigns: files.campaigns,
                flows: files.flows,
                subscribers: files.subscribers
            });
            return true;
        }

        return false;
    } catch (error) {
        console.error('Failed to load account data:', error);
        return false;
    }
}

export default function DashboardHeavy({ businessName, userId }: { businessName?: string; userId?: string }) {
    // Set user ID for data isolation
    useEffect(() => { if (userId) DataManager.setUserId(userId); }, [userId]);
    const dm = useMemo(() => DataManager.getInstance(), []);

    const [dashboardError, setDashboardError] = useState<string | null>(null);
    const [dataVersion, setDataVersion] = useState(0);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isCalculating, setIsCalculating] = useState(false);
    const [metricsReady, setMetricsReady] = useState(false); // unified readiness gate
    const [dateRange, setDateRange] = useState<'30d' | '60d' | '90d' | '120d' | '180d' | '365d' | 'all' | 'custom'>('30d');
    const [customFrom, setCustomFrom] = useState<string | undefined>();
    const [customTo, setCustomTo] = useState<string | undefined>();
    const customActive = dateRange === 'custom' && customFrom && customTo;
    const customDays = useMemo(() => { if (!customActive) return 0; const from = new Date(customFrom!); from.setHours(0, 0, 0, 0); const to = new Date(customTo!); to.setHours(23, 59, 59, 999); const diff = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1; return Math.max(diff, 1); }, [customActive, customFrom, customTo]);
    const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    const [selectedFlow, setSelectedFlow] = useState('all');
    const [selectedCampaignMetric, setSelectedCampaignMetric] = useState('revenue');
    const [displayedCampaigns, setDisplayedCampaigns] = useState(5);
    const [stickyBar, setStickyBar] = useState(false);
    const [showCustomDateModal, setShowCustomDateModal] = useState(false);
    const [audienceOverviewRef, setAudienceOverviewRef] = useState<HTMLElement | null>(null);
    const [isBeforeAudience, setIsBeforeAudience] = useState(true);
    // Admin accounts selector state
    const [isAdmin, setIsAdmin] = useState(false);
    const [allAccounts, setAllAccounts] = useState<any[] | null>(null);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    // Human readable label for currently selected admin account
    const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>('');

    // Load admin accounts once (no dependency on selectedAccountId to avoid re-fetch loops)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const sessionResp = await supabase.auth.getSession();
                const s = sessionResp.data.session;
                const admin = s?.user?.app_metadata?.role === 'admin';
                if (!admin) return; // not admin, skip
                setIsAdmin(true);

                const r = await fetch('/api/accounts', { cache: 'no-store' });
                if (!r.ok) throw new Error(`Accounts ${r.status}`);
                const j = await r.json();
                if (cancelled) return;
                const list = (j.accounts || []).map((a: any) => ({
                    id: a.id,
                    businessName: a.businessName || null,
                    label: a.label || a.businessName || a.id?.slice(0, 8) || 'Account'
                }));
                setAllAccounts(list);
                if (!selectedAccountId && list.length) {
                    setSelectedAccountId(list[0].id);
                    setSelectedAccountLabel(list[0].label);
                }
            } catch (e: any) {
                if (!cancelled) setAccountsError(e?.message || 'Failed to load accounts');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Admin: reload data when selectedAccountId changes (stable, uses helper)
    useEffect(() => {
        if (!isAdmin || !selectedAccountId) return;
        let cancelled = false;
        (async () => {
            setIsInitialLoading(true);
            setMetricsReady(false);
            try {
                (dm as any).clearAllData?.();
            } catch { /* ignore */ }
            const success = await (async () => {
                try {
                    const listResp = await fetch(`/api/snapshots/list?account_id=${selectedAccountId}`, { cache: 'no-store' });
                    if (!listResp.ok) return false;
                    const j = await listResp.json().catch(() => ({}));
                    if (!j.snapshots?.length) return false;
                    const csvTypes = ['campaigns', 'flows', 'subscribers'];
                    const files: Record<string, File> = {};
                    for (const t of csvTypes) {
                        const r = await fetch(`/api/snapshots/download-csv?type=${t}&account_id=${selectedAccountId}`, { cache: 'no-store' });
                        if (r.ok) {
                            const text = await r.text();
                            if (text.trim()) {
                                const blob = new Blob([text], { type: 'text/csv' });
                                files[t] = new File([blob], `${t}.csv`, { type: 'text/csv' });
                            }
                        }
                    }
                    if (!Object.keys(files).length) return false;
                    await dm.loadCSVFiles({ campaigns: files.campaigns, flows: files.flows, subscribers: files.subscribers });
                    return true;
                } catch {
                    return false;
                }
            })();
            if (!cancelled) {
                if (success) setDataVersion(v => v + 1);
                setIsInitialLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin, selectedAccountId, dm]);

    // Events / hydration
    const [showUploadModal, setShowUploadModal] = useState(false);
    useEffect(() => { const onCreated = () => { setDataVersion(v => v + 1); setShowUploadModal(false); }; const onHydrated = () => { setDataVersion(v => v + 1); setIsInitialLoading(false); }; window.addEventListener('em:snapshot-created', onCreated as EventListener); window.addEventListener('em:dataset-hydrated', onHydrated as EventListener); let active = true; (async () => { for (let i = 0; i < 5 && active; i++) { const ok = await DataManager.getInstance().ensureHydrated(); if (ok) { setDataVersion(v => v + 1); setIsInitialLoading(false); break; } await new Promise(r => setTimeout(r, 150)); } if (active && !DataManager.getInstance().hasRealData()) setIsInitialLoading(false); })(); return () => { active = false; window.removeEventListener('em:snapshot-created', onCreated as EventListener); window.removeEventListener('em:dataset-hydrated', onHydrated as EventListener); }; }, [userId]);

    // Server snapshot CSV fallback
    useEffect(() => { let cancelled = false; (async () => { try { if (dm.getCampaigns().length || dm.getFlowEmails().length || dm.getSubscribers().length) { setIsInitialLoading(false); return; } const list = await fetch('/api/snapshots/list', { cache: 'no-store' }); if (!list.ok) { setIsInitialLoading(false); return; } const j = await list.json().catch(() => ({})); const latest = (j.snapshots || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]; if (!latest?.id) { setIsInitialLoading(false); return; } const csvTypes = ['campaigns', 'flows', 'subscribers']; const csvFiles: Record<string, File> = {}; for (const t of csvTypes) { try { const r = await fetch(`/api/snapshots/download-csv?type=${t}`, { cache: 'no-store' }); if (r.ok) { const csv = await r.text(); if (csv.trim()) { const blob = new Blob([csv], { type: 'text/csv' }); csvFiles[t] = new File([blob], `${t}.csv`, { type: 'text/csv' }); } } } catch { } } if (Object.keys(csvFiles).length) { const result = await dm.loadCSVFiles({ campaigns: csvFiles.campaigns, flows: csvFiles.flows, subscribers: csvFiles.subscribers }); if (result.success) { if (cancelled) return; setDataVersion(v => v + 1); setIsInitialLoading(false); window.dispatchEvent(new CustomEvent('em:dataset-hydrated')); } else { setDashboardError('Failed to process server data'); setIsInitialLoading(false); } } else { setIsInitialLoading(false); } } catch (e: any) { setDashboardError(`Failed to load data: ${e?.message || 'Unknown'}`); setIsInitialLoading(false); } })(); return () => { cancelled = true }; }, [dm]);

    // Safe granularity
    const safeGranularity = useMemo(() => { try { if (dm.getCampaigns().length === 0 && dm.getFlowEmails().length === 0) return 'daily'; if (customActive && customDays > 0) return dm.getGranularityForDateRange(`${customDays}d`); if (dateRange === 'all') return dm.getGranularityForDateRange('all'); return dm.getGranularityForDateRange(dateRange === 'custom' ? '30d' : dateRange); } catch { return 'daily'; } }, [dateRange, customActive, customDays, dm]);
    useEffect(() => { setGranularity(safeGranularity); }, [safeGranularity]);

    // Sticky observer (desktop only now)
    useEffect(() => { if (!audienceOverviewRef) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setIsBeforeAudience(false); setStickyBar(false); } else { setIsBeforeAudience(true); setStickyBar(window.scrollY > 100); } }, { root: null, rootMargin: '0px 0px -85% 0px', threshold: 0 }); observer.observe(audienceOverviewRef); const onScroll = () => { if (!isBeforeAudience) return; setStickyBar(window.scrollY > 100); }; window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll); }; }, [audienceOverviewRef, isBeforeAudience]);

    // Base data
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ALL_CAMPAIGNS = useMemo(() => dm.getCampaigns(), [dm, dataVersion]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ALL_FLOWS = useMemo(() => dm.getFlowEmails(), [dm, dataVersion]);
    const hasData = ALL_CAMPAIGNS.length > 0 || ALL_FLOWS.length > 0;
    const REFERENCE_DATE = useMemo(() => { const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow); const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime()); const flowTs = flowSubset.map(f => f.sentDate.getTime()); const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n)); return all.length ? new Date(Math.max(...all)) : new Date(); }, [ALL_CAMPAIGNS, ALL_FLOWS, selectedFlow]);
    // Active flows: flows that have at least one send in the currently selected (or custom) date range
    // Mirror FlowStepAnalysis logic: restrict dropdown to *live* flows only, further filtered to current date window
    const liveFlows = useMemo(() => ALL_FLOWS.filter(f => (f as any).status && String((f as any).status).toLowerCase() === 'live'), [ALL_FLOWS]);
    const flowsInRange = useMemo(() => {
        if (!liveFlows.length) return [] as typeof liveFlows;
        let flows = liveFlows;
        if (dateRange === 'custom' && customActive) {
            const from = new Date(customFrom! + 'T00:00:00');
            const to = new Date(customTo! + 'T23:59:59');
            flows = flows.filter(f => f.sentDate >= from && f.sentDate <= to);
        } else if (dateRange !== 'all') {
            const days = parseInt(dateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            flows = flows.filter(f => f.sentDate >= start && f.sentDate <= end);
        }
        return flows;
    }, [liveFlows, dateRange, customActive, customFrom, customTo, REFERENCE_DATE]);
    const uniqueFlowNames = useMemo(() => Array.from(new Set(flowsInRange.map(f => f.flowName))).sort(), [flowsInRange]);
    // Ensure selected flow remains valid; if not, reset to 'all'
    useEffect(() => { if (selectedFlow !== 'all' && !uniqueFlowNames.includes(selectedFlow)) setSelectedFlow('all'); }, [uniqueFlowNames, selectedFlow]);

    // Filters
    const filteredCampaigns = useMemo(() => { if (!hasData) return [] as typeof ALL_CAMPAIGNS; let list = ALL_CAMPAIGNS; if (dateRange === 'custom' && customActive) { const from = new Date(customFrom! + 'T00:00:00'); const to = new Date(customTo! + 'T23:59:59'); list = list.filter(c => c.sentDate >= from && c.sentDate <= to); } else if (dateRange !== 'all') { const days = parseInt(dateRange.replace('d', '')); const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999); const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0); list = list.filter(c => c.sentDate >= start && c.sentDate <= end); } return list; }, [ALL_CAMPAIGNS, dateRange, REFERENCE_DATE, hasData, customActive, customFrom, customTo]);
    const filteredFlowEmails = useMemo(() => { if (!hasData) return [] as typeof ALL_FLOWS; let flows = ALL_FLOWS; if (selectedFlow !== 'all') flows = flows.filter(f => f.flowName === selectedFlow); if (dateRange === 'custom' && customActive) { const from = new Date(customFrom! + 'T00:00:00'); const to = new Date(customTo! + 'T23:59:59'); flows = flows.filter(f => f.sentDate >= from && f.sentDate <= to); } else if (dateRange !== 'all') { const days = parseInt(dateRange.replace('d', '')); const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999); const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0); flows = flows.filter(f => f.sentDate >= start && f.sentDate <= end); } return flows; }, [ALL_FLOWS, selectedFlow, dateRange, REFERENCE_DATE, hasData, customActive, customFrom, customTo]);

    // PoP
    const calcPoP = useCallback((metricKey: string, dataset: 'all' | 'campaigns' | 'flows', options?: { flowName?: string }) => {
        // Map our metric keys to DataManager keys if needed
        const keyMap: Record<string, string> = { avgOrderValue: 'avgOrderValue', averageOrderValue: 'avgOrderValue' };
        const dmKey = keyMap[metricKey] || metricKey;
    let effectiveRange: string = dateRange as string;
        if (dateRange === 'custom' && customActive && customFrom && customTo) {
            effectiveRange = `custom:${customFrom}:${customTo}`;
        }
        if (effectiveRange === 'all') {
            return { changePercent: 0, isPositive: true, previousValue: 0, previousPeriod: undefined as any };
        }
    const res = dm.calculatePeriodOverPeriodChange(dmKey, effectiveRange as string, dataset, { flowName: options?.flowName });
        return { changePercent: res.changePercent, isPositive: res.isPositive, previousValue: res.previousValue, previousPeriod: res.previousPeriod };
    }, [dateRange, customActive, customFrom, customTo, dm]);

    const defCampaigns = useDeferredValue(filteredCampaigns);
    const defFlows = useDeferredValue(filteredFlowEmails);

    // Sync custom inputs with preset
    useEffect(() => { if (!hasData) return; if (dateRange === 'custom') return; const to = new Date(REFERENCE_DATE); const toISO = (d: Date) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${da}`; }; if (dateRange === 'all') { const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow); const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime()); const flowTs = flowSubset.map(f => f.sentDate.getTime()); const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n)); if (all.length) { const from = new Date(Math.min(...all)); setCustomFrom(toISO(from)); setCustomTo(toISO(to)); } else { setCustomFrom(undefined); setCustomTo(undefined); } } else { const days = parseInt(String(dateRange).replace('d', '')); if (Number.isFinite(days)) { const from = new Date(to); from.setDate(from.getDate() - days + 1); setCustomFrom(toISO(from)); setCustomTo(toISO(to)); } } }, [dateRange, REFERENCE_DATE, selectedFlow, ALL_CAMPAIGNS, ALL_FLOWS, hasData]);

    // Metrics calculations
    const overviewMetrics = useMemo(() => { const all = [...defCampaigns, ...defFlows]; if (!all.length) return null as any; const totalRevenue = all.reduce((s, e) => s + e.revenue, 0); const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0); const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0); const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0); const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0); const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0); const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0); const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0); const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0; const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0; const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0; const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0; const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0; const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0; const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0; const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0; const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0; const mk = (k: string, v: number) => { const d = calcPoP(k, 'all'); return { value: v, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod }; }; return { totalRevenue: mk('totalRevenue', totalRevenue), averageOrderValue: mk('avgOrderValue', avgOrderValue), revenuePerEmail: mk('revenuePerEmail', revenuePerEmail), openRate: mk('openRate', openRate), clickRate: mk('clickRate', clickRate), clickToOpenRate: mk('clickToOpenRate', clickToOpenRate), emailsSent: mk('emailsSent', totalEmailsSent), totalOrders: mk('totalOrders', totalOrders), conversionRate: mk('conversionRate', conversionRate), unsubscribeRate: mk('unsubscribeRate', unsubscribeRate), spamRate: mk('spamRate', spamRate), bounceRate: mk('bounceRate', bounceRate) }; }, [defCampaigns, defFlows, calcPoP]);
    const campaignMetrics = useMemo(() => { const all = defCampaigns; if (!all.length) return null as any; const totalRevenue = all.reduce((s, e) => s + e.revenue, 0); const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0); const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0); const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0); const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0); const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0); const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0); const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0); const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0; const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0; const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0; const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0; const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0; const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0; const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0; const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0; const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0; const mk = (k: string, v: number) => { const d = calcPoP(k, 'campaigns'); return { value: v, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod }; }; return { totalRevenue: mk('totalRevenue', totalRevenue), averageOrderValue: mk('avgOrderValue', avgOrderValue), revenuePerEmail: mk('revenuePerEmail', revenuePerEmail), openRate: mk('openRate', openRate), clickRate: mk('clickRate', clickRate), clickToOpenRate: mk('clickToOpenRate', clickToOpenRate), emailsSent: mk('emailsSent', totalEmailsSent), totalOrders: mk('totalOrders', totalOrders), conversionRate: mk('conversionRate', conversionRate), unsubscribeRate: mk('unsubscribeRate', unsubscribeRate), spamRate: mk('spamRate', spamRate), bounceRate: mk('bounceRate', bounceRate) }; }, [defCampaigns, calcPoP]);
    const flowMetrics = useMemo(() => { const all = defFlows; if (!all.length) return null as any; const totalRevenue = all.reduce((s, e) => s + e.revenue, 0); const totalEmailsSent = all.reduce((s, e) => s + e.emailsSent, 0); const totalOrders = all.reduce((s, e) => s + e.totalOrders, 0); const totalOpens = all.reduce((s, e) => s + e.uniqueOpens, 0); const totalClicks = all.reduce((s, e) => s + e.uniqueClicks, 0); const totalUnsubs = all.reduce((s, e) => s + e.unsubscribesCount, 0); const totalSpam = all.reduce((s, e) => s + e.spamComplaintsCount, 0); const totalBounces = all.reduce((s, e) => s + e.bouncesCount, 0); const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0; const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0; const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0; const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0; const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0; const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0; const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0; const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0; const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0; const mk = (k: string, v: number) => { const d = calcPoP(k, 'flows', { flowName: selectedFlow }); return { value: v, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod }; }; return { totalRevenue: mk('totalRevenue', totalRevenue), averageOrderValue: mk('avgOrderValue', avgOrderValue), revenuePerEmail: mk('revenuePerEmail', revenuePerEmail), openRate: mk('openRate', openRate), clickRate: mk('clickRate', clickRate), clickToOpenRate: mk('clickToOpenRate', clickToOpenRate), emailsSent: mk('emailsSent', totalEmailsSent), totalOrders: mk('totalOrders', totalOrders), conversionRate: mk('conversionRate', conversionRate), unsubscribeRate: mk('unsubscribeRate', unsubscribeRate), spamRate: mk('spamRate', spamRate), bounceRate: mk('bounceRate', bounceRate) }; }, [defFlows, calcPoP, selectedFlow]);

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

    // Unified readiness effect
    useEffect(() => { if (isInitialLoading) { setMetricsReady(false); return; } if (!hasData) { setMetricsReady(true); return; } if (overviewMetrics && campaignMetrics && flowMetrics) { requestAnimationFrame(() => setMetricsReady(true)); } }, [isInitialLoading, hasData, overviewMetrics, campaignMetrics, flowMetrics]);

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
    const formatMetricValue = (v: number, metric: string) => { if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) return formatCurrency(v); if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) return formatPercent(v); return formatNumber(v); };
    const getSortedCampaigns = () => [...defCampaigns].sort((a, b) => { const av = Number((a as any)[selectedCampaignMetric]) || 0; const bv = Number((b as any)[selectedCampaignMetric]) || 0; return bv - av; });

    // If admin and there are zero accounts, don't block UI with overlay after initial load
    const noAccounts = isAdmin && (allAccounts?.length === 0);
    const showOverlay = (isInitialLoading && !noAccounts) || isCalculating || (!metricsReady && !noAccounts);

    if (dashboardError) { return <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md mx-auto text-center"><h2 className="text-lg font-semibold text-red-600 mb-4">Dashboard Error</h2><p className="text-gray-600 dark:text-gray-300 mb-6">{dashboardError}</p><div className="space-x-4"><button onClick={() => { setDashboardError(null); setDataVersion(v => v + 1); }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button><button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Reload Page</button></div></div></div>; }

    return (
        <div className="min-h-screen relative">
            {showOverlay && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-xl px-8 py-6 shadow-2xl border border-gray-200 dark:border-gray-700 flex items-center gap-3">
                        <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                        <span className="text-gray-900 dark:text-gray-100 font-medium text-sm">{isInitialLoading ? 'Loading data…' : 'Calculating metrics…'}</span>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="pt-4 sm:pt-6"><div className="max-w-7xl mx-auto"><div className="p-6 sm:p-8 mb-4"><div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Performance Dashboard</h1>{businessName && <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{businessName}</p>}</div><div className="flex items-center gap-3 relative">{!isAdmin && (<button onClick={() => setShowUploadModal(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><UploadIcon className="h-4 w-4" />Upload New Reports</button>)}{isAdmin && (<div className="relative"><select value={selectedAccountId} onChange={e => { setSelectedAccountId(e.target.value); const a = (allAccounts || []).find(x => x.id === e.target.value); setSelectedAccountLabel(a?.label || a?.businessName || a?.id || ''); }} className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-purple-300/70 dark:border-purple-400/40 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 min-w-[240px] font-medium focus:outline-none focus:ring-2 focus:ring-purple-400">{!selectedAccountId && <option value="">Select account…</option>}{(allAccounts || []).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select><ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" /></div>)}</div></div></div></div></div>
            {showUploadModal && !isAdmin && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowUploadModal(false)} />
                    <div className="relative z-[61] w-[min(100%,900px)] max-h-[90vh] overflow-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-6">
                        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold">Upload New Reports</h3><button onClick={() => setShowUploadModal(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-5 h-5" /></button></div>
                        <UploadWizard />
                    </div>
                </div>
            )}
            {/* Filters bar (sticky) */}
            <div className={`hidden sm:block sm:pt-2 ${stickyBar ? 'sm:sticky sm:top-0 sm:z-50' : ''}`}> <div className="max-w-7xl mx-auto px-4"><div className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${stickyBar ? 'shadow-lg' : 'shadow-sm'} px-3 py-2`}>
                <div className="hidden sm:flex items-center justify-center gap-3 flex-nowrap whitespace-nowrap">
                    {/* Custom date inputs */}
                    <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Date Range:</span>
                        <input type="date" value={customFrom || ''} onChange={e => { const v = e.target.value || undefined; setCustomFrom(v); if (v && customTo && new Date(v) > new Date(customTo)) setCustomTo(v); setDateRange('custom'); setMetricsReady(false); }} className="px-2 py-1 rounded text-xs border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100" />
                        <span className="text-xs text-gray-500">to</span>
                        <input type="date" value={customTo || ''} onChange={e => { const v = e.target.value || undefined; setCustomTo(v); if (v && customFrom && new Date(v) < new Date(customFrom)) setCustomFrom(v); setDateRange('custom'); setMetricsReady(false); }} className="px-2 py-1 rounded text-xs border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100" />
                        {customActive && <button onClick={() => { setCustomFrom(undefined); setCustomTo(undefined); setDateRange('30d'); setMetricsReady(false); }} className="ml-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700">Clear</button>}
                    </div>
                    <div className="flex flex-col items-start gap-1"><div className="relative"><select value={dateRange === 'custom' ? '' : dateRange} onChange={e => { const v = (e.target.value || '30d') as any; setIsCalculating(true); setMetricsReady(false); const to = new Date(REFERENCE_DATE); const toISO = (d: Date) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${da}`; }; if (v === 'all') { const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow); const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime()); const flowTs = flowSubset.map(f => f.sentDate.getTime()); const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n)); if (all.length) { const from = new Date(Math.min(...all)); setCustomFrom(toISO(from)); setCustomTo(toISO(to)); } else { setCustomFrom(undefined); setCustomTo(undefined); } } else { const days = parseInt(String(v).replace('d', '')); if (Number.isFinite(days)) { const from = new Date(to); from.setDate(from.getDate() - days + 1); setCustomFrom(toISO(from)); setCustomTo(toISO(to)); } } setDateRange(v); setTimeout(() => { setIsCalculating(false); }, 800); }} className="appearance-none px-2 py-1 pr-8 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs">
                        <option value="" disabled>Presets</option>
                        <option value="30d">Last 30 days</option>
                        <option value="60d">Last 60 days</option>
                        <option value="90d">Last 90 days</option>
                        <option value="120d">Last 120 days</option>
                        <option value="180d">Last 180 days</option>
                        <option value="365d">Last 365 days</option>
                        <option value="all">All time</option>
                    </select><ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" /></div></div>
                    <div className="flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-gray-500" /><span className="font-medium text-sm text-gray-900 dark:text-gray-100">Granularity:</span><div className="flex gap-1.5 ml-2 flex-nowrap">{(['daily', 'weekly', 'monthly'] as const).map(g => <button key={g} onClick={() => { setGranularity(g); setMetricsReady(false); }} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${granularity === g ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>{g.charAt(0).toUpperCase() + g.slice(1)}</button>)}</div></div>
                </div></div></div></div>
            {/* Data coverage notice */}
            {hasData && (<div className="py-3"><div className="max-w-7xl mx-auto"><div className="mx-4 sm:mx-6"><div className="p-0 text-purple-700 dark:text-purple-200"><span className="text-xs"><span className="font-medium">Data Coverage Notice:</span>{(() => { const dates = [...defCampaigns, ...defFlows].map(e => e.sentDate.getTime()); const lastVisible = dates.length ? new Date(Math.max(...dates)) : dm.getLastEmailDate(); return ` All dashboard metrics reflect email channel performance only and exclude SMS-attributed revenue through ${lastVisible.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`; })()}</span></div></div></div></div>)}
            {/* Main content */}
            <div className="p-6"><div className="max-w-7xl mx-auto space-y-8">
                {overviewMetrics && (
                    <section>
                        <div className="flex items-center gap-2 mb-3"><Mail className="w-5 h-5 text-purple-600" /><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Email Performance Overview</h2></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            <MetricCard title="Total Revenue" value={formatCurrency(overviewMetrics.totalRevenue.value)} change={overviewMetrics.totalRevenue.change} isPositive={overviewMetrics.totalRevenue.isPositive} previousValue={overviewMetrics.totalRevenue.previousValue} previousPeriod={overviewMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={overviewSeries.totalRevenue} />
                            <MetricCard title="Average Order Value" value={formatCurrency(overviewMetrics.averageOrderValue.value)} change={overviewMetrics.averageOrderValue.change} isPositive={overviewMetrics.averageOrderValue.isPositive} previousValue={overviewMetrics.averageOrderValue.previousValue} previousPeriod={overviewMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={overviewSeries.averageOrderValue} />
                            <MetricCard title="Revenue per Email" value={formatCurrency(overviewMetrics.revenuePerEmail.value)} change={overviewMetrics.revenuePerEmail.change} isPositive={overviewMetrics.revenuePerEmail.isPositive} previousValue={overviewMetrics.revenuePerEmail.previousValue} previousPeriod={overviewMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={overviewSeries.revenuePerEmail} />
                            <MetricCard title="Emails Sent" value={formatNumber(overviewMetrics.emailsSent.value)} change={overviewMetrics.emailsSent.change} isPositive={overviewMetrics.emailsSent.isPositive} previousValue={overviewMetrics.emailsSent.previousValue} previousPeriod={overviewMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={overviewSeries.emailsSent} />
                            <MetricCard title="Total Orders" value={formatNumber(overviewMetrics.totalOrders.value)} change={overviewMetrics.totalOrders.change} isPositive={overviewMetrics.totalOrders.isPositive} previousValue={overviewMetrics.totalOrders.previousValue} previousPeriod={overviewMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={overviewSeries.totalOrders} />
                            <MetricCard title="Open Rate" value={formatPercent(overviewMetrics.openRate.value)} change={overviewMetrics.openRate.change} isPositive={overviewMetrics.openRate.isPositive} previousValue={overviewMetrics.openRate.previousValue} previousPeriod={overviewMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={overviewSeries.openRate} />
                            <MetricCard title="Click Rate" value={formatPercent(overviewMetrics.clickRate.value)} change={overviewMetrics.clickRate.change} isPositive={overviewMetrics.clickRate.isPositive} previousValue={overviewMetrics.clickRate.previousValue} previousPeriod={overviewMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={overviewSeries.clickRate} />
                            <MetricCard title="Click-to-Open Rate" value={formatPercent(overviewMetrics.clickToOpenRate.value)} change={overviewMetrics.clickToOpenRate.change} isPositive={overviewMetrics.clickToOpenRate.isPositive} previousValue={overviewMetrics.clickToOpenRate.previousValue} previousPeriod={overviewMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={overviewSeries.clickToOpenRate} />
                            <MetricCard title="Conversion Rate" value={formatPercent(overviewMetrics.conversionRate.value)} change={overviewMetrics.conversionRate.change} isPositive={overviewMetrics.conversionRate.isPositive} previousValue={overviewMetrics.conversionRate.previousValue} previousPeriod={overviewMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={overviewSeries.conversionRate} />
                            <MetricCard title="Unsubscribe Rate" value={formatPercent(overviewMetrics.unsubscribeRate.value)} change={overviewMetrics.unsubscribeRate.change} isPositive={overviewMetrics.unsubscribeRate.isPositive} previousValue={overviewMetrics.unsubscribeRate.previousValue} previousPeriod={overviewMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={overviewSeries.unsubscribeRate} />
                            <MetricCard title="Spam Rate" value={formatPercent(overviewMetrics.spamRate.value)} change={overviewMetrics.spamRate.change} isPositive={overviewMetrics.spamRate.isPositive} previousValue={overviewMetrics.spamRate.previousValue} previousPeriod={overviewMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={overviewSeries.spamRate} />
                            <MetricCard title="Bounce Rate" value={formatPercent(overviewMetrics.bounceRate.value)} change={overviewMetrics.bounceRate.change} isPositive={overviewMetrics.bounceRate.isPositive} previousValue={overviewMetrics.bounceRate.previousValue} previousPeriod={overviewMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={overviewSeries.bounceRate} />
                        </div>
                    </section>
                )}
                {campaignMetrics && (
                    <section>
                        <div className="flex items-center gap-2 mb-3"><Send className="w-5 h-5 text-purple-600" /><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Campaign Performance</h2></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            <MetricCard title="Total Revenue" value={formatCurrency(campaignMetrics.totalRevenue.value)} change={campaignMetrics.totalRevenue.change} isPositive={campaignMetrics.totalRevenue.isPositive} previousValue={campaignMetrics.totalRevenue.previousValue} previousPeriod={campaignMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={campaignSeries.totalRevenue} />
                            <MetricCard title="Average Order Value" value={formatCurrency(campaignMetrics.averageOrderValue.value)} change={campaignMetrics.averageOrderValue.change} isPositive={campaignMetrics.averageOrderValue.isPositive} previousValue={campaignMetrics.averageOrderValue.previousValue} previousPeriod={campaignMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={campaignSeries.averageOrderValue} />
                            <MetricCard title="Revenue per Email" value={formatCurrency(campaignMetrics.revenuePerEmail.value)} change={campaignMetrics.revenuePerEmail.change} isPositive={campaignMetrics.revenuePerEmail.isPositive} previousValue={campaignMetrics.revenuePerEmail.previousValue} previousPeriod={campaignMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={campaignSeries.revenuePerEmail} />
                            <MetricCard title="Emails Sent" value={formatNumber(campaignMetrics.emailsSent.value)} change={campaignMetrics.emailsSent.change} isPositive={campaignMetrics.emailsSent.isPositive} previousValue={campaignMetrics.emailsSent.previousValue} previousPeriod={campaignMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={campaignSeries.emailsSent} />
                            <MetricCard title="Total Orders" value={formatNumber(campaignMetrics.totalOrders.value)} change={campaignMetrics.totalOrders.change} isPositive={campaignMetrics.totalOrders.isPositive} previousValue={campaignMetrics.totalOrders.previousValue} previousPeriod={campaignMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={campaignSeries.totalOrders} />
                            <MetricCard title="Open Rate" value={formatPercent(campaignMetrics.openRate.value)} change={campaignMetrics.openRate.change} isPositive={campaignMetrics.openRate.isPositive} previousValue={campaignMetrics.openRate.previousValue} previousPeriod={campaignMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={campaignSeries.openRate} />
                            <MetricCard title="Click Rate" value={formatPercent(campaignMetrics.clickRate.value)} change={campaignMetrics.clickRate.change} isPositive={campaignMetrics.clickRate.isPositive} previousValue={campaignMetrics.clickRate.previousValue} previousPeriod={campaignMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={campaignSeries.clickRate} />
                            <MetricCard title="Click-to-Open Rate" value={formatPercent(campaignMetrics.clickToOpenRate.value)} change={campaignMetrics.clickToOpenRate.change} isPositive={campaignMetrics.clickToOpenRate.isPositive} previousValue={campaignMetrics.clickToOpenRate.previousValue} previousPeriod={campaignMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={campaignSeries.clickToOpenRate} />
                            <MetricCard title="Conversion Rate" value={formatPercent(campaignMetrics.conversionRate.value)} change={campaignMetrics.conversionRate.change} isPositive={campaignMetrics.conversionRate.isPositive} previousValue={campaignMetrics.conversionRate.previousValue} previousPeriod={campaignMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={campaignSeries.conversionRate} />
                            <MetricCard title="Unsubscribe Rate" value={formatPercent(campaignMetrics.unsubscribeRate.value)} change={campaignMetrics.unsubscribeRate.change} isPositive={campaignMetrics.unsubscribeRate.isPositive} previousValue={campaignMetrics.unsubscribeRate.previousValue} previousPeriod={campaignMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={campaignSeries.unsubscribeRate} />
                            <MetricCard title="Spam Rate" value={formatPercent(campaignMetrics.spamRate.value)} change={campaignMetrics.spamRate.change} isPositive={campaignMetrics.spamRate.isPositive} previousValue={campaignMetrics.spamRate.previousValue} previousPeriod={campaignMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={campaignSeries.spamRate} />
                            <MetricCard title="Bounce Rate" value={formatPercent(campaignMetrics.bounceRate.value)} change={campaignMetrics.bounceRate.change} isPositive={campaignMetrics.bounceRate.isPositive} previousValue={campaignMetrics.bounceRate.previousValue} previousPeriod={campaignMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={campaignSeries.bounceRate} />
                        </div>
                    </section>
                )}
                {/* Day & Hour Performance (placed before Top Campaigns to match legacy ordering) */}
                {campaignMetrics && (
                    <>
                        <DayOfWeekPerformance filteredCampaigns={filteredCampaigns} dateRange={dateRange} />
                        <HourOfDayPerformance filteredCampaigns={filteredCampaigns} dateRange={dateRange} />
                    </>
                )}
                {/* Top Campaigns moved directly after Campaign Performance */}
                {campaignMetrics && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2"><Star className="w-5 h-5 text-purple-600" /><h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Top Campaigns ({getSortedCampaigns().length})</h3></div>
                            <div className="relative"><select value={selectedCampaignMetric} onChange={e => setSelectedCampaignMetric(e.target.value)} className="appearance-none px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">{campaignMetricOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select><ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" /></div>
                        </div>
                        <div className="border rounded-lg overflow-hidden border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">{getSortedCampaigns().slice(0, displayedCampaigns).map((c, i) => (
                            <div key={c.id} className={`p-4 avoid-break ${i !== 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1.5"><span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium bg-purple-100 text-purple-900">{i + 1}</span><h4 className="font-medium text-gray-900 dark:text-gray-100">{c.subject}</h4></div>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{c.campaignName}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Sent on {c.sentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatMetricValue((c as any)[selectedCampaignMetric] as number, selectedCampaignMetric)}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">{campaignMetricOptions.find(m => m.value === selectedCampaignMetric)?.label}</p>
                                    </div>
                                </div>
                            </div>
                        ))}{(() => { const sorted = getSortedCampaigns(); return displayedCampaigns < sorted.length && (<div className="p-4 border-t border-gray-200 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-900/50"><button onClick={() => setDisplayedCampaigns(n => n + 5)} className="px-4 py-2 rounded-lg font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition-colors">Load More ({Math.min(5, sorted.length - displayedCampaigns)} more)</button></div>); })()}</div>
                    </section>
                )}
                {flowMetrics && (
                    <section>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-purple-600" /><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Flow Performance</h2></div>
                            <div className="relative">
                                <select value={selectedFlow} onChange={e => { setIsCalculating(true); setMetricsReady(false); setSelectedFlow(e.target.value); setTimeout(() => setIsCalculating(false), 400); }} className="appearance-none px-4 py-2 pr-9 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm min-w-[220px]">
                                    <option value="all">All Flows</option>
                                    {uniqueFlowNames.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-500 dark:text-gray-400" />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            <MetricCard title="Total Revenue" value={formatCurrency(flowMetrics.totalRevenue.value)} change={flowMetrics.totalRevenue.change} isPositive={flowMetrics.totalRevenue.isPositive} previousValue={flowMetrics.totalRevenue.previousValue} previousPeriod={flowMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={flowSeries.totalRevenue} />
                            <MetricCard title="Average Order Value" value={formatCurrency(flowMetrics.averageOrderValue.value)} change={flowMetrics.averageOrderValue.change} isPositive={flowMetrics.averageOrderValue.isPositive} previousValue={flowMetrics.averageOrderValue.previousValue} previousPeriod={flowMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={flowSeries.averageOrderValue} />
                            <MetricCard title="Revenue per Email" value={formatCurrency(flowMetrics.revenuePerEmail.value)} change={flowMetrics.revenuePerEmail.change} isPositive={flowMetrics.revenuePerEmail.isPositive} previousValue={flowMetrics.revenuePerEmail.previousValue} previousPeriod={flowMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={flowSeries.revenuePerEmail} />
                            <MetricCard title="Emails Sent" value={formatNumber(flowMetrics.emailsSent.value)} change={flowMetrics.emailsSent.change} isPositive={flowMetrics.emailsSent.isPositive} previousValue={flowMetrics.emailsSent.previousValue} previousPeriod={flowMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={flowSeries.emailsSent} />
                            <MetricCard title="Total Orders" value={formatNumber(flowMetrics.totalOrders.value)} change={flowMetrics.totalOrders.change} isPositive={flowMetrics.totalOrders.isPositive} previousValue={flowMetrics.totalOrders.previousValue} previousPeriod={flowMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={flowSeries.totalOrders} />
                            <MetricCard title="Open Rate" value={formatPercent(flowMetrics.openRate.value)} change={flowMetrics.openRate.change} isPositive={flowMetrics.openRate.isPositive} previousValue={flowMetrics.openRate.previousValue} previousPeriod={flowMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={flowSeries.openRate} />
                            <MetricCard title="Click Rate" value={formatPercent(flowMetrics.clickRate.value)} change={flowMetrics.clickRate.change} isPositive={flowMetrics.clickRate.isPositive} previousValue={flowMetrics.clickRate.previousValue} previousPeriod={flowMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={flowSeries.clickRate} />
                            <MetricCard title="Click-to-Open Rate" value={formatPercent(flowMetrics.clickToOpenRate.value)} change={flowMetrics.clickToOpenRate.change} isPositive={flowMetrics.clickToOpenRate.isPositive} previousValue={flowMetrics.clickToOpenRate.previousValue} previousPeriod={flowMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={flowSeries.clickToOpenRate} />
                            <MetricCard title="Conversion Rate" value={formatPercent(flowMetrics.conversionRate.value)} change={flowMetrics.conversionRate.change} isPositive={flowMetrics.conversionRate.isPositive} previousValue={flowMetrics.conversionRate.previousValue} previousPeriod={flowMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={flowSeries.conversionRate} />
                            <MetricCard title="Unsubscribe Rate" value={formatPercent(flowMetrics.unsubscribeRate.value)} change={flowMetrics.unsubscribeRate.change} isPositive={flowMetrics.unsubscribeRate.isPositive} previousValue={flowMetrics.unsubscribeRate.previousValue} previousPeriod={flowMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={flowSeries.unsubscribeRate} />
                            <MetricCard title="Spam Rate" value={formatPercent(flowMetrics.spamRate.value)} change={flowMetrics.spamRate.change} isPositive={flowMetrics.spamRate.isPositive} previousValue={flowMetrics.spamRate.previousValue} previousPeriod={flowMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={flowSeries.spamRate} />
                            <MetricCard title="Bounce Rate" value={formatPercent(flowMetrics.bounceRate.value)} change={flowMetrics.bounceRate.change} isPositive={flowMetrics.bounceRate.isPositive} previousValue={flowMetrics.bounceRate.previousValue} previousPeriod={flowMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={flowSeries.bounceRate} />
                        </div>
                    </section>
                )}
                {/* Flow Step Analysis */}
                <section><FlowStepAnalysis dateRange={dateRange} granularity={granularity} customFrom={customFrom} customTo={customTo} /></section>
                <div ref={el => setAudienceOverviewRef(el)}><AudienceCharts /></div>
                <section><CustomSegmentBlock /></section>
            </div></div>
        </div>
    );
}
