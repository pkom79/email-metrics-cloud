"use client";
import { Download } from 'lucide-react';
import React, { useMemo, useState, useEffect, useDeferredValue, useRef, useCallback } from 'react';
import { DataManager } from '../../lib/data/dataManager';
import MetricCard from './MetricCard';
import DayOfWeekPerformance from './DayOfWeekPerformance';
import HourOfDayPerformance from './HourOfDayPerformance';
import RevenueSplitBar from './RevenueSplitBar';
import SplitShareOverTime from './SplitShareOverTime';
// Revenue Reliability module removed: placeholder used to preserve layout
import SendVolumeImpact from './SendVolumeImpact';
import AudienceCharts from './AudienceCharts';
import TimeSeriesChart from './TimeSeriesChart';
import FlowStepAnalysis from './FlowStepAnalysis';
import CustomSegmentBlock from './CustomSegmentBlock';
import DataAgeNotice from './DataAgeNotice';
import CampaignSendFrequency from './CampaignSendFrequency';
import CampaignGapsAndLosses from './CampaignGapsAndLosses';
import { BarChart3, Calendar, GitCompare, Mail, Send, Zap, MailSearch, Upload as UploadIcon, X, Share2 } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import TooltipPortal from '../TooltipPortal';
import SelectBase from "../ui/SelectBase";
import UploadWizard from '../../components/UploadWizard';
import { usePendingUploadsLinker } from '../../lib/utils/usePendingUploadsLinker';
import { supabase } from '../../lib/supabase/client';

function formatCurrency(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function formatPercent(value: number) {
    const abs = Math.abs(value);
    if (abs >= 0.1) return `${value.toFixed(1)}%`;
    if (abs >= 0.01) return `${value.toFixed(2)}%`;
    return `${value.toFixed(3)}%`;
}
function formatNumber(value: number) { return Math.round(value).toLocaleString('en-US'); }
// Compact currency removed per requirement; always show full US currency with 2 decimals

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
    // Optional override to intentionally show an empty dashboard (e.g. screenshot / marketing)
    const [forceEmpty, setForceEmpty] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const qp = new URLSearchParams(window.location.search);
        if (qp.get('empty') === '1') setForceEmpty(true);
    }, []);
    const [dataVersion, setDataVersion] = useState(0);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    // Additional readiness flag to avoid rendering charts before hydration attempts complete
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [dateRange, setDateRange] = useState<'30d' | '60d' | '90d' | '120d' | '180d' | '365d' | 'all' | 'custom'>('30d');
    const [customFrom, setCustomFrom] = useState<string | undefined>();
    const [customTo, setCustomTo] = useState<string | undefined>();
    const customActive = dateRange === 'custom' && customFrom && customTo;
    const customDays = useMemo(() => { if (!customActive) return 0; const from = new Date(customFrom!); from.setHours(0, 0, 0, 0); const to = new Date(customTo!); to.setHours(23, 59, 59, 999); const diff = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1; return Math.max(diff, 1); }, [customActive, customFrom, customTo]);
    const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    const [compareMode, setCompareMode] = useState<'prev-period' | 'prev-year'>('prev-period');
    const [selectedFlow, setSelectedFlow] = useState('all');
    const [selectedCampaignMetric, setSelectedCampaignMetric] = useState('revenue');
    // Export JSON (LLM-ready) handler
    const onExportJson = useCallback(async () => {
        try {
            const { buildLlmExportJson } = await import('../../lib/export/exportBuilder');
            const effectiveRange = (dateRange === 'custom' && customActive && customFrom && customTo) ? 'custom' : dateRange;
            const payload = await buildLlmExportJson({
                dateRange: effectiveRange,
                granularity,
                compareMode,
                customFrom: customActive ? customFrom : undefined,
                customTo: customActive ? customTo : undefined,
            });
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const ts = new Date();
            const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
            a.href = url;
            a.download = `email-metrics-export-${stamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Export JSON failed', e);
            alert('Export failed. Please try again.');
        }
    }, [dateRange, customActive, customFrom, customTo, granularity, compareMode]);
    // Chart metric selections (defaults: Total Revenue)
    const [overviewChartMetric, setOverviewChartMetric] = useState<'revenue' | 'avgOrderValue' | 'revenuePerEmail' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'emailsSent' | 'totalOrders' | 'conversionRate' | 'unsubscribeRate' | 'spamRate' | 'bounceRate'>('revenue');
    const [campaignChartMetric, setCampaignChartMetric] = useState<typeof overviewChartMetric>('revenue');
    const [flowChartMetric, setFlowChartMetric] = useState<typeof overviewChartMetric>('revenue');
    const [displayedCampaigns, setDisplayedCampaigns] = useState(5);
    const [stickyBar, setStickyBar] = useState(false);
    const [showCustomDateModal, setShowCustomDateModal] = useState(false);

    // Granularity validation logic
    const totalDays = useMemo(() => {
        if (dateRange === 'custom' && customActive) {
            return customDays;
        } else if (dateRange === 'all') {
            return 730; // Cap to 2 years
        } else {
            return parseInt(dateRange.replace('d', ''));
        }
    }, [dateRange, customActive, customDays]);

    const granularityOptions = useMemo(() => {
        const options = [
            {
                key: 'daily' as const,
                label: 'Daily',
                disabled: totalDays >= 365,
                tooltip: totalDays >= 365 ? 'Daily view disabled for ranges 365+ days' : undefined
            },
            {
                key: 'weekly' as const,
                label: 'Weekly',
                disabled: false
            },
            {
                key: 'monthly' as const,
                label: 'Monthly',
                disabled: totalDays <= 60,
                tooltip: totalDays <= 60 ? 'Monthly view disabled for ranges 60 days or less' : undefined
            }
        ];
        return options;
    }, [totalDays]);

    // Auto-adjust granularity when invalid
    useEffect(() => {
        const currentOption = granularityOptions.find(opt => opt.key === granularity);
        if (currentOption?.disabled) {
            // Find first non-disabled option
            const validOption = granularityOptions.find(opt => !opt.disabled);
            if (validOption) {
                setGranularity(validOption.key);
            }
        }
    }, [granularity, granularityOptions]);

    // Sticky bar end sentinel (placed *after* Audience Growth so bar stays visible through that section)
    const [stickyEndRef, setStickyEndRef] = useState<HTMLElement | null>(null);
    const [isBeforeAudience, setIsBeforeAudience] = useState(true);
    // Admin accounts selector state
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminCheckComplete, setAdminCheckComplete] = useState(false);
    const [allAccounts, setAllAccounts] = useState<any[] | null>(null);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    // Human readable label for currently selected admin account
    const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>('');
    // Debug state for link errors
    const [linkDebugInfo, setLinkDebugInfo] = useState<string | null>(null);

    // Delayed loading for heavy flow components
    const [showFlowAnalysis, setShowFlowAnalysis] = useState(false);

    // Check for link error parameters on load
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const linkError = urlParams.get('link_error');
            const status = urlParams.get('status');
            if (linkError) {
                const message = linkError === '1' ?
                    `Link failed with status ${status || 'unknown'}` :
                    'Link error during processing';
                setLinkDebugInfo(message);
                console.warn('Dashboard: Link error detected:', message);
            }
        }
    }, []);

    // Determine admin status early and (if admin) load accounts list before any hydration
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const sessionResp = await supabase.auth.getSession();
                const s = sessionResp.data.session;
                const admin = s?.user?.app_metadata?.role === 'admin';
                if (cancelled) return;
                if (admin) {
                    setIsAdmin(true);
                    try {
                        const r = await fetch('/api/accounts', { cache: 'no-store' });
                        if (r.ok) {
                            const j = await r.json();
                            if (!cancelled) {
                                const list = (j.accounts || []).map((a: any) => ({
                                    id: a.id,
                                    businessName: a.businessName || null,
                                    label: a.label || a.businessName || a.id?.slice(0, 8) || 'Account'
                                }));
                                setAllAccounts(list);
                            }
                        } else if (!cancelled) {
                            setAccountsError(`Accounts ${r.status}`);
                        }
                    } catch (e: any) {
                        if (!cancelled) setAccountsError(e?.message || 'Failed to load accounts');
                    }
                }
            } finally {
                if (!cancelled) setAdminCheckComplete(true);
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

    // Helper to get current snapshot ID for sharing
    // Sharing helpers removed
    // Link any pending preauth uploads right after authentication (non-admin only)
    usePendingUploadsLinker(!isAdmin && adminCheckComplete);
    useEffect(() => {
        // Wait until we know admin status
        if (!adminCheckComplete) return;
        // Admin with no selected account: nothing to hydrate
        if (isAdmin && !selectedAccountId) { setIsInitialLoading(false); return; }
        // Non-admin path OR admin + selected account (account-specific hydration handled in separate effect already)
        if (isAdmin) return; // Avoid double-hydration; admin account hydration is in another effect.
        const onCreated = () => { setDataVersion(v => v + 1); setShowUploadModal(false); };
        const onHydrated = () => { setDataVersion(v => v + 1); setIsInitialLoading(false); };
        window.addEventListener('em:snapshot-created', onCreated as EventListener);
        window.addEventListener('em:dataset-hydrated', onHydrated as EventListener);
        let active = true;
        (async () => {
            for (let i = 0; i < 5 && active; i++) {
                const ok = await DataManager.getInstance().ensureHydrated();
                if (ok) { setDataVersion(v => v + 1); setIsInitialLoading(false); break; }
                await new Promise(r => setTimeout(r, 150));
            }
            if (active && !DataManager.getInstance().hasRealData()) setIsInitialLoading(false);
            if (active) setInitialLoadComplete(true);
        })();
        return () => {
            active = false;
            window.removeEventListener('em:snapshot-created', onCreated as EventListener);
            window.removeEventListener('em:dataset-hydrated', onHydrated as EventListener);
        };
    }, [userId, isAdmin, selectedAccountId, adminCheckComplete]);

    // Server snapshot CSV fallback
    useEffect(() => {
        // Wait for admin check; only for non-admin users (user auto-load of latest snapshot)
        if (!adminCheckComplete) return;
        if (isAdmin) return;
        let cancelled = false;
        (async () => {
            try {
                if (dm.getCampaigns().length || dm.getFlowEmails().length || dm.getSubscribers().length) { setIsInitialLoading(false); return; }
                const list = await fetch('/api/snapshots/list', { cache: 'no-store' });
                if (!list.ok) { setIsInitialLoading(false); return; }
                const j = await list.json().catch(() => ({}));
                const latest = (j.snapshots || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                if (!latest?.id) { setIsInitialLoading(false); return; }
                const csvTypes = ['campaigns', 'flows', 'subscribers'];
                const csvFiles: Record<string, File> = {};
                for (const t of csvTypes) {
                    try {
                        const r = await fetch(`/api/snapshots/download-csv?type=${t}`, { cache: 'no-store' });
                        if (r.ok) {
                            const csv = await r.text();
                            if (csv.trim()) {
                                const blob = new Blob([csv], { type: 'text/csv' });
                                csvFiles[t] = new File([blob], `${t}.csv`, { type: 'text/csv' });
                            }
                        }
                    } catch { }
                }
                if (Object.keys(csvFiles).length) {
                    const result = await dm.loadCSVFiles({ campaigns: csvFiles.campaigns, flows: csvFiles.flows, subscribers: csvFiles.subscribers });
                    if (result.success) {
                        if (cancelled) return;
                        setDataVersion(v => v + 1);
                        setIsInitialLoading(false);
                        window.dispatchEvent(new CustomEvent('em:dataset-hydrated'));
                    } else {
                        setDashboardError('Failed to process server data');
                        setIsInitialLoading(false);
                    }
                } else {
                    setIsInitialLoading(false);
                }
            } catch (e: any) {
                setDashboardError(`Failed to load data: ${e?.message || 'Unknown'}`);
                setIsInitialLoading(false);
            }
        })();
        return () => { cancelled = true };
    }, [dm, isAdmin, adminCheckComplete]);

    // Safe granularity
    const safeGranularity = useMemo(() => { try { if (dm.getCampaigns().length === 0 && dm.getFlowEmails().length === 0) return 'daily'; if (customActive && customDays > 0) return dm.getGranularityForDateRange(`${customDays}d`); if (dateRange === 'all') return dm.getGranularityForDateRange('all'); return dm.getGranularityForDateRange(dateRange === 'custom' ? '30d' : dateRange); } catch { return 'daily'; } }, [dateRange, customActive, customDays, dm]);
    useEffect(() => { setGranularity(safeGranularity); }, [safeGranularity]);

    // Sticky observer (desktop only now)
    useEffect(() => {
        if (!stickyEndRef) return;
        // We now observe a tiny sentinel AFTER Audience Growth; keep sticky until sentinel enters viewport (bottom 75%)
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsBeforeAudience(false);
                setStickyBar(false);
            } else {
                setIsBeforeAudience(true);
                setStickyBar(window.scrollY > 100);
            }
        }, { root: null, rootMargin: '0px 0px -75% 0px', threshold: 0 });
        observer.observe(stickyEndRef);
        const onScroll = () => { if (!isBeforeAudience) return; setStickyBar(window.scrollY > 100); };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll); };
    }, [stickyEndRef, isBeforeAudience]);

    // Base data
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ALL_CAMPAIGNS = useMemo(() => dm.getCampaigns(), [dm, dataVersion]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ALL_FLOWS = useMemo(() => dm.getFlowEmails(), [dm, dataVersion]);
    const hasData = ALL_CAMPAIGNS.length > 0 || ALL_FLOWS.length > 0;
    const REFERENCE_DATE = useMemo(() => {
        const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow);
        const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime());
        const flowTs = flowSubset.map(f => f.sentDate.getTime());
        const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n));

        if (!all.length) return new Date();

        // Find max efficiently without spread operator
        let maxTime = 0;
        for (const time of all) {
            if (time > maxTime) maxTime = time;
        }

        return new Date(maxTime);
    }, [ALL_CAMPAIGNS, ALL_FLOWS, selectedFlow]);
    // Global earliest date in dataset
    const GLOBAL_MIN_DATE = useMemo(() => {
        const all = [...ALL_CAMPAIGNS.map(c => c.sentDate.getTime()), ...ALL_FLOWS.map(f => f.sentDate.getTime())].filter(n => Number.isFinite(n));
        if (!all.length) return new Date();
        let minTime = all[0];
        for (let i = 1; i < all.length; i++) if (all[i] < minTime) minTime = all[i];
        return new Date(minTime);
    }, [ALL_CAMPAIGNS, ALL_FLOWS]);
    // Allowed window mirrors available data but capped to last 2 years
    const ALLOWED_MAX_DATE = useMemo(() => new Date(REFERENCE_DATE), [REFERENCE_DATE]);
    const ALLOWED_MIN_DATE = useMemo(() => {
        const cap = new Date(ALLOWED_MAX_DATE); cap.setDate(cap.getDate() - 730);
        return new Date(Math.max(GLOBAL_MIN_DATE.getTime(), cap.getTime()));
    }, [GLOBAL_MIN_DATE, ALLOWED_MAX_DATE]);
    const toISO = useCallback((d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${da}`;
    }, []);
    const allowedMinISO = useMemo(() => toISO(ALLOWED_MIN_DATE), [ALLOWED_MIN_DATE, toISO]);
    const allowedMaxISO = useMemo(() => toISO(ALLOWED_MAX_DATE), [ALLOWED_MAX_DATE, toISO]);

    // Custom popover calendar state (desktop)
    const [showDatePopover, setShowDatePopover] = useState(false);
    const [popoverYear, setPopoverYear] = useState<number>(() => ALLOWED_MAX_DATE.getFullYear());
    const [popoverMonth, setPopoverMonth] = useState<number>(() => ALLOWED_MAX_DATE.getMonth());
    const [tempFrom, setTempFrom] = useState<Date | null>(null);
    const [tempTo, setTempTo] = useState<Date | null>(null);
    const calendarRef = useRef<HTMLDivElement | null>(null);
    const calendarButtonRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        if (!showDatePopover) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (calendarRef.current && !calendarRef.current.contains(t) && calendarButtonRef.current && !calendarButtonRef.current.contains(t)) {
                setShowDatePopover(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [showDatePopover]);
    useEffect(() => {
        // Keep popover month in allowed range
        const clampDate = (y: number, m: number) => {
            const minY = ALLOWED_MIN_DATE.getFullYear();
            const maxY = ALLOWED_MAX_DATE.getFullYear();
            let Y = Math.min(Math.max(y, minY), maxY);
            let M = m;
            if (Y === minY) M = Math.max(M, ALLOWED_MIN_DATE.getMonth());
            if (Y === maxY) M = Math.min(M, ALLOWED_MAX_DATE.getMonth());
            return { Y, M };
        };
        const { Y, M } = clampDate(popoverYear, popoverMonth);
        if (Y !== popoverYear) setPopoverYear(Y);
        if (M !== popoverMonth) setPopoverMonth(M);
    }, [ALLOWED_MIN_DATE, ALLOWED_MAX_DATE, popoverYear, popoverMonth]);
    const allowedYears = useMemo(() => {
        const yrs: number[] = [];
        for (let y = ALLOWED_MAX_DATE.getFullYear(); y >= ALLOWED_MIN_DATE.getFullYear(); y--) yrs.push(y);
        return yrs;
    }, [ALLOWED_MAX_DATE, ALLOWED_MIN_DATE]);
    const firstDayOfMonth = (y: number, m: number) => new Date(y, m, 1);
    const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
    const allowedMinStart = useMemo(() => { const d = new Date(ALLOWED_MIN_DATE); d.setHours(0, 0, 0, 0); return d; }, [ALLOWED_MIN_DATE]);
    const allowedMaxEnd = useMemo(() => { const d = new Date(ALLOWED_MAX_DATE); d.setHours(23, 59, 59, 999); return d; }, [ALLOWED_MAX_DATE]);
    const isDisabled = (d: Date) => d < allowedMinStart || d > allowedMaxEnd;
    const isInRange = (d: Date) => (tempFrom && tempTo && d >= new Date(tempFrom.setHours(0, 0, 0, 0)) && d <= new Date(tempTo.setHours(0, 0, 0, 0)));
    const onDayClick = (day: number) => {
        const d = new Date(popoverYear, popoverMonth, day);
        if (isDisabled(d)) return;
        if (!tempFrom || (tempFrom && tempTo)) { setTempFrom(d); setTempTo(null); }
        else if (tempFrom && !tempTo) {
            if (d < tempFrom) { setTempFrom(d); setTempTo(null); } else { setTempTo(d); }
        }
    };
    const applyTempRange = () => {
        const start = tempFrom ? tempFrom : new Date(popoverYear, popoverMonth, 1);
        const end = tempTo ? tempTo : start;
        const startISO = toISO(start);
        const endISO = toISO(end);
        setCustomFrom(startISO);
        setCustomTo(endISO);
        setDateRange('custom');
        setShowDatePopover(false);
    };
    useEffect(() => {
        // Initialize temp from current custom values for better continuity
        if (customFrom) setTempFrom(new Date(customFrom + 'T00:00:00'));
        else setTempFrom(null);
        if (customTo) setTempTo(new Date(customTo + 'T00:00:00'));
        else setTempTo(null);
    }, [showDatePopover]);
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

    // Delayed loading of heavy flow components after main dashboard stabilizes
    useEffect(() => {
        // Force show components if data is available, regardless of initial load state
        if (hasData) {
            const timer1 = setTimeout(() => setShowFlowAnalysis(true), 100);
            return () => {
                clearTimeout(timer1);
            };
        }
        // Original logic as fallback
        if (initialLoadComplete && hasData) {
            const timer1 = setTimeout(() => setShowFlowAnalysis(true), 1000);
            return () => {
                clearTimeout(timer1);
            };
        }
    }, [initialLoadComplete, hasData]);

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
        const res = dm.calculatePeriodOverPeriodChange(dmKey, effectiveRange as string, dataset, { flowName: options?.flowName, compareMode });
        return { changePercent: res.changePercent, isPositive: res.isPositive, previousValue: res.previousValue, previousPeriod: res.previousPeriod };
    }, [dateRange, customActive, customFrom, customTo, dm, compareMode]);

    const defCampaigns = useDeferredValue(filteredCampaigns);
    const defFlows = useDeferredValue(filteredFlowEmails);

    // Sync custom inputs with preset
    useEffect(() => { if (!hasData) return; if (dateRange === 'custom') return; const to = new Date(REFERENCE_DATE); const toISO = (d: Date) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${da}`; }; if (dateRange === 'all') { const flowSubset = selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow); const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime()); const flowTs = flowSubset.map(f => f.sentDate.getTime()); const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n)); if (all.length) { let minTime = all[0]; for (let i = 1; i < all.length; i++) { if (all[i] < minTime) minTime = all[i]; } const from = new Date(minTime); setCustomFrom(toISO(from)); setCustomTo(toISO(to)); } else { setCustomFrom(undefined); setCustomTo(undefined); } } else { const days = parseInt(String(dateRange).replace('d', '')); if (Number.isFinite(days)) { const from = new Date(to); from.setDate(from.getDate() - days + 1); setCustomFrom(toISO(from)); setCustomTo(toISO(to)); } } }, [dateRange, REFERENCE_DATE, selectedFlow, ALL_CAMPAIGNS, ALL_FLOWS, hasData]);

    // Optimized date range change handler - let useEffect handle calculations
    const handleDateRangeChange = useCallback((value: string) => {
        setDateRange(value as any);
    }, []);

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
    // Overlay now only tied to isInitialLoading; metric calculations are synchronous & cached

    const campaignMetricOptions = [
        { value: 'revenue', label: 'Total Revenue' },
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
    const metricValueType = (metric: string): 'currency' | 'number' | 'percentage' => {
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) return 'currency';
        if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) return 'percentage';
        return 'number';
    };
    const bigValueForOverview = (metric: string) => {
        if (!overviewMetrics) return '';
        const map: Record<string, number> = {
            revenue: overviewMetrics.totalRevenue.value,
            avgOrderValue: overviewMetrics.averageOrderValue.value,
            revenuePerEmail: overviewMetrics.revenuePerEmail.value,
            openRate: overviewMetrics.openRate.value,
            clickRate: overviewMetrics.clickRate.value,
            clickToOpenRate: overviewMetrics.clickToOpenRate.value,
            emailsSent: overviewMetrics.emailsSent.value,
            totalOrders: overviewMetrics.totalOrders.value,
            conversionRate: overviewMetrics.conversionRate.value,
            unsubscribeRate: overviewMetrics.unsubscribeRate.value,
            spamRate: overviewMetrics.spamRate.value,
            bounceRate: overviewMetrics.bounceRate.value,
        };
        const v = map[metric];
        return ['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric) ? formatCurrency(v) : ['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric) ? formatPercent(v) : formatNumber(v);
    };
    const bigValueForCampaigns = (metric: string) => {
        if (!campaignMetrics) return '';
        const map: Record<string, number> = {
            revenue: campaignMetrics.totalRevenue.value,
            avgOrderValue: campaignMetrics.averageOrderValue.value,
            revenuePerEmail: campaignMetrics.revenuePerEmail.value,
            openRate: campaignMetrics.openRate.value,
            clickRate: campaignMetrics.clickRate.value,
            clickToOpenRate: campaignMetrics.clickToOpenRate.value,
            emailsSent: campaignMetrics.emailsSent.value,
            totalOrders: campaignMetrics.totalOrders.value,
            conversionRate: campaignMetrics.conversionRate.value,
            unsubscribeRate: campaignMetrics.unsubscribeRate.value,
            spamRate: campaignMetrics.spamRate.value,
            bounceRate: campaignMetrics.bounceRate.value,
        };
        const v = map[metric];
        return ['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric) ? formatCurrency(v) : ['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric) ? formatPercent(v) : formatNumber(v);
    };
    const bigValueForFlows = (metric: string) => {
        if (!flowMetrics) return '';
        const map: Record<string, number> = {
            revenue: flowMetrics.totalRevenue.value,
            avgOrderValue: flowMetrics.averageOrderValue.value,
            revenuePerEmail: flowMetrics.revenuePerEmail.value,
            openRate: flowMetrics.openRate.value,
            clickRate: flowMetrics.clickRate.value,
            clickToOpenRate: flowMetrics.clickToOpenRate.value,
            emailsSent: flowMetrics.emailsSent.value,
            totalOrders: flowMetrics.totalOrders.value,
            conversionRate: flowMetrics.conversionRate.value,
            unsubscribeRate: flowMetrics.unsubscribeRate.value,
            spamRate: flowMetrics.spamRate.value,
            bounceRate: flowMetrics.bounceRate.value,
        };
        const v = map[metric];
        return ['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric) ? formatCurrency(v) : ['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric) ? formatPercent(v) : formatNumber(v);
    };

    // Build chart series (primary + compare) per segment
    // IMPORTANT: Use full arrays (no date filtering) so previous-window data exists for compare.
    const overviewChartSeries = useMemo(
        () => dm.getMetricTimeSeriesWithCompare(ALL_CAMPAIGNS as any, ALL_FLOWS as any, overviewChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo),
        [dm, ALL_CAMPAIGNS, ALL_FLOWS, overviewChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );
    const campaignChartSeries = useMemo(
        () => dm.getMetricTimeSeriesWithCompare(ALL_CAMPAIGNS as any, [], campaignChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo),
        [dm, ALL_CAMPAIGNS, campaignChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );
    const flowsAllForChart = useMemo(
        () => (selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow)),
        [ALL_FLOWS, selectedFlow]
    );
    const flowChartSeries = useMemo(
        () => dm.getMetricTimeSeriesWithCompare([], flowsAllForChart as any, flowChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo),
        [dm, flowsAllForChart, flowChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );
    const formatMetricValue = (v: number, metric: string) => {
        if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric)) {
            // Requirement: always show full US currency with 2 decimals
            return formatCurrency(v);
        }
        if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) return formatPercent(v);
        return formatNumber(v);
    };
    const [campaignSortOrder, setCampaignSortOrder] = useState<'desc' | 'asc'>('desc');
    const getSortedCampaigns = () => [...defCampaigns].sort((a, b) => { const av = Number((a as any)[selectedCampaignMetric]) || 0; const bv = Number((b as any)[selectedCampaignMetric]) || 0; return campaignSortOrder === 'desc' ? (bv - av) : (av - bv); });

    // If admin and there are zero accounts, don't block UI with overlay after initial load
    const noAccounts = isAdmin && (allAccounts?.length === 0);
    const showOverlay = isInitialLoading && !noAccounts;

    if (dashboardError) { return <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md mx-auto text-center"><h2 className="text-lg font-semibold text-red-600 mb-4">Dashboard Error</h2><p className="text-gray-600 dark:text-gray-300 mb-6">{dashboardError}</p><div className="space-x-4"><button onClick={() => { setDashboardError(null); setDataVersion(v => v + 1); }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button><button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Reload Page</button></div></div></div>; }

    // Forced empty view (still respects header/footer from layout)
    if (forceEmpty) return <div className="min-h-screen" />;

    // Unified loading gate: ensure initial hydration attempts (or fallback) ran
    if ((!initialLoadComplete && !isAdmin) || (isAdmin && isInitialLoading)) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-gray-500 dark:text-gray-400 text-sm">Loading your metrics...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative">
            {showOverlay && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-xl px-8 py-6 shadow-2xl border border-gray-200 dark:border-gray-700 flex items-center gap-3">
                        <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                        <span className="text-gray-900 dark:text-gray-100 font-medium text-sm">Loading data…</span>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="pt-4 sm:pt-6"><div className="max-w-7xl mx-auto"><div className="p-6 sm:p-8 mb-4"><div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Performance Dashboard</h1>{businessName && <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{businessName}</p>}</div><div className="flex items-center gap-3 relative">{!isAdmin && (<><button onClick={() => setShowUploadModal(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><UploadIcon className="h-4 w-4" />Upload New Reports</button><button onClick={onExportJson} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-600 bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"><Download className="w-3.5 h-3.5" />Export JSON</button></>)}{isAdmin && (<><div className="relative"><SelectBase value={selectedAccountId} onChange={e => { const val = (e.target as HTMLSelectElement).value; setSelectedAccountId(val); const a = (allAccounts || []).find(x => x.id === val); setSelectedAccountLabel(a?.label || a?.businessName || a?.id || ''); if (!val) { try { (dm as any).clearAllData?.(); } catch { } setDataVersion(v => v + 1); setIsInitialLoading(false); } }} className="text-sm" minWidthClass="min-w-[240px]">{!selectedAccountId && <option value="">Select Account</option>}{(allAccounts || []).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</SelectBase></div><button onClick={onExportJson} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-600 bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"><Download className="w-3.5 h-3.5" />Export JSON</button></>)}</div></div></div></div></div>

            {/* Debug panel for link errors */}
            {linkDebugInfo && (
                <div className="max-w-7xl mx-auto px-4 mb-4">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <div className="text-amber-600 dark:text-amber-400 font-medium text-sm">
                                ⚠️ Debug: {linkDebugInfo}
                            </div>
                            <button
                                onClick={() => setLinkDebugInfo(null)}
                                className="ml-auto text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
                            >
                                ×
                            </button>
                        </div>
                        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                            This may indicate an issue with linking your uploaded data. Check the console for more details.
                        </div>
                    </div>
                </div>
            )}
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
            <div className={`hidden sm:block sm:pt-2 ${stickyBar ? 'sm:sticky sm:top-0 sm:z-50' : ''}`}> <div className="max-w-7xl mx-auto px-4"><div className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${stickyBar ? 'shadow-lg' : 'shadow-sm'} px-3 py-2 sm:mx-[-30px]`}>
                <div className="hidden sm:flex items-center justify-center gap-3 flex-nowrap whitespace-nowrap">
                    {/* Custom date inputs */}
                    <div className="flex items-center gap-1.5 relative">
                        <button ref={calendarButtonRef} onClick={() => setShowDatePopover(v => !v)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                            <Calendar className="w-4 h-4 text-gray-500" />
                        </button>
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Date Range:</span>
                        <input type="date" min={allowedMinISO} max={allowedMaxISO} value={customFrom || ''} onChange={e => { let v = e.target.value || undefined; if (v) { if (v < allowedMinISO) v = allowedMinISO; if (v > allowedMaxISO) v = allowedMaxISO; } setCustomFrom(v); if (v && customTo && new Date(v) > new Date(customTo)) setCustomTo(v); setDateRange('custom'); }} className="px-2 py-1 rounded text-xs border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100" />
                        <span className="text-xs text-gray-500">to</span>
                        <input type="date" min={allowedMinISO} max={allowedMaxISO} value={customTo || ''} onChange={e => { let v = e.target.value || undefined; if (v) { if (v < allowedMinISO) v = allowedMinISO; if (v > allowedMaxISO) v = allowedMaxISO; } setCustomTo(v); if (v && customFrom && new Date(v) < new Date(customFrom)) setCustomFrom(v); setDateRange('custom'); }} className="px-2 py-1 rounded text-xs border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100" />
                        {customActive && <button onClick={() => { setCustomFrom(undefined); setCustomTo(undefined); setDateRange('30d'); }} className="ml-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700">Clear</button>}
                        {/* Popover calendar */}
                        {showDatePopover && (
                            <div ref={calendarRef} className="absolute left-0 top-full mt-2 z-50 w-[320px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-600 dark:text-gray-300">Year</label>
                                        <SelectBase value={popoverYear} onChange={e => setPopoverYear(parseInt((e.target as HTMLSelectElement).value, 10))} className="px-2 py-1 pr-6 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs">
                                            {allowedYears.map(y => <option key={y} value={y}>{y}</option>)}
                                        </SelectBase>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => { let m = popoverMonth - 1, y = popoverYear; if (m < 0) { m = 11; y--; } setPopoverYear(y); setPopoverMonth(m); }} className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">Prev</button>
                                        <button onClick={() => { let m = popoverMonth + 1, y = popoverYear; if (m > 11) { m = 0; y++; } setPopoverYear(y); setPopoverMonth(m); }} className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">Next</button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-7 gap-1 text-[10px] text-gray-500 mb-1">
                                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => <div key={d} className="text-center">{d}</div>)}
                                </div>
                                {(() => {
                                    const first = firstDayOfMonth(popoverYear, popoverMonth);
                                    const startDay = first.getDay();
                                    const total = daysInMonth(popoverYear, popoverMonth);
                                    const cells: React.ReactNode[] = [];
                                    for (let i = 0; i < startDay; i++) cells.push(<div key={`e${i}`} className="h-8" />);
                                    for (let d = 1; d <= total; d++) {
                                        const cur = new Date(popoverYear, popoverMonth, d);
                                        const disabled = isDisabled(cur);
                                        const selected = (tempFrom && cur.toDateString() === tempFrom.toDateString()) || (tempTo && cur.toDateString() === tempTo.toDateString());
                                        const inRange = !selected && isInRange(cur);
                                        cells.push(
                                            <button key={d} onClick={() => onDayClick(d)} disabled={disabled} className={`h-8 w-8 text-xs rounded mx-auto flex items-center justify-center border ${disabled ? 'text-gray-300 dark:text-gray-600 border-transparent' : inRange ? 'bg-purple-100 text-purple-900 border-purple-200' : selected ? 'bg-purple-600 text-white border-purple-600' : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{d}</button>
                                        );
                                    }
                                    return <div className="grid grid-cols-7 gap-1">{cells}</div>;
                                })()}
                                <div className="flex items-center justify-end gap-2 mt-3">
                                    <button onClick={() => { setTempFrom(null); setTempTo(null); }} className="px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">Clear</button>
                                    <button onClick={applyTempRange} className="px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-700">Apply</button>
                                </div>
                                <div className="mt-2 text-[10px] text-gray-500">
                                    Allowed: {ALLOWED_MIN_DATE.toLocaleDateString()} – {ALLOWED_MAX_DATE.toLocaleDateString()}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-start gap-1"><div className="relative"><SelectBase value={dateRange === 'custom' ? '' : dateRange} onChange={e => handleDateRangeChange((e.target as HTMLSelectElement).value || '30d')} className="px-2 py-1 pr-8 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs">
                        <option value="" disabled>Presets</option>
                        <option value="30d">Last 30 days</option>
                        <option value="60d">Last 60 days</option>
                        <option value="90d">Last 90 days</option>
                        <option value="120d">Last 120 days</option>
                        <option value="180d">Last 180 days</option>
                        <option value="365d">Last 365 days</option>
                        <option value="all">Last 2 Years</option>
                    </SelectBase></div></div>
                    <div className="flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-gray-500" /><span className="font-medium text-sm text-gray-900 dark:text-gray-100">Granularity:</span><div className="flex gap-1.5 ml-2 flex-nowrap">{granularityOptions.map(option => <button key={option.key} onClick={() => { if (!option.disabled && option.key !== granularity) { setGranularity(option.key); } }} disabled={option.disabled} title={option.tooltip} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${granularity === option.key ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'} ${option.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>{option.label}</button>)}</div></div>
                    {/* Compare Mode */}
                    {(() => {
                        const prevAvail = dm.isCompareWindowAvailable(
                            dateRange === 'custom' && customActive ? `custom:${customFrom}:${customTo}` : dateRange,
                            'prev-period',
                            customFrom,
                            customTo
                        );
                        const yearAvail = dm.isCompareWindowAvailable(
                            dateRange === 'custom' && customActive ? `custom:${customFrom}:${customTo}` : dateRange,
                            'prev-year',
                            customFrom,
                            customTo
                        );
                        return (
                            <div className="flex items-center gap-1.5">
                                <GitCompare className="w-4 h-4 text-gray-500" />
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Compare:</span>
                                <div className="flex gap-1.5 ml-1 flex-nowrap">
                                    <button
                                        onClick={() => {
                                            if (compareMode !== 'prev-period' && prevAvail) setCompareMode('prev-period');
                                        }}
                                        disabled={!prevAvail}
                                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${compareMode === 'prev-period'
                                                ? 'bg-purple-600 text-white border-purple-600'
                                                : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        Prev Period
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (compareMode !== 'prev-year' && yearAvail) setCompareMode('prev-year');
                                        }}
                                        disabled={!yearAvail}
                                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${compareMode === 'prev-year'
                                                ? 'bg-purple-600 text-white border-purple-600'
                                                : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        Prev Year
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div></div></div></div>
            {/* Empty state (no data) */}
            {!showOverlay && !hasData && (
                <div className="px-6 pb-4">
                    <div className="max-w-3xl mx-auto mt-8">
                        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm p-10 text-center">
                            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
                                {isAdmin ? (selectedAccountId ? 'No data for this account yet' : 'Select an account to view data') : 'Get started by uploading your reports'}
                            </h2>
                            {!isAdmin && (
                                <div className="mt-4 flex items-center justify-center gap-3">
                                    <button onClick={() => setShowUploadModal(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <UploadIcon className="h-4 w-4" />
                                        Upload New Reports
                                    </button>
                                    <button onClick={onExportJson} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-600 bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
                                        <Download className="w-3.5 h-3.5" />
                                        Export JSON
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Main content */}
            <div className="p-6"><div className="max-w-7xl mx-auto space-y-8">
                {overviewMetrics && (
                    <section>
                        <div className="flex items-center gap-2 mb-3">
                            <Mail className="w-5 h-5 text-purple-600" />
                            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Email Performance Overview
                                <InfoTooltipIcon placement="top" content={(
                                    <div>
                                        <p className="font-semibold mb-1">What</p>
                                        <p>Your email KPIs over time.</p>
                                        <p className="font-semibold mt-2 mb-1">How</p>
                                        <p>Switch metrics and compare to a prior period to spot trends.</p>
                                        <p className="font-semibold mt-2 mb-1">Why</p>
                                        <p>If core rates slip, improve list quality, content, timing, and deliverability before scaling volume.</p>
                                    </div>
                                )} />
                            </h2>
                        </div>
                        {/* Overview Timeseries Chart */}
                        <TimeSeriesChart
                            title="Email Performance Overview"
                            metricKey={overviewChartMetric}
                            metricOptions={campaignMetricOptions as any}
                            onMetricChange={m => setOverviewChartMetric(m)}
                            bigValue={bigValueForOverview(overviewChartMetric)}
                            primary={overviewChartSeries.primary}
                            compare={overviewChartSeries.compare}
                            valueType={metricValueType(overviewChartMetric)}
                            granularity={granularity}
                            compareMode={compareMode}
                            headerChange={overviewMetrics[(overviewChartMetric === 'revenue' ? 'totalRevenue' : overviewChartMetric === 'avgOrderValue' ? 'averageOrderValue' : overviewChartMetric) as keyof typeof overviewMetrics]?.change as any}
                            headerIsPositive={overviewMetrics[(overviewChartMetric === 'revenue' ? 'totalRevenue' : overviewChartMetric === 'avgOrderValue' ? 'averageOrderValue' : overviewChartMetric) as keyof typeof overviewMetrics]?.isPositive as any}
                            headerPreviousValue={overviewMetrics[(overviewChartMetric === 'revenue' ? 'totalRevenue' : overviewChartMetric === 'avgOrderValue' ? 'averageOrderValue' : overviewChartMetric) as keyof typeof overviewMetrics]?.previousValue as any}
                            headerPreviousPeriod={overviewMetrics[(overviewChartMetric === 'revenue' ? 'totalRevenue' : overviewChartMetric === 'avgOrderValue' ? 'averageOrderValue' : overviewChartMetric) as keyof typeof overviewMetrics]?.previousPeriod as any}
                            colorHue="#8b5cf6" // purple (overview)
                            idSuffix="overview"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {/* Row 1 */}
                            <MetricCard title="Total Revenue" value={formatCurrency(overviewMetrics.totalRevenue.value)} change={overviewMetrics.totalRevenue.change} isPositive={overviewMetrics.totalRevenue.isPositive} previousValue={overviewMetrics.totalRevenue.previousValue} previousPeriod={overviewMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={overviewSeries.totalRevenue} compareMode={compareMode} category="email" />
                            <MetricCard title="Average Order Value" value={formatCurrency(overviewMetrics.averageOrderValue.value)} change={overviewMetrics.averageOrderValue.change} isPositive={overviewMetrics.averageOrderValue.isPositive} previousValue={overviewMetrics.averageOrderValue.previousValue} previousPeriod={overviewMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={overviewSeries.averageOrderValue} compareMode={compareMode} category="email" />
                            <MetricCard title="Total Orders" value={formatNumber(overviewMetrics.totalOrders.value)} change={overviewMetrics.totalOrders.change} isPositive={overviewMetrics.totalOrders.isPositive} previousValue={overviewMetrics.totalOrders.previousValue} previousPeriod={overviewMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={overviewSeries.totalOrders} compareMode={compareMode} category="email" />
                            <MetricCard title="Conversion Rate" value={formatPercent(overviewMetrics.conversionRate.value)} change={overviewMetrics.conversionRate.change} isPositive={overviewMetrics.conversionRate.isPositive} previousValue={overviewMetrics.conversionRate.previousValue} previousPeriod={overviewMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={overviewSeries.conversionRate} compareMode={compareMode} category="email" />
                            {/* Row 2 */}
                            <MetricCard title="Open Rate" value={formatPercent(overviewMetrics.openRate.value)} change={overviewMetrics.openRate.change} isPositive={overviewMetrics.openRate.isPositive} previousValue={overviewMetrics.openRate.previousValue} previousPeriod={overviewMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={overviewSeries.openRate} compareMode={compareMode} category="email" />
                            <MetricCard title="Click Rate" value={formatPercent(overviewMetrics.clickRate.value)} change={overviewMetrics.clickRate.change} isPositive={overviewMetrics.clickRate.isPositive} previousValue={overviewMetrics.clickRate.previousValue} previousPeriod={overviewMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={overviewSeries.clickRate} compareMode={compareMode} category="email" />
                            <MetricCard title="Click-to-Open Rate" value={formatPercent(overviewMetrics.clickToOpenRate.value)} change={overviewMetrics.clickToOpenRate.change} isPositive={overviewMetrics.clickToOpenRate.isPositive} previousValue={overviewMetrics.clickToOpenRate.previousValue} previousPeriod={overviewMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={overviewSeries.clickToOpenRate} compareMode={compareMode} category="email" />
                            <MetricCard title="Revenue per Email" value={formatCurrency(overviewMetrics.revenuePerEmail.value)} change={overviewMetrics.revenuePerEmail.change} isPositive={overviewMetrics.revenuePerEmail.isPositive} previousValue={overviewMetrics.revenuePerEmail.previousValue} previousPeriod={overviewMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={overviewSeries.revenuePerEmail} compareMode={compareMode} category="email" />
                            {/* Row 3 */}
                            <MetricCard title="Emails Sent" value={formatNumber(overviewMetrics.emailsSent.value)} change={overviewMetrics.emailsSent.change} isPositive={overviewMetrics.emailsSent.isPositive} previousValue={overviewMetrics.emailsSent.previousValue} previousPeriod={overviewMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={overviewSeries.emailsSent} compareMode={compareMode} category="email" />
                            <MetricCard title="Unsubscribe Rate" value={formatPercent(overviewMetrics.unsubscribeRate.value)} change={overviewMetrics.unsubscribeRate.change} isPositive={overviewMetrics.unsubscribeRate.isPositive} previousValue={overviewMetrics.unsubscribeRate.previousValue} previousPeriod={overviewMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={overviewSeries.unsubscribeRate} compareMode={compareMode} category="email" />
                            <MetricCard title="Spam Rate" value={formatPercent(overviewMetrics.spamRate.value)} change={overviewMetrics.spamRate.change} isPositive={overviewMetrics.spamRate.isPositive} previousValue={overviewMetrics.spamRate.previousValue} previousPeriod={overviewMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={overviewSeries.spamRate} compareMode={compareMode} category="email" />
                            <MetricCard title="Bounce Rate" value={formatPercent(overviewMetrics.bounceRate.value)} change={overviewMetrics.bounceRate.change} isPositive={overviewMetrics.bounceRate.isPositive} previousValue={overviewMetrics.bounceRate.previousValue} previousPeriod={overviewMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={overviewSeries.bounceRate} compareMode={compareMode} category="email" />
                        </div>
                        {/* Revenue Split Bar (Campaign vs Flow) moved to sit above Send Volume Impact */}
                        <RevenueSplitBar campaigns={filteredCampaigns} flows={filteredFlowEmails} />
                        <SplitShareOverTime
                            dateRange={dateRange === 'custom' ? 'custom' : dateRange}
                            granularity={granularity}
                            customFrom={customFrom}
                            customTo={customTo}
                            compareMode={compareMode}
                        />
                        {/* Revenue Reliability module removed - placeholder panel removed */}
                        <SendVolumeImpact dateRange={dateRange} granularity={granularity} customFrom={customFrom} customTo={customTo} compareMode={compareMode} />
                    </section>
                )}
                {campaignMetrics && (
                    <section>
                        <div className="flex items-center gap-2 mb-3">
                            <Send className="w-5 h-5 text-purple-600" />
                            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Campaign Performance
                                <InfoTooltipIcon placement="top" content={(
                                    <div>
                                        <p className="font-semibold mb-1">What</p>
                                        <p>KPIs for campaign sends only.</p>
                                        <p className="font-semibold mt-2 mb-1">How</p>
                                        <p>Pick a metric and see trends and compare.</p>
                                        <p className="font-semibold mt-2 mb-1">Why</p>
                                        <p>If efficiency falls as volume rises, slow down or segment better.</p>
                                    </div>
                                )} />
                            </h2>
                        </div>
                        {/* Campaign Timeseries Chart */}
                        <TimeSeriesChart
                            title="Campaign Performance"
                            metricKey={campaignChartMetric}
                            metricOptions={campaignMetricOptions as any}
                            onMetricChange={m => setCampaignChartMetric(m)}
                            bigValue={bigValueForCampaigns(campaignChartMetric)}
                            primary={campaignChartSeries.primary}
                            compare={campaignChartSeries.compare}
                            valueType={metricValueType(campaignChartMetric)}
                            granularity={granularity}
                            compareMode={compareMode}
                            headerChange={campaignMetrics[(campaignChartMetric === 'revenue' ? 'totalRevenue' : campaignChartMetric === 'avgOrderValue' ? 'averageOrderValue' : campaignChartMetric) as keyof typeof campaignMetrics]?.change as any}
                            headerIsPositive={campaignMetrics[(campaignChartMetric === 'revenue' ? 'totalRevenue' : campaignChartMetric === 'avgOrderValue' ? 'averageOrderValue' : campaignChartMetric) as keyof typeof campaignMetrics]?.isPositive as any}
                            headerPreviousValue={campaignMetrics[(campaignChartMetric === 'revenue' ? 'totalRevenue' : campaignChartMetric === 'avgOrderValue' ? 'averageOrderValue' : campaignChartMetric) as keyof typeof campaignMetrics]?.previousValue as any}
                            headerPreviousPeriod={campaignMetrics[(campaignChartMetric === 'revenue' ? 'totalRevenue' : campaignChartMetric === 'avgOrderValue' ? 'averageOrderValue' : campaignChartMetric) as keyof typeof campaignMetrics]?.previousPeriod as any}
                            colorHue="#6366f1" // indigo (campaigns)
                            idSuffix="campaigns"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {/* Row 1 */}
                            <MetricCard title="Total Revenue" value={formatCurrency(campaignMetrics.totalRevenue.value)} change={campaignMetrics.totalRevenue.change} isPositive={campaignMetrics.totalRevenue.isPositive} previousValue={campaignMetrics.totalRevenue.previousValue} previousPeriod={campaignMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={campaignSeries.totalRevenue} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Average Order Value" value={formatCurrency(campaignMetrics.averageOrderValue.value)} change={campaignMetrics.averageOrderValue.change} isPositive={campaignMetrics.averageOrderValue.isPositive} previousValue={campaignMetrics.averageOrderValue.previousValue} previousPeriod={campaignMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={campaignSeries.averageOrderValue} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Total Orders" value={formatNumber(campaignMetrics.totalOrders.value)} change={campaignMetrics.totalOrders.change} isPositive={campaignMetrics.totalOrders.isPositive} previousValue={campaignMetrics.totalOrders.previousValue} previousPeriod={campaignMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={campaignSeries.totalOrders} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Conversion Rate" value={formatPercent(campaignMetrics.conversionRate.value)} change={campaignMetrics.conversionRate.change} isPositive={campaignMetrics.conversionRate.isPositive} previousValue={campaignMetrics.conversionRate.previousValue} previousPeriod={campaignMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={campaignSeries.conversionRate} compareMode={compareMode} category="campaign" />
                            {/* Row 2 */}
                            <MetricCard title="Open Rate" value={formatPercent(campaignMetrics.openRate.value)} change={campaignMetrics.openRate.change} isPositive={campaignMetrics.openRate.isPositive} previousValue={campaignMetrics.openRate.previousValue} previousPeriod={campaignMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={campaignSeries.openRate} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Click Rate" value={formatPercent(campaignMetrics.clickRate.value)} change={campaignMetrics.clickRate.change} isPositive={campaignMetrics.clickRate.isPositive} previousValue={campaignMetrics.clickRate.previousValue} previousPeriod={campaignMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={campaignSeries.clickRate} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Click-to-Open Rate" value={formatPercent(campaignMetrics.clickToOpenRate.value)} change={campaignMetrics.clickToOpenRate.change} isPositive={campaignMetrics.clickToOpenRate.isPositive} previousValue={campaignMetrics.clickToOpenRate.previousValue} previousPeriod={campaignMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={campaignSeries.clickToOpenRate} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Revenue per Email" value={formatCurrency(campaignMetrics.revenuePerEmail.value)} change={campaignMetrics.revenuePerEmail.change} isPositive={campaignMetrics.revenuePerEmail.isPositive} previousValue={campaignMetrics.revenuePerEmail.previousValue} previousPeriod={campaignMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={campaignSeries.revenuePerEmail} compareMode={compareMode} category="campaign" />
                            {/* Row 3 */}
                            <MetricCard title="Emails Sent" value={formatNumber(campaignMetrics.emailsSent.value)} change={campaignMetrics.emailsSent.change} isPositive={campaignMetrics.emailsSent.isPositive} previousValue={campaignMetrics.emailsSent.previousValue} previousPeriod={campaignMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={campaignSeries.emailsSent} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Unsubscribe Rate" value={formatPercent(campaignMetrics.unsubscribeRate.value)} change={campaignMetrics.unsubscribeRate.change} isPositive={campaignMetrics.unsubscribeRate.isPositive} previousValue={campaignMetrics.unsubscribeRate.previousValue} previousPeriod={campaignMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={campaignSeries.unsubscribeRate} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Spam Rate" value={formatPercent(campaignMetrics.spamRate.value)} change={campaignMetrics.spamRate.change} isPositive={campaignMetrics.spamRate.isPositive} previousValue={campaignMetrics.spamRate.previousValue} previousPeriod={campaignMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={campaignSeries.spamRate} compareMode={compareMode} category="campaign" />
                            <MetricCard title="Bounce Rate" value={formatPercent(campaignMetrics.bounceRate.value)} change={campaignMetrics.bounceRate.change} isPositive={campaignMetrics.bounceRate.isPositive} previousValue={campaignMetrics.bounceRate.previousValue} previousPeriod={campaignMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={campaignSeries.bounceRate} compareMode={compareMode} category="campaign" />
                        </div>
                        {/* Send Frequency Module */}
                        <CampaignSendFrequency campaigns={filteredCampaigns} />
                        {/* Campaign Gaps & Losses — placed below Campaign Send Frequency */}
                        <CampaignGapsAndLosses
                            dateRange={dateRange}
                            granularity={granularity}
                            customFrom={customFrom}
                            customTo={customTo}
                            filteredCampaigns={filteredCampaigns}
                        />
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
                        <div className="section-card">
                            <div className="section-header">
                                <div className="flex items-center gap-2"><MailSearch className="w-5 h-5 text-purple-600" /><h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Campaign Details
                                    <InfoTooltipIcon placement="top" content={(
                                        <div>
                                            <p className="font-semibold mb-1">What</p>
                                            <p>Your campaigns listed by the metric you pick.</p>
                                            <p className="font-semibold mt-2 mb-1">How</p>
                                            <p>Sort ascending/descending and inspect details to learn what drives outcomes.</p>
                                            <p className="font-semibold mt-2 mb-1">Why</p>
                                            <p>Reuse what works like offer, timing, and creative. Iterate on weak ones.</p>
                                        </div>
                                    )} />
                                </h3></div>
                                <div className="section-controls">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Sort:</span>
                                        <div className="flex gap-1.5 ml-1 flex-nowrap">
                                            <button onClick={() => setCampaignSortOrder('desc')} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${campaignSortOrder === 'desc' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Desc</button>
                                            <button onClick={() => setCampaignSortOrder('asc')} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${campaignSortOrder === 'asc' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Asc</button>
                                        </div>
                                    </div>
                                    <div className="relative"><SelectBase value={selectedCampaignMetric} onChange={e => setSelectedCampaignMetric((e.target as HTMLSelectElement).value)} className="px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">{campaignMetricOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</SelectBase></div>
                                </div>
                            </div>
                            <div className="-mt-2 mb-2 text-sm text-gray-600 dark:text-gray-400">You sent {filteredCampaigns.length} {filteredCampaigns.length === 1 ? 'campaign' : 'campaigns'} in this time range.</div>
                            <div>{getSortedCampaigns().slice(0, displayedCampaigns).map((c, i) => (
                                <div key={c.id} className={`group relative p-4 avoid-break ${i !== 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''} md:grid md:items-center md:gap-4 md:[grid-template-columns:minmax(0,1fr)_400px_max-content]`}>
                                    {/* Subject (col 1) */}
                                    <div className="md:col-start-1 md:col-end-2 min-w-0">
                                        <div className="flex items-center gap-3 mb-1.5"><h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.subject}</h4></div>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 truncate">{c.campaignName}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Sent on {c.sentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                        {Array.isArray((c as any).segmentsUsed) && (c as any).segmentsUsed.length > 0 && (
                                            <div className="mt-0.5">
                                                <TooltipPortal placement="top" content={(
                                                    <div className="max-h-48 overflow-auto pr-1">
                                                        {((c as any).segmentsUsed as string[]).map((s: string, idx: number) => (
                                                            <div key={idx} className="py-0.5">{s}</div>
                                                        ))}
                                                    </div>
                                                )}>
                                                    <button type="button" className="text-purple-600 hover:text-purple-700 focus:outline-none text-xs">
                                                        Segments ({(c as any).segmentsUsed.length})
                                                    </button>
                                                </TooltipPortal>
                                            </div>
                                        )}
                                    </div>

                                    {/* Details (col 2 on md+, below on mobile) */}
                                    <div className="hidden md:block md:col-start-2 md:col-end-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 text-xs grid grid-cols-2 gap-x-6 gap-y-1">
                                            {['revenue', 'revenuePerEmail', 'openRate', 'clickRate', 'clickToOpenRate', 'emailsSent', 'totalOrders', 'avgOrderValue', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].map(mk => (
                                                <div key={mk} className="flex justify-between gap-4">
                                                    <span className="text-gray-500 capitalize">{campaignMetricOptions.find(opt => opt.value === mk)?.label || mk}</span>
                                                    <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100">{formatMetricValue((c as any)[mk] as number, mk)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="md:hidden mt-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3 text-xs grid grid-cols-2 gap-x-4 gap-y-1">
                                            {['revenue', 'revenuePerEmail', 'openRate', 'clickRate', 'clickToOpenRate', 'emailsSent', 'totalOrders', 'avgOrderValue', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].map(mk => (
                                                <div key={mk} className="flex justify-between gap-3">
                                                    <span className="text-gray-500 capitalize">{campaignMetricOptions.find(opt => opt.value === mk)?.label || mk}</span>
                                                    <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100">{formatMetricValue((c as any)[mk] as number, mk)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Metric (col 3) */}
                                    <div className="md:col-start-3 md:col-end-4 text-right">
                                        <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{formatMetricValue((c as any)[selectedCampaignMetric] as number, selectedCampaignMetric)}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">{campaignMetricOptions.find(m => m.value === selectedCampaignMetric)?.label}</p>
                                    </div>
                                </div>
                            ))}{(() => { const sorted = getSortedCampaigns(); return displayedCampaigns < sorted.length && (<div className="p-4 border-t border-gray-200 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-900/50"><button onClick={() => setDisplayedCampaigns((n: number) => n + 5)} className="px-4 py-2 rounded-lg font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition-colors">Load More ({Math.min(5, sorted.length - displayedCampaigns)} more)</button></div>); })()}</div>
                        </div>
                    </section>
                )}
                {flowMetrics && (
                    <section>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-purple-600" /><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Flow Performance
                                <InfoTooltipIcon placement="top" content={(
                                    <div>
                                        <p className="font-semibold mb-1">What</p>
                                        <p>KPIs for flows across all flows or one flow.</p>
                                        <p className="font-semibold mt-2 mb-1">How</p>
                                        <p>Pick a metric and see trend and compare.</p>
                                        <p className="font-semibold mt-2 mb-1">Why</p>
                                        <p>If a key flow underperforms, fix triggers, content, and timing.</p>
                                    </div>
                                )} />
                            </h2></div>
                            <div className="relative">
                                <SelectBase value={selectedFlow} onChange={e => { setSelectedFlow((e.target as HTMLSelectElement).value); }} className="px-4 py-2 pr-9 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm" minWidthClass="min-w-[220px]">
                                    <option value="all">All Flows</option>
                                    {uniqueFlowNames.map(f => <option key={f} value={f}>{f}</option>)}
                                </SelectBase>
                            </div>
                        </div>
                        {/* Flow Timeseries Chart */}
                        <TimeSeriesChart
                            title="Flow Performance"
                            metricKey={flowChartMetric}
                            metricOptions={campaignMetricOptions as any}
                            onMetricChange={m => setFlowChartMetric(m)}
                            bigValue={bigValueForFlows(flowChartMetric)}
                            primary={flowChartSeries.primary}
                            compare={flowChartSeries.compare}
                            valueType={metricValueType(flowChartMetric)}
                            granularity={granularity}
                            compareMode={compareMode}
                            headerChange={flowMetrics[(flowChartMetric === 'revenue' ? 'totalRevenue' : flowChartMetric === 'avgOrderValue' ? 'averageOrderValue' : flowChartMetric) as keyof typeof flowMetrics]?.change as any}
                            headerIsPositive={flowMetrics[(flowChartMetric === 'revenue' ? 'totalRevenue' : flowChartMetric === 'avgOrderValue' ? 'averageOrderValue' : flowChartMetric) as keyof typeof flowMetrics]?.isPositive as any}
                            headerPreviousValue={flowMetrics[(flowChartMetric === 'revenue' ? 'totalRevenue' : flowChartMetric === 'avgOrderValue' ? 'averageOrderValue' : flowChartMetric) as keyof typeof flowMetrics]?.previousValue as any}
                            headerPreviousPeriod={flowMetrics[(flowChartMetric === 'revenue' ? 'totalRevenue' : flowChartMetric === 'avgOrderValue' ? 'averageOrderValue' : flowChartMetric) as keyof typeof flowMetrics]?.previousPeriod as any}
                            colorHue="#10b981" // emerald (flows)
                            idSuffix="flows"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {/* Row 1 */}
                            <MetricCard title="Total Revenue" value={formatCurrency(flowMetrics.totalRevenue.value)} change={flowMetrics.totalRevenue.change} isPositive={flowMetrics.totalRevenue.isPositive} previousValue={flowMetrics.totalRevenue.previousValue} previousPeriod={flowMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={flowSeries.totalRevenue} compareMode={compareMode} category="flow" />
                            <MetricCard title="Average Order Value" value={formatCurrency(flowMetrics.averageOrderValue.value)} change={flowMetrics.averageOrderValue.change} isPositive={flowMetrics.averageOrderValue.isPositive} previousValue={flowMetrics.averageOrderValue.previousValue} previousPeriod={flowMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={flowSeries.averageOrderValue} compareMode={compareMode} category="flow" />
                            <MetricCard title="Total Orders" value={formatNumber(flowMetrics.totalOrders.value)} change={flowMetrics.totalOrders.change} isPositive={flowMetrics.totalOrders.isPositive} previousValue={flowMetrics.totalOrders.previousValue} previousPeriod={flowMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={flowSeries.totalOrders} compareMode={compareMode} category="flow" />
                            <MetricCard title="Conversion Rate" value={formatPercent(flowMetrics.conversionRate.value)} change={flowMetrics.conversionRate.change} isPositive={flowMetrics.conversionRate.isPositive} previousValue={flowMetrics.conversionRate.previousValue} previousPeriod={flowMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={flowSeries.conversionRate} compareMode={compareMode} category="flow" />
                            {/* Row 2 */}
                            <MetricCard title="Open Rate" value={formatPercent(flowMetrics.openRate.value)} change={flowMetrics.openRate.change} isPositive={flowMetrics.openRate.isPositive} previousValue={flowMetrics.openRate.previousValue} previousPeriod={flowMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={flowSeries.openRate} compareMode={compareMode} category="flow" />
                            <MetricCard title="Click Rate" value={formatPercent(flowMetrics.clickRate.value)} change={flowMetrics.clickRate.change} isPositive={flowMetrics.clickRate.isPositive} previousValue={flowMetrics.clickRate.previousValue} previousPeriod={flowMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={flowSeries.clickRate} compareMode={compareMode} category="flow" />
                            <MetricCard title="Click-to-Open Rate" value={formatPercent(flowMetrics.clickToOpenRate.value)} change={flowMetrics.clickToOpenRate.change} isPositive={flowMetrics.clickToOpenRate.isPositive} previousValue={flowMetrics.clickToOpenRate.previousValue} previousPeriod={flowMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={flowSeries.clickToOpenRate} compareMode={compareMode} category="flow" />
                            <MetricCard title="Revenue per Email" value={formatCurrency(flowMetrics.revenuePerEmail.value)} change={flowMetrics.revenuePerEmail.change} isPositive={flowMetrics.revenuePerEmail.isPositive} previousValue={flowMetrics.revenuePerEmail.previousValue} previousPeriod={flowMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={flowSeries.revenuePerEmail} compareMode={compareMode} category="flow" />
                            {/* Row 3 */}
                            <MetricCard title="Emails Sent" value={formatNumber(flowMetrics.emailsSent.value)} change={flowMetrics.emailsSent.change} isPositive={flowMetrics.emailsSent.isPositive} previousValue={flowMetrics.emailsSent.previousValue} previousPeriod={flowMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={flowSeries.emailsSent} compareMode={compareMode} category="flow" />
                            <MetricCard title="Unsubscribe Rate" value={formatPercent(flowMetrics.unsubscribeRate.value)} change={flowMetrics.unsubscribeRate.change} isPositive={flowMetrics.unsubscribeRate.isPositive} previousValue={flowMetrics.unsubscribeRate.previousValue} previousPeriod={flowMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={flowSeries.unsubscribeRate} compareMode={compareMode} category="flow" />
                            <MetricCard title="Spam Rate" value={formatPercent(flowMetrics.spamRate.value)} change={flowMetrics.spamRate.change} isPositive={flowMetrics.spamRate.isPositive} previousValue={flowMetrics.spamRate.previousValue} previousPeriod={flowMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={flowSeries.spamRate} compareMode={compareMode} category="flow" />
                            <MetricCard title="Bounce Rate" value={formatPercent(flowMetrics.bounceRate.value)} change={flowMetrics.bounceRate.change} isPositive={flowMetrics.bounceRate.isPositive} previousValue={flowMetrics.bounceRate.previousValue} previousPeriod={flowMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={flowSeries.bounceRate} compareMode={compareMode} category="flow" />
                        </div>
                    </section>
                )}
                {/* Flow Step Analysis */}
                <section>
                    {showFlowAnalysis ? (
                        <FlowStepAnalysis dateRange={dateRange} granularity={granularity} customFrom={customFrom} customTo={customTo} compareMode={compareMode} />
                    ) : (
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                            <div className="flex items-center justify-center h-32">
                                <div className="flex items-center gap-3">
                                    <div className="animate-spin w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full"></div>
                                    <span className="text-gray-600 dark:text-gray-400">Loading flow analysis...</span>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
                <AudienceCharts dateRange={dateRange} granularity={granularity} customFrom={customFrom} customTo={customTo} />
                {/* Sticky end sentinel (1px spacer) */}
                <div ref={el => setStickyEndRef(el)} style={{ height: 1 }} />
                <section><CustomSegmentBlock /></section>
            </div></div>

            {/* Sharing feature removed */}
        </div>
    );
}
