"use client";
import React, { useMemo, useState, useEffect, useDeferredValue, useRef, useCallback, useTransition } from 'react';
import { DataManager } from '../../lib/data/dataManager';
import MetricCard from './MetricCard';
import DayOfWeekPerformance from './DayOfWeekPerformance';
import HourOfDayPerformance from './HourOfDayPerformance';
import RevenueSplitBar from './RevenueSplitBar';
import SplitShareOverTime from './SplitShareOverTime';
// Revenue Reliability module removed: placeholder used to preserve layout
import SendVolumeImpactV2 from './SendVolumeImpactV2';
import AudienceCharts from './AudienceCharts';
import TimeSeriesChart from './TimeSeriesChart';
import FlowStepAnalysis from './FlowStepAnalysis';
import CustomSegmentBlock from './CustomSegmentBlock';
import DataAgeNotice from './DataAgeNotice';
import DataCoverageNotice from './DataCoverageNotice';
import CampaignSendFrequency from './CampaignSendFrequency';
import AudienceSizePerformance from './AudienceSizePerformance';
import CampaignGapsAndLosses from './CampaignGapsAndLosses';
import { computeOpportunitySummary, OpportunitySummary, OpportunitySummaryCategory } from '../../lib/analytics/actionNotes';
// Helper: map guidance cadence label to numeric recommendation for Day-of-Week note
function deriveFrequencyRecommendation(g: any): number | undefined {
    if (!g || !g.cadenceLabel) return undefined;
    const label: string = g.cadenceLabel.toLowerCase();
    if (label.startsWith('1')) return 1;
    if (label.startsWith('2')) return 2;
    if (label.startsWith('3')) return 3;
    if (label.startsWith('4')) return 4; // treat 4+ as 4 (cap logic in analytics already)
    return undefined;
}
import { BarChart3, Calendar, GitCompare, Mail, Send, Zap, MailSearch, Upload as UploadIcon, X, Share2, RefreshCcw, Key } from 'lucide-react';
import { buildLlmExportJson } from '../../lib/export/exportBuilder';
import InfoTooltipIcon from '../InfoTooltipIcon';
import TooltipPortal from '../TooltipPortal';
import SelectBase from "../ui/SelectBase";
import AdminAccountPicker, { AdminAccountOption } from "./AdminAccountPicker";
import DateRangePicker, { DateRange } from '../ui/DateRangePicker';
import { useDateAvailability } from '../../lib/hooks/useDateAvailability';
import UploadWizard from '../../components/UploadWizard';
import EmptyStateCard from '../EmptyStateCard';
import { usePendingUploadsLinker } from '../../lib/utils/usePendingUploadsLinker';
import { supabase } from '../../lib/supabase/client';
import ModalPlans, { PlanId } from '../billing/ModalPlans';

type ImpactTimeframe = 'annual' | 'monthly' | 'weekly';

const IMPACT_TIMEFRAME_OPTIONS: Array<{ key: ImpactTimeframe; label: string }> = [
    { key: 'annual', label: 'Yearly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'weekly', label: 'Weekly' }
];

const IMPACT_TIMEFRAME_SUFFIX: Record<ImpactTimeframe, string> = {
    annual: 'per year',
    monthly: 'per month',
    weekly: 'per week'
};

const CATEGORY_STYLES: Record<'campaigns' | 'flows' | 'audience', {
    bg: string;
    border: string;
    dot: string;
    label: string;
    barBg: string;
    barFill: string;
}> = {
    campaigns: {
        bg: 'bg-indigo-50 dark:bg-indigo-950/40',
        border: 'border-indigo-100 dark:border-indigo-900/60',
        dot: 'bg-indigo-500 dark:bg-indigo-300',
        label: 'text-indigo-700 dark:text-indigo-200',
        barBg: 'bg-indigo-100 dark:bg-indigo-900/50',
        barFill: 'bg-indigo-500 dark:bg-indigo-300'
    },
    flows: {
        bg: 'bg-emerald-50 dark:bg-emerald-950/40',
        border: 'border-emerald-100 dark:border-emerald-900/60',
        dot: 'bg-emerald-500 dark:bg-emerald-300',
        label: 'text-emerald-700 dark:text-emerald-200',
        barBg: 'bg-emerald-100 dark:bg-emerald-900/40',
        barFill: 'bg-emerald-500 dark:bg-emerald-300'
    },
    audience: {
        bg: 'bg-purple-50 dark:bg-purple-950/40',
        border: 'border-purple-100 dark:border-purple-900/60',
        dot: 'bg-purple-500 dark:bg-purple-300',
        label: 'text-purple-700 dark:text-purple-200',
        barBg: 'bg-purple-100 dark:bg-purple-900/40',
        barFill: 'bg-purple-500 dark:bg-purple-300'
    }
};

function getCategoryBaseline(category: OpportunitySummaryCategory, timeframe: ImpactTimeframe): number | null {
    if (!category) return null;
    if (timeframe === 'annual') return category.baselineAnnual ?? null;
    if (timeframe === 'monthly') return category.baselineMonthly ?? null;
    return category.baselineWeekly ?? null;
}

function convertAnnualAmount(amount: number, timeframe: ImpactTimeframe): number {
    const safe = Number.isFinite(amount) ? amount : 0;
    switch (timeframe) {
        case 'monthly':
            return safe / 12;
        case 'weekly':
            return safe / 52;
        default:
            return safe;
    }
}

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
        // Load latest snapshot metadata for last-update
        (async () => { try { const r = await fetch('/api/snapshots/last/self', { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (j?.latest) setLastUpdate({ at: j.latest.created_at, source: j.latest.label }); } catch { } })();
    }, []);
    const [dataVersion, setDataVersion] = useState(0);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    // Additional readiness flag to avoid rendering charts before hydration attempts complete
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    // Performance: Use transitions for non-blocking date changes
    const [isPending, startTransition] = useTransition();
    const [dateRange, setDateRange] = useState<'30d' | '60d' | '90d' | '120d' | '180d' | '365d' | 'all' | 'custom'>('30d');
    const [customFrom, setCustomFrom] = useState<string | undefined>();
    const [customTo, setCustomTo] = useState<string | undefined>();
    const customActive = dateRange === 'custom' && customFrom && customTo;

    // Performance: Defer heavy computations during date changes
    const deferredDateRange = useDeferredValue(dateRange);
    const deferredCustomFrom = useDeferredValue(customFrom);
    const deferredCustomTo = useDeferredValue(customTo);
    const customDays = useMemo(() => { if (!customActive) return 0; const from = new Date(customFrom!); from.setHours(0, 0, 0, 0); const to = new Date(customTo!); to.setHours(23, 59, 59, 999); const diff = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1; return Math.max(diff, 1); }, [customActive, customFrom, customTo]);
    const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    const [compareMode, setCompareMode] = useState<'none' | 'prev-period' | 'prev-year'>('prev-period');
    const [selectedFlow, setSelectedFlow] = useState('all');
    const [selectedCampaignMetric, setSelectedCampaignMetric] = useState('revenue');
    // Shared guidance outputs
    const [frequencyGuidance, setFrequencyGuidance] = useState<any | null>(null);
    // JSON export temporarily disabled during redesign
    // Chart metric selections (defaults: Total Revenue)
    const [overviewChartMetric, setOverviewChartMetric] = useState<'revenue' | 'avgOrderValue' | 'revenuePerEmail' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'emailsSent' | 'totalOrders' | 'conversionRate' | 'unsubscribeRate' | 'spamRate' | 'bounceRate'>('revenue');
    const [overviewSecondaryMetric, setOverviewSecondaryMetric] = useState<typeof overviewChartMetric | 'none'>('none');
    const [campaignChartMetric, setCampaignChartMetric] = useState<typeof overviewChartMetric>('revenue');
    const [campaignSecondaryMetric, setCampaignSecondaryMetric] = useState<typeof overviewChartMetric | 'none'>('none');
    const [flowChartMetric, setFlowChartMetric] = useState<typeof overviewChartMetric>('revenue');
    const [flowSecondaryMetric, setFlowSecondaryMetric] = useState<typeof overviewChartMetric | 'none'>('none');
    const [emailChartType, setEmailChartType] = useState<'line' | 'bar'>('line');
    const [campaignChartType, setCampaignChartType] = useState<'line' | 'bar'>('line');
    const [flowChartType, setFlowChartType] = useState<'line' | 'bar'>('line');
    const [displayedCampaigns, setDisplayedCampaigns] = useState(5);
    const [stickyBar, setStickyBar] = useState(false);
    const [showCustomDateModal, setShowCustomDateModal] = useState(false);
    const [exportBusy, setExportBusy] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<{ at?: string; source?: string } | null>(null);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    const [syncBusy, setSyncBusy] = useState(false);
    // Mobile Filters drawer state
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
    const [mfDateRange, setMfDateRange] = useState<typeof dateRange>(dateRange);
    const [mfCustomFrom, setMfCustomFrom] = useState<string | undefined>(customFrom);
    const [mfCustomTo, setMfCustomTo] = useState<string | undefined>(customTo);
    const [mfGranularity, setMfGranularity] = useState<typeof granularity>(granularity);
    const [mfCompareMode, setMfCompareMode] = useState<typeof compareMode>(compareMode);
    const [mfSelectedFlow, setMfSelectedFlow] = useState<string>(selectedFlow);

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
    const [adminHydrateTick, setAdminHydrateTick] = useState(0);
    const [allAccounts, setAllAccounts] = useState<AdminAccountOption[] | null>(null);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    // Member brand switcher
    const [memberAccounts, setMemberAccounts] = useState<Array<{ id: string; label: string }>>([]);
    const [memberSelectedId, setMemberSelectedId] = useState<string>('');
    const [memberBrandsLoaded, setMemberBrandsLoaded] = useState<boolean>(false);
    const adminSelectionInitRef = useRef(false);
    // Billing state: start in loading state to avoid first-paint plan modal flash
    const [billingState, setBillingState] = useState<{ status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; loading: boolean; hasCustomer: boolean }>({ status: 'unknown', trialEndsAt: null, currentPeriodEnd: null, loading: true, hasCustomer: false });
    const [billingStatusKnown, setBillingStatusKnown] = useState(false); // becomes true after first fetch resolves (success or error)
    const [billingWatchdogFired, setBillingWatchdogFired] = useState(false); // watchdog fallback if fetch stalls
    const [billingModalOpen, setBillingModalOpen] = useState(false);
    const [billingActionCadence, setBillingActionCadence] = useState<PlanId | null>(null);
    const [claimingFreeAccess, setClaimingFreeAccess] = useState(false);
    const [billingError, setBillingError] = useState<string | null>(null);
    const [billingRefreshTick, setBillingRefreshTick] = useState(0);
    const [billingPortalBusy, setBillingPortalBusy] = useState(false);
    const [forceDataOverlay, setForceDataOverlay] = useState(false);
    // Removed API integration modal/state (CSV-only ingestion)
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [keyInput, setKeyInput] = useState('');

    const [impactTimeframe, setImpactTimeframe] = useState<ImpactTimeframe>('annual');
    const [breakdownOpen, setBreakdownOpen] = useState(false);

    const opportunitySummary = useMemo<OpportunitySummary>(() => {
        return computeOpportunitySummary({
            dateRange,
            customFrom,
            customTo,
        });
    }, [dateRange, customFrom, customTo, dataVersion]);

    const opportunityCategories = opportunitySummary?.categories ?? [];
    const hasOpportunities = opportunityCategories.length > 0;

    const convertAmount = useCallback((annual: number | null | undefined) => {
        if (!annual || !Number.isFinite(annual)) return 0;
        return convertAnnualAmount(annual, impactTimeframe);
    }, [impactTimeframe]);

    const totalAnnualImpact = opportunitySummary?.totals?.annual ?? 0;
    const totalImpactValue = convertAmount(totalAnnualImpact);
    const baselineAnnual = opportunitySummary?.totals?.baselineAnnual ?? null;
    const baselineMonthly = opportunitySummary?.totals?.baselineMonthly ?? null;
    const baselineWeekly = opportunitySummary?.totals?.baselineWeekly ?? null;
    const baselineByTimeframe: Record<ImpactTimeframe, number | null> = {
        annual: baselineAnnual,
        monthly: baselineMonthly,
        weekly: baselineWeekly
    };
    const selectedBaseline = baselineByTimeframe[impactTimeframe];
    const shareOfBaseline = selectedBaseline && selectedBaseline > 0 ? (totalImpactValue / selectedBaseline) * 100 : null;
    const totalCategories = opportunityCategories.length;
    const hasCampaignCategory = opportunityCategories.some(cat => cat.key === 'campaigns');
    useEffect(() => {
        if (!breakdownOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setBreakdownOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [breakdownOpen]);

    const activeAccountId = useMemo(() => (isAdmin ? (selectedAccountId || '') : (memberSelectedId || '')), [isAdmin, selectedAccountId, memberSelectedId]);
    const activeAdminAccount = useMemo(() => {
        if (!isAdmin || !allAccounts) return null;
        return allAccounts.find(x => x.id === selectedAccountId) || null;
    }, [isAdmin, allAccounts, selectedAccountId]);
    const activeAccountLabel = useMemo(() => {
        if (isAdmin) {
            return activeAdminAccount?.label || activeAdminAccount?.businessName || businessName || '';
        }
        if (memberSelectedId) {
            const sel = memberAccounts.find(a => a.id === memberSelectedId);
            if (sel?.label) return sel.label;
        }
        return businessName || '';
    }, [isAdmin, activeAdminAccount, businessName, memberAccounts, memberSelectedId]);
    const billingStatusValue = (billingState.status || 'inactive').toLowerCase();
    const billingLoading = billingState.loading;
    // Classify status for gating nuance (issue vs none vs ok)
    const classifyBilling = (s: string): 'ok' | 'issue' | 'none' | 'unknown' => {
        if (s === 'unknown') return 'unknown';
        if (['active', 'trialing', 'comped'].includes(s)) return 'ok';
        if (['past_due', 'incomplete', 'incomplete_expired', 'unpaid'].includes(s)) return 'issue';
        return 'none'; // paused, canceled, inactive, etc.
    };
    const billingClass = classifyBilling(billingStatusValue);
    const billingRequiresPlan = !isAdmin && billingClass === 'none' && billingStatusValue !== 'unknown';
    const billingIssue = !isAdmin && billingClass === 'issue' && billingStatusValue !== 'unknown';
    const blockDashboard = !isAdmin && (
        billingLoading ||
        !billingStatusKnown ||
        billingRequiresPlan ||
        billingIssue ||
        billingModalOpen
    );
    const showPlansModal = !isAdmin && billingStatusKnown && !billingLoading && (billingModalOpen || billingRequiresPlan || billingIssue);
    const emitTelemetry = (name: string, detail: any) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* noop */ } };

    const handleRefreshBillingStatus = useCallback(() => {
        setBillingRefreshTick(t => t + 1);
    }, []);

    const handleSelectBillingPlan = useCallback(async (cadence: PlanId) => {
        if (!activeAccountId) return;
        try {
            setBillingActionCadence(cadence);
            setBillingError(null);
            const resp = await fetch('/api/payments/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: activeAccountId, cadence })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(json?.error || 'Unable to start checkout.');
            }
            if (json?.url) {
                window.location.href = json.url as string;
                return;
            }
            throw new Error('Checkout URL missing.');
        } catch (err: any) {
            setBillingError(err?.message || 'Unable to start checkout.');
        } finally {
            setBillingActionCadence(null);
        }
    }, [activeAccountId]);

    const handleManageBillingPortal = useCallback(async () => {
        if (!activeAccountId) return;
        try {
            setBillingPortalBusy(true);
            setBillingError(null);
            const resp = await fetch('/api/payments/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: activeAccountId })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(json?.error || 'Unable to open billing portal.');
            }
            if (json?.url) {
                window.location.href = json.url as string;
                return;
            }
            throw new Error('Billing portal URL missing.');
        } catch (err: any) {
            setBillingError(err?.message || 'Unable to open billing portal.');
        } finally {
            setBillingPortalBusy(false);
        }
    }, [activeAccountId]);

    const handleClaimFreeAccess = useCallback(async () => {
        if (!activeAccountId) return;
        try {
            setClaimingFreeAccess(true);
            setBillingError(null);
            const resp = await fetch('/api/payments/free-access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: activeAccountId })
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(json?.error || 'Unable to unlock access.');
            }
            setForceDataOverlay(true);
            handleRefreshBillingStatus();
            setBillingModalOpen(false);
        } catch (err: any) {
            setBillingError(err?.message || 'Unable to unlock access.');
            setForceDataOverlay(false);
        } finally {
            setClaimingFreeAccess(false);
        }
    }, [activeAccountId, handleRefreshBillingStatus]);

    const checkKeyAndSync = useCallback(async () => {
        // API sync removed; guide user to upload CSVs instead
        setSyncMsg('Please upload CSV reports to refresh data.');
        setSyncBusy(false);
    }, []);
    const handleExportJson = useCallback(async () => {
        try {
            setExportBusy(true);
            // Determine account name/url based on context
            let accountName: string | undefined = businessName;
            let accountUrl: string | undefined;
            if (isAdmin) {
                accountName = activeAdminAccount?.businessName || activeAdminAccount?.label || accountName;
                accountUrl = activeAdminAccount?.storeUrl || undefined;
            } else {
                try {
                    const session = (await supabase.auth.getSession()).data.session;
                    const rawUrl = (session?.user?.user_metadata as any)?.storeUrl as string | undefined;
                    accountUrl = rawUrl || undefined;
                } catch { /* ignore */ }
            }
            const payload = await buildLlmExportJson({
                dateRange,
                granularity,
                compareMode,
                customFrom,
                customTo,
                account: { name: accountName || undefined, url: accountUrl || undefined }
            });
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const ts = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const fname = `email-metrics-export-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        } catch (err) {
            console.error('JSON export failed', err);
            alert('Sorry, the JSON export failed. Please try again.');
        } finally {
            setExportBusy(false);
        }
    }, [dateRange, granularity, compareMode, customFrom, customTo, businessName, isAdmin, activeAdminAccount]);
    const handleAdminAccountChange = useCallback((val: string) => {
        adminSelectionInitRef.current = true;
        setSelectedAccountId(val);
        if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            if (val) url.searchParams.set('account', val); else url.searchParams.delete('account');
            window.history.replaceState(null, '', url.toString());
        }
        if (!val) {
            try { (dm as any).clearAllData?.(); } catch { /* ignore */ }
            setDataVersion(v => v + 1);
            setIsInitialLoading(false);
        }
    }, [dm]);
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
                const adminMeta = s?.user?.app_metadata;
                const admin = adminMeta?.role === 'admin' || adminMeta?.app_role === 'admin';
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
                                    storeUrl: a.storeUrl || null,
                                    label: a.label || a.businessName || a.id?.slice(0, 8) || 'Account',
                                    adminContactLabel: a.adminContactLabel || null,
                                    isAdminFree: Boolean(a.isAdminFree),
                                }));
                                setAllAccounts(list);
                                if (!adminSelectionInitRef.current) {
                                    let initialSelection = '';
                                    if (typeof window !== 'undefined') {
                                        const qp = new URLSearchParams(window.location.search);
                                        const requested = qp.get('account');
                                        if (requested && list.some((acc: AdminAccountOption) => acc.id === requested)) {
                                            initialSelection = requested;
                                        }
                                    }
                                    if (initialSelection) setSelectedAccountId(initialSelection);
                                    adminSelectionInitRef.current = true;
                                }
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

    // Watchdog: if status never resolves, fail open with retry UI
    useEffect(() => {
        if (billingStatusKnown) return;
        const id = setTimeout(() => {
            if (!billingStatusKnown) {
                setBillingWatchdogFired(true);
                setBillingState(prev => ({ ...prev, loading: false }));
                setBillingError(e => e || 'Billing status is taking longer than expected.');
            }
        }, 8000);
        return () => clearTimeout(id);
    }, [billingStatusKnown]);

    const retryBillingStatus = useCallback(() => {
        setBillingWatchdogFired(false);
        setBillingError(null);
        setBillingState(prev => ({ ...prev, loading: true }));
        setBillingRefreshTick(t => t + 1);
    }, []);

    useEffect(() => {
        if (!adminCheckComplete) return;
        let cancelled = false;
        setBillingState(prev => ({ ...prev, loading: true }));
        setBillingActionCadence(null);
        if (!billingWatchdogFired) setBillingError(null);
        (async () => {
            try {
                const statusUrl = activeAccountId ? `/api/payments/status?account_id=${activeAccountId}` : '/api/payments/status';
                const resp = await fetch(statusUrl, { cache: 'no-store' });
                if (!resp.ok) throw new Error(resp.status === 403 ? 'You need owner access to manage billing.' : 'Unable to load billing status.');
                const json = await resp.json().catch(() => ({}));
                const subscription = json.subscription || {};
                const status = (subscription.status || 'inactive').toLowerCase();
                const trialEnds = subscription.trialEndsAt || null;
                const currentEnd = subscription.currentPeriodEnd || null;
                const hasCustomer = Boolean(subscription.hasCustomer);
                if (cancelled) return;
                setBillingState(prev => ({ ...prev, status, trialEndsAt: trialEnds, currentPeriodEnd: currentEnd, loading: false, hasCustomer }));
                setBillingStatusKnown(true);
                if (!isAdmin) {
                    const cls = classifyBilling(status);
                    const shouldOpen = cls !== 'ok';
                    setBillingModalOpen(shouldOpen);
                    if (!shouldOpen) {
                        setBillingError(null);
                    } else {
                        emitTelemetry('em:plans-modal-opened', { reason: cls === 'none' ? 'requires_plan' : 'billing_issue', status, at: Date.now() });
                        setIsInitialLoading(false);
                        setInitialLoadComplete(true);
                    }
                } else {
                    setBillingModalOpen(false);
                }
            } catch (err: any) {
                if (cancelled) return;
                setBillingState(prev => ({ ...prev, status: prev.status === 'unknown' ? 'inactive' : prev.status, trialEndsAt: null, currentPeriodEnd: null, loading: false, hasCustomer: false }));
                setBillingStatusKnown(true);
                if (!isAdmin) {
                    setBillingModalOpen(true);
                    setBillingError(err?.message || 'Unable to load billing status.');
                    emitTelemetry('em:plans-modal-opened', { reason: 'requires_plan', status: 'error', at: Date.now() });
                    setIsInitialLoading(false);
                    setInitialLoadComplete(true);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [activeAccountId, adminCheckComplete, isAdmin, billingRefreshTick, billingWatchdogFired]);

    // Admin: reload data when selectedAccountId changes (stable, uses helper)
    useEffect(() => {
        if (!isAdmin || !selectedAccountId) return;
        let cancelled = false;
        (async () => {
            setIsInitialLoading(true);
            setInitialLoadComplete(false);
            setAccountLoadInFlight(true);
            setAccountHydrationAttempted(false);
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
                setAccountLoadInFlight(false);
                setAccountHydrationAttempted(true);
                setIsInitialLoading(false);
                setInitialLoadComplete(true);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin, selectedAccountId, dm, adminHydrateTick]);

    // Events / hydration
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadModalJustOpened, setUploadModalJustOpened] = useState(false);

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
        const refreshLastUpdate = async () => {
            try { const r = await fetch('/api/snapshots/last/self', { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (j?.latest) setLastUpdate({ at: j.latest.created_at, source: j.latest.label }); } catch { }
        };
        const onCreated = () => { setDataVersion(v => v + 1); setAccountLoadInFlight(true); setAccountHydrationAttempted(false); refreshLastUpdate(); };
        const onHydrated = () => { setDataVersion(v => v + 1); setIsInitialLoading(false); refreshLastUpdate(); };
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

    useEffect(() => {
        if (!isAdmin) return;
        const onSnapshotCreated = () => {
            setAccountLoadInFlight(true);
            setAccountHydrationAttempted(false);
            setAdminHydrateTick(t => t + 1);
        };
        const onDatasetHydrated = () => {
            setDataVersion(v => v + 1);
            setIsInitialLoading(false);
        };
        window.addEventListener('em:snapshot-created', onSnapshotCreated as EventListener);
        window.addEventListener('em:dataset-hydrated', onDatasetHydrated as EventListener);
        return () => {
            window.removeEventListener('em:snapshot-created', onSnapshotCreated as EventListener);
            window.removeEventListener('em:dataset-hydrated', onDatasetHydrated as EventListener);
        };
    }, [isAdmin]);

    // Load accessible brands (owner + members + any agency-entitled) and default-select
    useEffect(() => {
        if (!adminCheckComplete || isAdmin) return;
        let cancelled = false;
        (async () => {
            try {
                // Unified list includes owner brands as well
                const r = await fetch('/api/account/my-brands', { cache: 'no-store' });
                if (!r.ok) { return; }
                const j = await r.json();
                const list: Array<{ id: string; label: string }> = (j.accounts || []).map((a: any) => ({ id: String(a.id), label: String(a.company || a.name || a.id) }));
                if (cancelled) return;
                setMemberAccounts(list);
                const qp = new URLSearchParams(window.location.search);
                const qId = qp.get('account');
                let initial = '';
                if (qId && list.some((ac: { id: string }) => ac.id === qId)) {
                    initial = qId;
                } else if (list.length === 1) {
                    initial = list[0].id;
                }
                setMemberSelectedId(initial);
                // If user has no accessible accounts, clear any cached dataset immediately
                if (!initial) {
                    try { (dm as any).clearAllData?.(); } catch { }
                    setDataVersion(v => v + 1);
                }
            } catch { }
            finally { if (!cancelled) setMemberBrandsLoaded(true); }
        })();
        return () => { cancelled = true; };
    }, [adminCheckComplete, isAdmin]);

    // Server snapshot CSV fallback
    useEffect(() => {
        // Wait for admin check; only for non-admin users (user auto-load of latest snapshot)
        if (!adminCheckComplete) return;
        if (isAdmin) return;
        if (billingLoading) return;
        if (billingRequiresPlan && !billingLoading) {
            try { (dm as any).clearAllData?.(); } catch { }
            setIsInitialLoading(false);
            setAccountLoadInFlight(false);
            setAccountHydrationAttempted(false);
            setInitialLoadComplete(true);
            return;
        }
        if (!memberSelectedId) {
            setIsInitialLoading(false);
            setAccountLoadInFlight(false);
            setAccountHydrationAttempted(false);
            setInitialLoadComplete(true);
            return;
        }
        let cancelled = false;
        (async () => {
            // If user picked a brand, hydrate from cache first; fall back to server CSVs
            try {
                const hydrated = await dm.ensureHydrated();
                if (hydrated && dm.hasRealData()) {
                    if (!cancelled) { setDataVersion(v => v + 1); setIsInitialLoading(false); setAccountLoadInFlight(false); setAccountHydrationAttempted(true); setInitialLoadComplete(true); }
                    return;
                }
                const ok = await loadAccountData(dm, memberSelectedId);
                if (!cancelled) {
                    setIsInitialLoading(false);
                    setAccountLoadInFlight(false);
                    setAccountHydrationAttempted(true);
                    setInitialLoadComplete(true);
                }
                if (!cancelled && ok) setDataVersion(v => v + 1);
                return;
            } catch { }
            try {
                const list = await fetch(`/api/snapshots/list?account_id=${memberSelectedId}`, { cache: 'no-store' });
                if (!list.ok) { setIsInitialLoading(false); setAccountLoadInFlight(false); setAccountHydrationAttempted(true); setInitialLoadComplete(true); return; }
                const j = await list.json().catch(() => ({}));
                const latest = (j.snapshots || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                if (!latest?.id) { setIsInitialLoading(false); setAccountLoadInFlight(false); setAccountHydrationAttempted(true); setInitialLoadComplete(true); return; }
                const csvTypes = ['campaigns', 'flows', 'subscribers'];
                const csvFiles: Record<string, File> = {};
                for (const t of csvTypes) {
                    try {
                        const r = await fetch(`/api/snapshots/download-csv?type=${t}&account_id=${memberSelectedId}`, { cache: 'no-store' });
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
                        setAccountLoadInFlight(false);
                        setAccountHydrationAttempted(true);
                        setInitialLoadComplete(true);
                        window.dispatchEvent(new CustomEvent('em:dataset-hydrated'));
                    } else {
                        setDashboardError('Failed to process server data');
                        setIsInitialLoading(false);
                        setAccountLoadInFlight(false);
                        setAccountHydrationAttempted(true);
                        setInitialLoadComplete(true);
                    }
                } else {
                    setIsInitialLoading(false);
                    setAccountLoadInFlight(false);
                    setAccountHydrationAttempted(true);
                    setInitialLoadComplete(true);
                }
            } catch (e: any) {
                setDashboardError(`Failed to load data: ${e?.message || 'Unknown'}`);
                setIsInitialLoading(false);
                setAccountLoadInFlight(false);
                setAccountHydrationAttempted(true);
                setInitialLoadComplete(true);
            }
        })();
        return () => { cancelled = true };
    }, [dm, isAdmin, adminCheckComplete, memberSelectedId, billingLoading, billingRequiresPlan]);

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
    const dataHydrated = useMemo(() => dm.hasRealData(), [dm, dataVersion]);
    useEffect(() => {
        if (!forceDataOverlay) return;
        if (blockDashboard) return;
        if (dataHydrated) {
            setForceDataOverlay(false);
        }
    }, [forceDataOverlay, blockDashboard, dataHydrated]);
    const hasData = dataHydrated;
    // Active account resolution
    const EFFECTIVE_ACCOUNT_ID = useMemo(
        () => (isAdmin ? (selectedAccountId || '') : (memberSelectedId || '')),
        [isAdmin, selectedAccountId, memberSelectedId]
    );
    const HAS_ACTIVE_ACCOUNT = useMemo(() => {
        if (isAdmin) return Boolean(selectedAccountId);
        if (!memberBrandsLoaded) return false;
        if (!memberSelectedId) return false;
        return memberAccounts.some(a => a.id === memberSelectedId);
    }, [isAdmin, selectedAccountId, memberBrandsLoaded, memberSelectedId, memberAccounts]);

    // Track loading state per account selection
    const [accountLoadInFlight, setAccountLoadInFlight] = useState<boolean>(false);
    const [accountHydrationAttempted, setAccountHydrationAttempted] = useState<boolean>(false);
    useEffect(() => {
        setAccountHydrationAttempted(false);
        setAccountLoadInFlight(Boolean(activeAccountId));
        if (!activeAccountId) {
            try { (dm as any).clearAllData?.(); } catch { /* ignore */ }
            setDataVersion(v => v + 1);
            setIsInitialLoading(false);
            return;
        }
        try { (dm as any).clearAllData?.(); } catch { /* ignore */ }
        setDataVersion(v => v + 1);
        setInitialLoadComplete(false);
    }, [activeAccountId, dm]);
    useEffect(() => {
        if (dataHydrated) setAccountLoadInFlight(false);
    }, [dataHydrated]);
    useEffect(() => {
        // Only auto-close if we just uploaded successfully (not if modal was manually opened)
        if (showUploadModal && dataHydrated && HAS_ACTIVE_ACCOUNT && !accountLoadInFlight && !uploadModalJustOpened) {
            console.log('[Dashboard] Auto-closing modal after successful upload');
            setShowUploadModal(false);
        }
    }, [showUploadModal, dataHydrated, HAS_ACTIVE_ACCOUNT, accountLoadInFlight, uploadModalJustOpened]);

    // Debug logging for upload modal
    useEffect(() => {
        if (showUploadModal) {
            console.log('[Dashboard] Upload modal opened, rendering UploadWizard with accountId:', activeAccountId);
            // Check if modal actually rendered in DOM
            setTimeout(() => {
                const modalElement = document.querySelector('[class*="z-[60]"]');
                console.log('[Dashboard] Modal element in DOM:', !!modalElement, 'z-index:', modalElement ? window.getComputedStyle(modalElement).zIndex : 'N/A');
            }, 100);
        } else {
            // Reset flag when modal closes
            setUploadModalJustOpened(false);
        }
    }, [showUploadModal, activeAccountId]);

    useEffect(() => { try { DataManager.setAccountId(EFFECTIVE_ACCOUNT_ID || null); } catch { } }, [EFFECTIVE_ACCOUNT_ID]);
    // Reference/end date for presets and bounds –
    // align with DataCoverageNotice by using DataManager's helper.
    const REFERENCE_DATE = useMemo(() => {
        try {
            const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime()).filter(n => Number.isFinite(n));
            const flowTs = ALL_FLOWS.map(f => f.sentDate.getTime()).filter(n => Number.isFinite(n));
            const all = [...campTs, ...flowTs];
            if (all.length) {
                const max = all.reduce((a, b) => (b > a ? b : a), all[0]);
                return new Date(max);
            }
        } catch { }
        // Fallback to DataManager helper
        return dm.getLastEmailDate();
    }, [ALL_CAMPAIGNS, ALL_FLOWS, dm, dataVersion]);
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

    // Date availability for new DateRangePicker component
    const dateAvailability = useDateAvailability(ALL_CAMPAIGNS, ALL_FLOWS, {
        maxYearsBack: 2,
    });

    // DateRange state for new picker
    const [dateRangeValue, setDateRangeValue] = useState<DateRange>(() => {
        if (customFrom && customTo) {
            const [y1, m1, d1] = customFrom.split('-').map(Number);
            const [y2, m2, d2] = customTo.split('-').map(Number);
            return {
                start: new Date(y1, m1 - 1, d1),
                end: new Date(y2, m2 - 1, d2),
            };
        }
        return { start: null, end: null };
    });

    // Handle date range change from new picker
    const handleDateRangePickerChange = useCallback((range: DateRange) => {
        setDateRangeValue(range);
        if (range.start && range.end) {
            const startISO = toISO(range.start);
            const endISO = toISO(range.end);
            startTransition(() => {
                setCustomFrom(startISO);
                setCustomTo(endISO);
                setDateRange('custom');
            });
        }
    }, [toISO]);

    // Sync dateRangeValue when customFrom/customTo changes (from preset selection)
    useEffect(() => {
        if (customFrom && customTo) {
            const [y1, m1, d1] = customFrom.split('-').map(Number);
            const [y2, m2, d2] = customTo.split('-').map(Number);
            const newRange = {
                start: new Date(y1, m1 - 1, d1),
                end: new Date(y2, m2 - 1, d2),
            };
            // Only update if different to avoid infinite loops
            if (
                !dateRangeValue.start ||
                !dateRangeValue.end ||
                dateRangeValue.start.getTime() !== newRange.start.getTime() ||
                dateRangeValue.end.getTime() !== newRange.end.getTime()
            ) {
                setDateRangeValue(newRange);
            }
        } else if (dateRangeValue.start || dateRangeValue.end) {
            setDateRangeValue({ start: null, end: null });
        }
    }, [customFrom, customTo]);

    // Old calendar state removed - now using DateRangePicker component
    // Active flows: flows that have at least one send in the currently selected (or custom) date range
    // Mirror FlowStepAnalysis logic: restrict dropdown to *live* flows only, further filtered to current date window
    const liveFlows = useMemo(() => ALL_FLOWS.filter(f => (f as any).status && String((f as any).status).toLowerCase() === 'live'), [ALL_FLOWS]);
    const flowsInRange = useMemo(() => {
        if (!liveFlows.length) return [] as typeof liveFlows;
        let flows = liveFlows;
        // PERFORMANCE: Use deferred values to avoid blocking UI during date changes
        const effectiveDateRange = deferredDateRange;
        const effectiveCustomFrom = deferredCustomFrom;
        const effectiveCustomTo = deferredCustomTo;
        const effectiveCustomActive = effectiveDateRange === 'custom' && effectiveCustomFrom && effectiveCustomTo;

        if (effectiveDateRange === 'custom' && effectiveCustomActive) {
            // CRITICAL FIX: Parse dates as UTC to avoid timezone issues
            const [y1, m1, d1] = effectiveCustomFrom!.split('-').map(Number);
            const [y2, m2, d2] = effectiveCustomTo!.split('-').map(Number);
            const from = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
            const to = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));
            flows = flows.filter(f => f.sentDate >= from && f.sentDate <= to);
        } else if (effectiveDateRange !== 'all') {
            const days = parseInt(effectiveDateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            flows = flows.filter(f => f.sentDate >= start && f.sentDate <= end);
        }
        return flows;
    }, [liveFlows, deferredDateRange, deferredCustomFrom, deferredCustomTo, REFERENCE_DATE]);
    const uniqueFlowNames = useMemo(() => Array.from(new Set(flowsInRange.map(f => f.flowName))).sort(), [flowsInRange]);
    // Ensure selected flow remains valid; if not, reset to 'all'
    useEffect(() => { if (selectedFlow !== 'all' && !uniqueFlowNames.includes(selectedFlow)) setSelectedFlow('all'); }, [uniqueFlowNames, selectedFlow]);

    // Filters - compute date boundaries and filtered campaigns
    const { filteredCampaigns, dateRangeBoundaries } = useMemo(() => {
        if (!hasData) return { filteredCampaigns: [] as typeof ALL_CAMPAIGNS, dateRangeBoundaries: null };

        // PERFORMANCE: Use deferred values to avoid blocking UI during date changes
        const effectiveDateRange = deferredDateRange;
        const effectiveCustomFrom = deferredCustomFrom;
        const effectiveCustomTo = deferredCustomTo;
        const effectiveCustomActive = effectiveDateRange === 'custom' && effectiveCustomFrom && effectiveCustomTo;

        let list = ALL_CAMPAIGNS;
        let boundaries: { start: Date; end: Date } | null = null;

        if (effectiveDateRange === 'custom' && effectiveCustomActive) {
            // CRITICAL FIX: Parse dates as UTC to avoid timezone issues
            const [y1, m1, d1] = effectiveCustomFrom!.split('-').map(Number);
            const [y2, m2, d2] = effectiveCustomTo!.split('-').map(Number);
            const from = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
            const to = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));

            list = list.filter(c => c.sentDate >= from && c.sentDate <= to);

            boundaries = { start: from, end: to };
        } else if (effectiveDateRange !== 'all') {
            const days = parseInt(effectiveDateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE);
            end.setHours(23, 59, 59, 999);
            const start = new Date(end);
            start.setDate(start.getDate() - days + 1);
            start.setHours(0, 0, 0, 0);
            list = list.filter(c => c.sentDate >= start && c.sentDate <= end);
            boundaries = { start, end };
        }

        return { filteredCampaigns: list, dateRangeBoundaries: boundaries };
    }, [ALL_CAMPAIGNS, deferredDateRange, REFERENCE_DATE, hasData, deferredCustomFrom, deferredCustomTo]);
    const campaignRangeLabel = useMemo(() => {
        const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

        // Use immediate values for label (not deferred) so label updates instantly
        if (dateRange === 'custom') {
            if (customActive && customFrom && customTo) {
                // CRITICAL FIX: Parse dates as UTC to avoid timezone issues
                const [y1, m1, d1] = customFrom.split('-').map(Number);
                const [y2, m2, d2] = customTo.split('-').map(Number);
                const start = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
                const end = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));
                return `${formatDate(start)} – ${formatDate(end)}`;
            }
            return 'custom range';
        }
        if (dateRange === 'all') {
            const validDates = filteredCampaigns
                .map(c => c.sentDate)
                .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
                .sort((a, b) => a.getTime() - b.getTime());
            if (validDates.length >= 2) {
                return `${formatDate(validDates[0])} – ${formatDate(validDates[validDates.length - 1])}`;
            }
            return 'full available history';
        }
        if (typeof dateRange === 'string' && dateRange.endsWith('d')) {
            const days = parseInt(dateRange.replace('d', ''), 10) || 30;
            return `last ${days} days`;
        }
        return 'selected range';
    }, [dateRange, customActive, customFrom, customTo, filteredCampaigns]);
    const filteredFlowEmails = useMemo(() => {
        if (!hasData) return [] as typeof ALL_FLOWS;

        // PERFORMANCE: Use deferred values to avoid blocking UI during date changes
        const effectiveDateRange = deferredDateRange;
        const effectiveCustomFrom = deferredCustomFrom;
        const effectiveCustomTo = deferredCustomTo;
        const effectiveCustomActive = effectiveDateRange === 'custom' && effectiveCustomFrom && effectiveCustomTo;

        let flows = ALL_FLOWS;
        // Apply Flow Performance selection only for non-overview sections
        if (selectedFlow !== 'all') flows = flows.filter(f => f.flowName === selectedFlow);
        // Apply date filtering
        if (effectiveDateRange === 'custom' && effectiveCustomActive) {
            // CRITICAL FIX: Parse dates as UTC to avoid timezone issues
            const [y1, m1, d1] = effectiveCustomFrom!.split('-').map(Number);
            const [y2, m2, d2] = effectiveCustomTo!.split('-').map(Number);
            const from = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
            const to = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));
            flows = flows.filter(f => f.sentDate >= from && f.sentDate <= to);
        } else if (effectiveDateRange !== 'all') {
            const days = parseInt(effectiveDateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            flows = flows.filter(f => f.sentDate >= start && f.sentDate <= end);
        }
        return flows;
    }, [ALL_FLOWS, selectedFlow, deferredDateRange, REFERENCE_DATE, hasData, deferredCustomFrom, deferredCustomTo]);

    // Overview should always use ALL flows (date-filtered), regardless of Flow Performance selection
    const filteredFlowEmailsAll = useMemo(() => {
        if (!hasData) return [] as typeof ALL_FLOWS;

        // PERFORMANCE: Use deferred values to avoid blocking UI during date changes
        const effectiveDateRange = deferredDateRange;
        const effectiveCustomFrom = deferredCustomFrom;
        const effectiveCustomTo = deferredCustomTo;
        const effectiveCustomActive = effectiveDateRange === 'custom' && effectiveCustomFrom && effectiveCustomTo;

        let flows = ALL_FLOWS; // intentionally no selectedFlow filter
        if (effectiveDateRange === 'custom' && effectiveCustomActive) {
            // CRITICAL FIX: Parse dates as UTC to avoid timezone issues
            const [y1, m1, d1] = effectiveCustomFrom!.split('-').map(Number);
            const [y2, m2, d2] = effectiveCustomTo!.split('-').map(Number);
            const from = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
            const to = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));
            flows = flows.filter(f => f.sentDate >= from && f.sentDate <= to);
        } else if (effectiveDateRange !== 'all') {
            const days = parseInt(effectiveDateRange.replace('d', ''));
            const end = new Date(REFERENCE_DATE); end.setHours(23, 59, 59, 999);
            const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
            flows = flows.filter(f => f.sentDate >= start && f.sentDate <= end);
        }
        return flows;
    }, [ALL_FLOWS, deferredDateRange, REFERENCE_DATE, hasData, deferredCustomFrom, deferredCustomTo]);

    useEffect(() => {
        if (dataHydrated && !initialLoadComplete) {
            setInitialLoadComplete(true);
        }
    }, [dataHydrated, initialLoadComplete]);

    useEffect(() => {
        if (!dataHydrated && !isInitialLoading && !initialLoadComplete) {
            const timeout = setTimeout(() => setInitialLoadComplete(true), 2000);
            return () => clearTimeout(timeout);
        }
    }, [dataHydrated, isInitialLoading, initialLoadComplete]);

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
    const defFlowsOverview = useDeferredValue(filteredFlowEmailsAll);

    // Sync custom inputs with preset
    useEffect(() => {
        if (!hasData) return;
        if (dateRange === 'custom') return;
        const to = new Date(REFERENCE_DATE);
        const toISO = (d: Date) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${da}`; };
        if (dateRange === 'all') {
            // Always compute from ALL campaigns + ALL flows
            const campTs = ALL_CAMPAIGNS.map(c => c.sentDate.getTime());
            const flowTs = ALL_FLOWS.map(f => f.sentDate.getTime());
            const all = [...campTs, ...flowTs].filter(n => Number.isFinite(n));
            if (all.length) {
                let minTime = all[0];
                for (let i = 1; i < all.length; i++) { if (all[i] < minTime) minTime = all[i]; }
                const from = new Date(minTime);
                setCustomFrom(toISO(from));
                setCustomTo(toISO(to));
            } else {
                setCustomFrom(undefined);
                setCustomTo(undefined);
            }
        } else {
            const days = parseInt(String(dateRange).replace('d', ''));
            if (Number.isFinite(days)) {
                const from = new Date(to);
                from.setDate(from.getDate() - days + 1);
                setCustomFrom(toISO(from));
                setCustomTo(toISO(to));
            }
        }
    }, [dateRange, REFERENCE_DATE, ALL_CAMPAIGNS, ALL_FLOWS, hasData]);

    // Optimized date range change handler - use transitions for non-blocking updates
    const handleDateRangeChange = useCallback((value: string) => {
        startTransition(() => {
            setDateRange(value as any);
        });
    }, []);

    // Metrics calculations
    // Helper to aggregate all metrics in a single pass (performance optimization)
    type EmailMetrics = { revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number };
    const aggregateMetrics = (items: EmailMetrics[]) => {
        let totalRevenue = 0, totalEmailsSent = 0, totalOrders = 0, totalOpens = 0, totalClicks = 0, totalUnsubs = 0, totalSpam = 0, totalBounces = 0;
        for (const e of items) {
            totalRevenue += e.revenue;
            totalEmailsSent += e.emailsSent;
            totalOrders += e.totalOrders;
            totalOpens += e.uniqueOpens;
            totalClicks += e.uniqueClicks;
            totalUnsubs += e.unsubscribesCount;
            totalSpam += e.spamComplaintsCount;
            totalBounces += e.bouncesCount;
        }
        return { totalRevenue, totalEmailsSent, totalOrders, totalOpens, totalClicks, totalUnsubs, totalSpam, totalBounces };
    };

    const overviewMetrics = useMemo(() => {
        const all = [...defCampaigns, ...defFlowsOverview]; // use ALL flows for overview
        if (!all.length) return null as any;
        const { totalRevenue, totalEmailsSent, totalOrders, totalOpens, totalClicks, totalUnsubs, totalSpam, totalBounces } = aggregateMetrics(all);
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;
        const mk = (k: string, v: number) => {
            const d = calcPoP(k, 'all');
            return { value: v, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
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
            bounceRate: mk('bounceRate', bounceRate)
        };
    }, [defCampaigns, defFlowsOverview, calcPoP]);

    const campaignMetrics = useMemo(() => {
        const all = defCampaigns;
        if (!all.length) return null as any;
        const { totalRevenue, totalEmailsSent, totalOrders, totalOpens, totalClicks, totalUnsubs, totalSpam, totalBounces } = aggregateMetrics(all);
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;
        const mk = (k: string, v: number) => {
            const d = calcPoP(k, 'campaigns');
            return { value: v, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
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
            bounceRate: mk('bounceRate', bounceRate)
        };
    }, [defCampaigns, calcPoP]);

    const flowMetrics = useMemo(() => {
        const all = defFlows;
        if (!all.length) return null as any;
        const { totalRevenue, totalEmailsSent, totalOrders, totalOpens, totalClicks, totalUnsubs, totalSpam, totalBounces } = aggregateMetrics(all);
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;
        const mk = (k: string, v: number) => {
            const d = calcPoP(k, 'flows', { flowName: selectedFlow });
            return { value: v, change: d.changePercent, isPositive: d.isPositive, previousValue: d.previousValue, previousPeriod: d.previousPeriod };
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
            bounceRate: mk('bounceRate', bounceRate)
        };
    }, [defFlows, calcPoP, selectedFlow]);

    const effectiveSeriesRange = dateRange === 'custom' && customActive ? 'custom' : dateRange;
    const overviewSeries = useMemo(() => ({
        totalRevenue: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'revenue', effectiveSeriesRange, granularity, customFrom, customTo),
        averageOrderValue: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'avgOrderValue', effectiveSeriesRange, granularity, customFrom, customTo),
        revenuePerEmail: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'revenuePerEmail', effectiveSeriesRange, granularity, customFrom, customTo),
        openRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'openRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'clickRate', effectiveSeriesRange, granularity, customFrom, customTo),
        clickToOpenRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'clickToOpenRate', effectiveSeriesRange, granularity, customFrom, customTo),
        emailsSent: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'emailsSent', effectiveSeriesRange, granularity, customFrom, customTo),
        totalOrders: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'totalOrders', effectiveSeriesRange, granularity, customFrom, customTo),
        conversionRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'conversionRate', effectiveSeriesRange, granularity, customFrom, customTo),
        unsubscribeRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'unsubscribeRate', effectiveSeriesRange, granularity, customFrom, customTo),
        spamRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'spamRate', effectiveSeriesRange, granularity, customFrom, customTo),
        bounceRate: dm.getMetricTimeSeries(defCampaigns as any, defFlowsOverview as any, 'bounceRate', effectiveSeriesRange, granularity, customFrom, customTo),
    }), [defCampaigns, defFlowsOverview, effectiveSeriesRange, granularity, dm, customFrom, customTo]);
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

    const formatAbbreviated = (value: number, metric: string) => {
        if (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric)) {
            return formatPercent(value);
        }
        // Currency or Number
        const isCurrency = ['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metric);
        const abs = Math.abs(value);
        let suffix = '';
        let div = 1;
        if (abs >= 1000000) {
            suffix = 'M';
            div = 1000000;
        } else if (abs >= 1000) {
            suffix = 'K';
            div = 1000;
        }

        const val = value / div;
        let formatted = '';
        if (div === 1000000) formatted = val.toFixed(2);
        else if (div === 1000) formatted = val.toFixed(0);
        else formatted = val.toLocaleString('en-US', { maximumFractionDigits: 0 });

        if (isCurrency) return '$' + formatted + suffix;
        return formatted + suffix;
    };

    const abbreviatedBigValueForOverview = (metric: string) => {
        if (metric === 'none' || !overviewMetrics) return '';
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
        return formatAbbreviated(map[metric], metric);
    };

    const abbreviatedBigValueForCampaigns = (metric: string) => {
        if (metric === 'none' || !campaignMetrics) return '';
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
        return formatAbbreviated(map[metric], metric);
    };

    const abbreviatedBigValueForFlows = (metric: string) => {
        if (metric === 'none' || !flowMetrics) return '';
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
        return formatAbbreviated(map[metric], metric);
    };

    // Build chart series (primary + compare) per segment
    // IMPORTANT: Use full arrays (no date filtering) so previous-window data exists for compare.
    const overviewChartSeries = useMemo(
        () => dm.getMetricTimeSeriesWithCompare(ALL_CAMPAIGNS as any, ALL_FLOWS as any, overviewChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo),
        [dm, ALL_CAMPAIGNS, ALL_FLOWS, overviewChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );
    const overviewSecondaryChartSeries = useMemo(
        () => overviewSecondaryMetric !== 'none' ? dm.getMetricTimeSeriesWithCompare(ALL_CAMPAIGNS as any, ALL_FLOWS as any, overviewSecondaryMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo) : null,
        [dm, ALL_CAMPAIGNS, ALL_FLOWS, overviewSecondaryMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );

    const campaignChartSeries = useMemo(
        () => dm.getMetricTimeSeriesWithCompare(ALL_CAMPAIGNS as any, [], campaignChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo),
        [dm, ALL_CAMPAIGNS, campaignChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );
    const campaignSecondaryChartSeries = useMemo(
        () => campaignSecondaryMetric !== 'none' ? dm.getMetricTimeSeriesWithCompare(ALL_CAMPAIGNS as any, [], campaignSecondaryMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo) : null,
        [dm, ALL_CAMPAIGNS, campaignSecondaryMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );

    const flowsAllForChart = useMemo(
        () => (selectedFlow === 'all' ? ALL_FLOWS : ALL_FLOWS.filter(f => f.flowName === selectedFlow)),
        [ALL_FLOWS, selectedFlow]
    );
    const flowChartSeries = useMemo(
        () => dm.getMetricTimeSeriesWithCompare([], flowsAllForChart as any, flowChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo),
        [dm, flowsAllForChart, flowChartMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
    );
    const flowSecondaryChartSeries = useMemo(
        () => flowSecondaryMetric !== 'none' ? dm.getMetricTimeSeriesWithCompare([], flowsAllForChart as any, flowSecondaryMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo) : null,
        [dm, flowsAllForChart, flowSecondaryMetric, effectiveSeriesRange, granularity, compareMode, customFrom, customTo]
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
    const showOverlay = (forceDataOverlay && !noAccounts && !blockDashboard);

    if (dashboardError) { return <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md mx-auto text-center"><h2 className="text-lg font-semibold text-red-600 mb-4">Dashboard Error</h2><p className="text-gray-600 dark:text-gray-300 mb-6">{dashboardError}</p><div className="space-x-4"><button onClick={() => { setDashboardError(null); setDataVersion(v => v + 1); }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Retry</button><button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Reload Page</button></div></div></div>; }

    // Forced empty view (still respects header/footer from layout)
    if (forceEmpty) return <div className="min-h-screen" />;

    const showSelectAccountState = !HAS_ACTIVE_ACCOUNT;
    const showLoadingState = HAS_ACTIVE_ACCOUNT && accountLoadInFlight;
    const showNoDataState = HAS_ACTIVE_ACCOUNT && !accountLoadInFlight && !dataHydrated && accountHydrationAttempted;

    const uploadModal = showUploadModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowUploadModal(false)} />
            <div className="relative z-[61] w-[min(100%,900px)] max-h-[90vh] overflow-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Upload New Reports</h3>
                    <button onClick={() => setShowUploadModal(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <UploadWizard accountId={activeAccountId} onClose={() => setShowUploadModal(false)} />
            </div>
        </div>
    ) : null;

    // No account selected or no data: show guidance before rendering dashboard
    if (showSelectAccountState || showLoadingState || showNoDataState) {
        const label = activeAccountLabel || 'this account';
        return (
            <div className="min-h-screen flex flex-col items-center bg-gray-50 dark:bg-gray-900 px-4 py-8 gap-4">
                <div className="w-full max-w-3xl flex items-center justify-center gap-3">
                    {isAdmin ? (
                        <div className="w-full max-w-sm">
                            <AdminAccountPicker
                                accounts={allAccounts || []}
                                value={selectedAccountId || ''}
                                onChange={handleAdminAccountChange}
                                placeholder="Select account"
                                disabled={!!accountsError}
                            />
                        </div>
                    ) : (
                        <SelectBase
                            value={memberSelectedId || ''}
                            onChange={e => setMemberSelectedId((e.target as HTMLSelectElement).value)}
                            className="w-full max-w-sm text-sm"
                            minWidthClass="sm:min-w-[260px]"
                        >
                            <option value="">Select account</option>
                            {memberAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                        </SelectBase>
                    )}
                </div>
                <div className="flex flex-col items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm px-8 py-10 max-w-xl w-full text-center space-y-5">
                    {!accountLoadInFlight ? null : (
                        <div className="relative h-12 w-12 mx-auto">
                            <div className="absolute inset-0 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
                            <div className="absolute inset-2 rounded-full bg-white dark:bg-gray-800" />
                        </div>
                    )}
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                        {showSelectAccountState
                            ? 'Select an account to view your dashboard'
                            : showLoadingState
                                ? `Loading data for ${label}`
                                : `No data for ${label}`
                        }
                    </h2>
                    {showSelectAccountState ? null : (
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            {showLoadingState
                                ? 'Fetching your reports and metrics. This may take a few moments.'
                                : 'Upload CSV reports to view metrics for this brand.'}
                        </p>
                    )}
                    {showNoDataState && (
                        <div className="flex items-center justify-center">
                            <button
                                type="button"
                                onClick={() => setShowUploadModal(true)}
                                className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700"
                            >
                                Upload CSV reports
                            </button>
                        </div>
                    )}
                </div>
                {uploadModal}
            </div>
        );
    }

    if (blockDashboard) {
        // Watchdog fallback (billing fetch stalled)
        if (!billingStatusKnown && billingWatchdogFired) {
            return (
                <div className="min-h-screen flex items-center justify-center px-6 text-center bg-gray-50 dark:bg-gray-900">
                    <div className="max-w-sm space-y-4">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Billing Status Delayed</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-300">We’re having trouble confirming your plan. Please retry below. Your data is safe.</p>
                        {billingError && <p className="text-xs text-red-600 dark:text-red-400">{billingError}</p>}
                        <div className="flex flex-col sm:flex-row gap-2 justify-center">
                            <button onClick={retryBillingStatus} className="px-4 py-2 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700">Retry</button>
                            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600">Reload</button>
                        </div>
                    </div>
                </div>
            );
        }
        const planStatusText = billingStatusValue === 'inactive'
            ? 'Current status: No active plan'
            : `Current status: ${billingStatusValue}`;
        return (
            <div className="min-h-screen relative bg-gray-50 dark:bg-gray-900">
                <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
                    <div className="relative h-12 w-12">
                        <div className="absolute inset-0 rounded-full border-4 border-indigo-200 border-t-indigo-500 animate-spin" />
                        <div className="absolute inset-2 rounded-full bg-white dark:bg-gray-900" />
                    </div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Checking your plan…</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">We’re confirming your subscription status so you can access the dashboard.</p>
                </div>
                {showPlansModal && (
                    <ModalPlans
                        open={showPlansModal}
                        status={planStatusText}
                        onClose={() => setBillingModalOpen(false)}
                        onSelect={handleSelectBillingPlan}
                        onRefresh={handleRefreshBillingStatus}
                        busyPlan={billingActionCadence}
                        error={billingError}
                        onClaimFreeAccess={handleClaimFreeAccess}
                        claimingFreeAccess={claimingFreeAccess}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="min-h-screen relative">
            {showOverlay && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="flex flex-col items-center gap-4 text-center px-4">
                        <div className="relative h-12 w-12">
                            <div className="absolute inset-0 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
                            <div className="absolute inset-2 rounded-full bg-white dark:bg-gray-900" />
                        </div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Unlocking your dashboard…</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">We’re finalizing access so you can keep working.</p>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="pt-4 sm:pt-6">
                <div className="max-w-7xl mx-auto">
                    <div className="p-6 sm:p-8 mb-2">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                            <div>
                                <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Performance Dashboard</h1>
                                {activeAccountLabel && (
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{activeAccountLabel}</p>
                                )}
                            </div>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 relative ml-auto">
                                {isAdmin ? null : (
                                    <>
                                        {memberAccounts.length > 1 && (
                                            <SelectBase value={memberSelectedId} onChange={e => { const v = (e.target as HTMLSelectElement).value; setMemberSelectedId(v); const url = new URL(window.location.href); if (v) url.searchParams.set('account', v); else url.searchParams.delete('account'); window.history.replaceState(null, '', url.toString()); }} className="w-full sm:w-auto text-sm" minWidthClass="sm:min-w-[240px]">
                                                <option value="">Select account</option>
                                                {memberAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                                            </SelectBase>
                                        )}
                                    </>
                                )}
                                {isAdmin && (<>
                                    <AdminAccountPicker
                                        accounts={allAccounts || []}
                                        value={selectedAccountId}
                                        onChange={handleAdminAccountChange}
                                        placeholder="Select account"
                                        disabled={!!accountsError}
                                    />
                                    <button
                                        onClick={handleExportJson}
                                        disabled={exportBusy || !selectedAccountId}
                                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 h-8 sm:h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap leading-none disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <Share2 className="h-4 w-4" />
                                        {exportBusy ? 'Exporting…' : 'Export JSON'}
                                    </button>
                                </>)}
                                <button
                                    type="button"
                                    onClick={() => {
                                        console.log('[Dashboard] Upload New Reports button clicked', {
                                            HAS_ACTIVE_ACCOUNT,
                                            activeAccountId,
                                            currentShowUploadModal: showUploadModal
                                        });
                                        setUploadModalJustOpened(true);
                                        setShowUploadModal(true);
                                        console.log('[Dashboard] setShowUploadModal(true) called');
                                    }}
                                    disabled={!HAS_ACTIVE_ACCOUNT}
                                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white w-full sm:w-auto ${HAS_ACTIVE_ACCOUNT ? 'bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900' : 'bg-purple-400 cursor-not-allowed opacity-70'}`}
                                >
                                    <UploadIcon className="h-4 w-4" />
                                    Upload New Reports
                                </button>
                            </div>
                            {/* Status line removed per spec */}
                        </div>

                        {isAdmin && hasOpportunities && (
                            <div className="mt-4 rounded-xl border border-purple-100 dark:border-purple-900/40 bg-gradient-to-br from-purple-50 via-white to-white dark:from-purple-950/40 dark:via-gray-900 dark:to-gray-900 p-4 sm:p-5">
                                <div className="flex flex-col gap-6">
                                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">Total Potential Revenue Impact</p>
                                            <div className="mt-2 flex flex-wrap items-end gap-3 text-gray-700 dark:text-gray-200">
                                                <span className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(totalImpactValue)}</span>
                                                <span className="text-sm text-gray-600 dark:text-gray-400">{IMPACT_TIMEFRAME_SUFFIX[impactTimeframe]}</span>
                                                {shareOfBaseline != null ? (
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">Share of baseline: {formatPercent(shareOfBaseline)}</span>
                                                ) : null}
                                            </div>
                                            {selectedBaseline != null ? (
                                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Baseline (last 365 days): {formatCurrency(selectedBaseline)} {IMPACT_TIMEFRAME_SUFFIX[impactTimeframe]}</p>
                                            ) : null}
                                        </div>
                                        <div className="flex flex-col items-start gap-2 md:items-end">
                                            <div className="flex flex-col items-start sm:items-end gap-1">
                                                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Timeframe</span>
                                                <SelectBase
                                                    value={impactTimeframe}
                                                    onChange={e => setImpactTimeframe((e.target as HTMLSelectElement).value as ImpactTimeframe)}
                                                    className="text-xs h-8"
                                                    minWidthClass="min-w-[130px]"
                                                >
                                                    {IMPACT_TIMEFRAME_OPTIONS.map(opt => (
                                                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                                                    ))}
                                                </SelectBase>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownOpen(true)}
                                                className="inline-flex items-center gap-2 rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-200 hover:bg-purple-50 dark:hover:bg-purple-900/40"
                                            >
                                                View breakdown
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-4">
                                        {opportunityCategories.map(category => {
                                            const styles = CATEGORY_STYLES[category.key];
                                            const metadata = (category.metadata ?? {}) as Record<string, any>;
                                            const categoryAmount = convertAmount(category.totalAnnual);
                                            const shareTotal = category.percentOfOverall ?? 0;
                                            const baselineValue = getCategoryBaseline(category, impactTimeframe);
                                            const isSavings = category.key === 'audience';
                                            const tagClass = isSavings
                                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
                                            const baselineShare = !isSavings && category.percentOfBaseline != null
                                                ? category.percentOfBaseline
                                                : null;
                                            const baselineShareDisplay = baselineShare != null
                                                ? `+${formatPercent(baselineShare)}`
                                                : null;
                                            const suppressedCount = metadata?.deadWeightCount != null ? formatNumber(Number(metadata.deadWeightCount)) : '–';
                                            const currentPlan = metadata?.currentMonthlyPrice != null ? formatCurrency(Number(metadata.currentMonthlyPrice)) : null;
                                            const projectedPlan = metadata?.projectedMonthlyPrice != null ? formatCurrency(Number(metadata.projectedMonthlyPrice)) : null;
                                            const savingsPct = isSavings && category.percentOfBaseline != null ? category.percentOfBaseline : null;
                                            const sortedItems = [...category.items].sort((a, b) => b.amountAnnual - a.amountAnnual);
                                            const cardSpan = (() => {
                                                if (totalCategories <= 1) return 'lg:col-span-4';
                                                if (totalCategories === 2) {
                                                    if (hasCampaignCategory) {
                                                        return category.key === 'campaigns' ? 'lg:col-span-3' : 'lg:col-span-1';
                                                    }
                                                    return 'lg:col-span-2';
                                                }
                                                if (hasCampaignCategory && category.key === 'campaigns') {
                                                    return 'lg:col-span-2';
                                                }
                                                return 'lg:col-span-1';
                                            })();
                                            const tooltipContent = (
                                                <div className="space-y-2 max-w-xs">
                                                    {isSavings ? (
                                                        <div className="space-y-1">
                                                            <div className="font-semibold text-purple-700 dark:text-purple-200">Dead Weight Audience</div>
                                                            <div>Suppressed profiles: {suppressedCount}</div>
                                                            <div>{currentPlan && projectedPlan ? <>Plan: {currentPlan}/mo → {projectedPlan}/mo</> : 'Plan savings available after purge'}</div>
                                                            <div>Savings: {savingsPct != null ? formatPercent(savingsPct) : '–'}</div>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-1">
                                                            {sortedItems.map(item => (
                                                                <div key={`${item.module}-${item.scope || 'default'}`} className="flex items-center justify-between gap-3">
                                                                    <span className="font-medium text-gray-800 dark:text-gray-100 text-xs">{item.label}</span>
                                                                    <span className="text-xs text-gray-700 dark:text-gray-200">{formatCurrency(convertAmount(item.amountAnnual))}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-500 dark:text-gray-400">
                                                        Values reflect the selected timeframe.
                                                    </div>
                                                </div>
                                            );
                                            return (
                                                <TooltipPortal key={category.key} content={tooltipContent}>
                                                    <div className={`${cardSpan} cursor-help`}>
                                                        <div className={`relative h-full rounded-2xl border ${styles.border} ${styles.bg} p-5 shadow-sm transition hover:shadow-md`}>
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${styles.dot}`} />
                                                                    <span className={`text-sm font-semibold uppercase tracking-wide ${styles.label}`}>{category.label}</span>
                                                                </div>
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tagClass}`}>
                                                                    {isSavings ? 'Savings' : 'Lift'}
                                                                </span>
                                                            </div>
                                                            <div className="mt-4 flex items-baseline gap-2">
                                                                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(categoryAmount)}</span>
                                                                <span className="text-sm text-gray-600 dark:text-gray-400">{IMPACT_TIMEFRAME_SUFFIX[impactTimeframe]}</span>
                                                            </div>
                                                            <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                                                                <div>Share of total: {formatPercent(shareTotal)}</div>
                                                                {!isSavings && baselineShareDisplay ? (
                                                                    <div>Adds {baselineShareDisplay} vs baseline</div>
                                                                ) : null}
                                                            </div>
                                                            {isSavings ? (
                                                                <div className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                                                                    <div>Current plan: {currentPlan ?? '–'}</div>
                                                                    <div>After purge: {projectedPlan ?? '–'}</div>
                                                                    <div>Savings: {savingsPct != null ? formatPercent(savingsPct) : '–'}</div>
                                                                </div>
                                                            ) : baselineValue != null ? (
                                                                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">Baseline (365d): {formatCurrency(baselineValue)} {IMPACT_TIMEFRAME_SUFFIX[impactTimeframe]}</div>
                                                            ) : null}
                                                            <div className="mt-4">
                                                                <div className={`h-2 w-full rounded-full ${styles.barBg}`}>
                                                                    <div
                                                                        className={`h-2 rounded-full ${styles.barFill}`}
                                                                        style={{ width: `${Math.min(100, Math.max(0, shareTotal))}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TooltipPortal>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                    {/* Data Coverage & Age – only when an account is active */}
                    {HAS_ACTIVE_ACCOUNT && (
                        <>
                            <DataCoverageNotice dataManager={dm} referenceDate={REFERENCE_DATE} />
                            <DataAgeNotice dataManager={dm} onUploadClick={() => setShowUploadModal(true)} />
                        </>
                    )}
                </div>
            </div>

            {breakdownOpen && (
                <div className="fixed inset-0 z-[90] flex">
                    <button
                        type="button"
                        aria-label="Close breakdown"
                        className="flex-1 bg-black/30 backdrop-blur-sm"
                        onClick={() => setBreakdownOpen(false)}
                    />
                    <div className="relative h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-purple-200 dark:border-purple-800 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-5 py-4">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Total Potential Revenue Impact</p>
                            <button
                                type="button"
                                onClick={() => setBreakdownOpen(false)}
                                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                                aria-label="Close breakdown drawer"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="h-full overflow-y-auto px-5 py-4 space-y-6">
                            {opportunityCategories.map(category => {
                                const styles = CATEGORY_STYLES[category.key];
                                const sortedItems = [...category.items].sort((a, b) => b.amountAnnual - a.amountAnnual);
                                return (
                                    <div key={`drawer-${category.key}`}>
                                        <div className={`text-xs font-semibold uppercase tracking-wide ${styles.label}`}>{category.label}</div>
                                        <div className="mt-3 space-y-3">
                                            {sortedItems.length === 0 ? (
                                                <div className="text-xs text-gray-500 dark:text-gray-400">No line items to show.</div>
                                            ) : sortedItems.map(item => {
                                                const itemAmount = convertAmount(item.amountAnnual);
                                                const percentOfCategory = Math.max(0, Math.min(100, item.percentOfCategory ?? 0));
                                                const percentOfOverallItem = Math.max(0, Math.min(100, item.percentOfOverall ?? 0));
                                                return (
                                                    <div key={`drawer-${category.key}-${item.module}-${item.scope || 'default'}`} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950/40 p-3 transition hover:border-purple-200 dark:hover:border-purple-700">
                                                        <div className="flex items-center justify-between text-sm text-gray-900 dark:text-gray-100">
                                                            <span className="font-medium">{item.label}</span>
                                                            <span className="font-semibold">{formatCurrency(itemAmount)}</span>
                                                        </div>
                                                        <div className="mt-2 flex items-center gap-3">
                                                            <div className="h-2 flex-1 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                                                                <div className={`h-2 ${styles.barFill}`} style={{ width: `${percentOfCategory}%` }} />
                                                            </div>
                                                            <span className="text-[11px] text-gray-500 dark:text-gray-400">{formatPercent(percentOfCategory)}</span>
                                                        </div>
                                                        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Share of total: {formatPercent(percentOfOverallItem)}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                            {opportunityCategories.length === 0 && (
                                <div className="text-sm text-gray-500 dark:text-gray-400">No opportunity data available.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
            {uploadModal}
            {/* Klaviyo connect modal removed (CSV-only ingestion) */}
            {/* Filters bar (sticky) – hide when no active account */}
            {/* Mobile filters trigger (visible only on small screens) – hide when no active account */}
            {HAS_ACTIVE_ACCOUNT && (
                <div className="sm:hidden pt-2">
                    <div className="max-w-7xl mx-auto px-4">
                        <div className="flex items-center justify-end">
                            <button
                                onClick={() => { setMfDateRange(dateRange); setMfCustomFrom(customFrom); setMfCustomTo(customTo); setMfGranularity(granularity); setMfCompareMode(compareMode); setMfSelectedFlow(selectedFlow); setMobileFiltersOpen(true); }}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 shadow-sm"
                                aria-label="Open Filters"
                            >
                                {/* Decorative colored dot removed per brand simplification (BRANDING.md §Indicators). */}
                                Filters
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {HAS_ACTIVE_ACCOUNT && (
                <div className={`hidden sm:block sm:pt-2 ${stickyBar ? 'sm:sticky sm:top-0 sm:z-50' : ''}`}> <div className="max-w-7xl mx-auto px-4"><div className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${stickyBar ? 'shadow-lg' : 'shadow-sm'} px-3 py-2 sm:mx-[-30px]`}>
                    <div className="hidden sm:flex items-center justify-center gap-3 flex-nowrap whitespace-nowrap">
                        {/* New DateRangePicker component */}
                        <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Date Range:</span>
                            {isPending && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium">
                                    <RefreshCcw className="w-3 h-3 animate-spin" />
                                    Updating...
                                </span>
                            )}
                            <DateRangePicker
                                value={dateRangeValue}
                                onChange={handleDateRangePickerChange}
                                availability={dateAvailability}
                                maxRangeDays={730}
                                placeholder="Select custom range"
                            />
                        </div>
                        <div className="flex flex-col items-start gap-1"><div className="relative"><SelectBase value={dateRange === 'custom' ? '' : dateRange} onChange={e => handleDateRangeChange((e.target as HTMLSelectElement).value || '30d')} className="px-2 py-1 pr-8 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">
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
                                        <button
                                            onClick={() => setCompareMode('none')}
                                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${compareMode === 'none'
                                                ? 'bg-purple-600 text-white border-purple-600'
                                                : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'
                                                }`}
                                        >
                                            None
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div></div></div></div>
            )}

            {/* Mobile Filters Bottom Sheet – hide when no active account */}
            {HAS_ACTIVE_ACCOUNT && mobileFiltersOpen && (
                <div className="sm:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/40" onClick={() => setMobileFiltersOpen(false)} aria-hidden="true" />
                    {/* Sheet */}
                    <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl border-t border-gray-200 dark:border-gray-800 shadow-2xl">
                        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                            <div className="h-1 w-10 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto" aria-hidden></div>
                            <button onClick={() => setMobileFiltersOpen(false)} className="absolute right-3 top-2 p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Close">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-4 pb-4 max-h-[75vh] overflow-y-auto">
                            <div className="space-y-4">
                                {/* Date Range */}
                                <div>
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date Range</div>
                                    <div className="relative w-full">
                                        <SelectBase value={mfDateRange === 'custom' ? '' : mfDateRange} onChange={e => setMfDateRange(((e.target as HTMLSelectElement).value || '30d') as any)} className="w-full px-3 py-2 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">
                                            <option value="" disabled>Presets</option>
                                            <option value="30d">Last 30 days</option>
                                            <option value="60d">Last 60 days</option>
                                            <option value="90d">Last 90 days</option>
                                            <option value="120d">Last 120 days</option>
                                            <option value="180d">Last 180 days</option>
                                            <option value="365d">Last 365 days</option>
                                            <option value="all">Last 2 Years</option>
                                        </SelectBase>
                                    </div>
                                    {/* Custom dates */}
                                    <div className="mt-2 flex items-center gap-2">
                                        <input type="date" min={allowedMinISO} max={allowedMaxISO} value={mfCustomFrom || ''} onChange={e => { let v = e.target.value || undefined as any; if (v) { if (v < allowedMinISO) v = allowedMinISO; if (v > allowedMaxISO) v = allowedMaxISO; } setMfCustomFrom(v); if (v && mfCustomTo && new Date(v) > new Date(mfCustomTo)) setMfCustomTo(v); setMfDateRange('custom'); }} className="flex-1 px-3 py-2 rounded-md text-sm border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100" />
                                        <span className="text-sm text-gray-500">to</span>
                                        <input type="date" min={allowedMinISO} max={allowedMaxISO} value={mfCustomTo || ''} onChange={e => { let v = e.target.value || undefined as any; if (v) { if (v < allowedMinISO) v = allowedMinISO; if (v > allowedMaxISO) v = allowedMaxISO; } setMfCustomTo(v); if (v && mfCustomFrom && new Date(v) < new Date(mfCustomFrom)) setMfCustomFrom(v); setMfDateRange('custom'); }} className="flex-1 px-3 py-2 rounded-md text-sm border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100" />
                                    </div>
                                </div>

                                {/* Granularity */}
                                <div>
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Granularity</div>
                                    <div className="flex gap-2">
                                        {granularityOptions.map(option => (
                                            <button key={option.key} onClick={() => { if (!option.disabled) setMfGranularity(option.key); }} disabled={option.disabled} title={option.tooltip} className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${mfGranularity === option.key ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Compare */}
                                {(() => {
                                    const rangeKey = (mfDateRange === 'custom' && mfCustomFrom && mfCustomTo) ? `custom:${mfCustomFrom}:${mfCustomTo}` : mfDateRange;
                                    const prevAvail = dm.isCompareWindowAvailable(rangeKey, 'prev-period', mfCustomFrom, mfCustomTo);
                                    const yearAvail = dm.isCompareWindowAvailable(rangeKey, 'prev-year', mfCustomFrom, mfCustomTo);
                                    return (
                                        <div>
                                            <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Compare</div>
                                            <div className="flex gap-2">
                                                <button onClick={() => prevAvail && setMfCompareMode('prev-period')} disabled={!prevAvail} className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${mfCompareMode === 'prev-period' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Prev Period</button>
                                                <button onClick={() => yearAvail && setMfCompareMode('prev-year')} disabled={!yearAvail} className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${mfCompareMode === 'prev-year' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Prev Year</button>
                                                <button onClick={() => setMfCompareMode('none')} className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${mfCompareMode === 'none' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>None</button>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Flow selector (convenience) */}
                                {(() => {
                                    try {
                                        const liveFlows = (dm.getFlowEmails?.() || []).filter((e: any) => e?.status && String(e.status).toLowerCase() === 'live');
                                        const namesSet = new Set<string>();
                                        for (const e of liveFlows) { if (e?.flowName) namesSet.add(e.flowName); }
                                        const names = Array.from(namesSet).sort();
                                        return (
                                            <div>
                                                <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Flow</div>
                                                <div className="relative w-full">
                                                    <SelectBase value={mfSelectedFlow} onChange={e => setMfSelectedFlow((e.target as HTMLSelectElement).value)} className="w-full px-3 py-2 pr-9 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">
                                                        <option value="all">All Flows</option>
                                                        {names.map(n => <option key={n} value={n}>{n}</option>)}
                                                    </SelectBase>
                                                </div>
                                            </div>
                                        );
                                    } catch { return null; }
                                })()}
                            </div>
                        </div>
                        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur">
                            <div className="flex items-center justify-between">
                                <button onClick={() => { setMfDateRange('30d'); setMfCustomFrom(undefined); setMfCustomTo(undefined); setMfGranularity('daily'); setMfCompareMode('prev-period'); setMfSelectedFlow('all'); }} className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200">Reset</button>
                                <button onClick={() => { setDateRange(mfDateRange); setCustomFrom(mfCustomFrom); setCustomTo(mfCustomTo); setGranularity(mfGranularity); setCompareMode(mfCompareMode); setSelectedFlow(mfSelectedFlow); setMobileFiltersOpen(false); }} className="px-4 py-2 rounded-md bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700">Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Empty state (no data) – Admin, only when an account is selected and has no data */}
            {!showOverlay && !hasData && isAdmin && !!selectedAccountId && (
                <div className="px-6 pb-4">
                    <div className="max-w-3xl mx-auto mt-8">
                        <EmptyStateCard title="No data for this account yet" body="Upload CSV reports to view metrics for this brand." />
                    </div>
                </div>
            )}
            {/* Main content */}
            <div className="p-6"><div className="max-w-7xl mx-auto space-y-8">
                {(!isAdmin && memberBrandsLoaded && !HAS_ACTIVE_ACCOUNT) && (
                    <EmptyStateCard title="No account access yet" body="You don’t have access to any account. Ask an Admin to invite you." />
                )}
                {(isAdmin && !HAS_ACTIVE_ACCOUNT) && (
                    <EmptyStateCard title="Select an account" body="Choose an account from the selector above to view its dashboard." />
                )}
                {HAS_ACTIVE_ACCOUNT && (<>
                    {overviewMetrics && (
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <Mail className="w-5 h-5 text-purple-600" />
                                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Email Performance Overview
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
                            {/* Refresh button moved to header; keep section clean */}
                            {/* Overview Timeseries Chart */}
                            <TimeSeriesChart
                                title="Email Performance Overview"
                                metricKey={overviewChartMetric}
                                metricOptions={campaignMetricOptions as any}
                                onMetricChange={m => setOverviewChartMetric(m)}
                                bigValue={abbreviatedBigValueForOverview(overviewChartMetric)}
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
                                chartType={emailChartType}
                                onChartTypeChange={setEmailChartType}
                                secondaryMetricKey={overviewSecondaryMetric}
                                secondaryMetricOptions={campaignMetricOptions as any}
                                onSecondaryMetricChange={m => setOverviewSecondaryMetric(m as any)}
                                secondaryBigValue={abbreviatedBigValueForOverview(overviewSecondaryMetric)}
                                secondarySeries={overviewSecondaryChartSeries?.primary || null}
                                secondaryColorHue="#ec4899"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {/* Row 1 */}
                                <MetricCard title="Total Revenue" value={formatCurrency(overviewMetrics.totalRevenue.value)} change={overviewMetrics.totalRevenue.change} isPositive={overviewMetrics.totalRevenue.isPositive} previousValue={overviewMetrics.totalRevenue.previousValue} previousPeriod={overviewMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={overviewSeries.totalRevenue} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Average Order Value" value={formatCurrency(overviewMetrics.averageOrderValue.value)} change={overviewMetrics.averageOrderValue.change} isPositive={overviewMetrics.averageOrderValue.isPositive} previousValue={overviewMetrics.averageOrderValue.previousValue} previousPeriod={overviewMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={overviewSeries.averageOrderValue} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Total Orders" value={formatNumber(overviewMetrics.totalOrders.value)} change={overviewMetrics.totalOrders.change} isPositive={overviewMetrics.totalOrders.isPositive} previousValue={overviewMetrics.totalOrders.previousValue} previousPeriod={overviewMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={overviewSeries.totalOrders} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Conversion Rate" value={formatPercent(overviewMetrics.conversionRate.value)} change={overviewMetrics.conversionRate.change} isPositive={overviewMetrics.conversionRate.isPositive} previousValue={overviewMetrics.conversionRate.previousValue} previousPeriod={overviewMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={overviewSeries.conversionRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                                {/* Row 2 */}
                                <MetricCard title="Open Rate" value={formatPercent(overviewMetrics.openRate.value)} change={overviewMetrics.openRate.change} isPositive={overviewMetrics.openRate.isPositive} previousValue={overviewMetrics.openRate.previousValue} previousPeriod={overviewMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={overviewSeries.openRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Click Rate" value={formatPercent(overviewMetrics.clickRate.value)} change={overviewMetrics.clickRate.change} isPositive={overviewMetrics.clickRate.isPositive} previousValue={overviewMetrics.clickRate.previousValue} previousPeriod={overviewMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={overviewSeries.clickRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Click-to-Open Rate" value={formatPercent(overviewMetrics.clickToOpenRate.value)} change={overviewMetrics.clickToOpenRate.change} isPositive={overviewMetrics.clickToOpenRate.isPositive} previousValue={overviewMetrics.clickToOpenRate.previousValue} previousPeriod={overviewMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={overviewSeries.clickToOpenRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Revenue per Email" value={formatCurrency(overviewMetrics.revenuePerEmail.value)} change={overviewMetrics.revenuePerEmail.change} isPositive={overviewMetrics.revenuePerEmail.isPositive} previousValue={overviewMetrics.revenuePerEmail.previousValue} previousPeriod={overviewMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={overviewSeries.revenuePerEmail} compareMode={compareMode} category="email" chartType={emailChartType} />
                                {/* Row 3 */}
                                <MetricCard title="Emails Sent" value={formatNumber(overviewMetrics.emailsSent.value)} change={overviewMetrics.emailsSent.change} isPositive={overviewMetrics.emailsSent.isPositive} previousValue={overviewMetrics.emailsSent.previousValue} previousPeriod={overviewMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={overviewSeries.emailsSent} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Unsubscribe Rate" value={formatPercent(overviewMetrics.unsubscribeRate.value)} change={overviewMetrics.unsubscribeRate.change} isPositive={overviewMetrics.unsubscribeRate.isPositive} previousValue={overviewMetrics.unsubscribeRate.previousValue} previousPeriod={overviewMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={overviewSeries.unsubscribeRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Spam Rate" value={formatPercent(overviewMetrics.spamRate.value)} change={overviewMetrics.spamRate.change} isPositive={overviewMetrics.spamRate.isPositive} previousValue={overviewMetrics.spamRate.previousValue} previousPeriod={overviewMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={overviewSeries.spamRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                                <MetricCard title="Bounce Rate" value={formatPercent(overviewMetrics.bounceRate.value)} change={overviewMetrics.bounceRate.change} isPositive={overviewMetrics.bounceRate.isPositive} previousValue={overviewMetrics.bounceRate.previousValue} previousPeriod={overviewMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={overviewSeries.bounceRate} compareMode={compareMode} category="email" chartType={emailChartType} />
                            </div>
                            {/* Revenue Split Bar */}
                            <RevenueSplitBar campaigns={defCampaigns} flows={defFlowsOverview} />
                            {/* Split Share Over Time */}
                            <SplitShareOverTime
                                dateRange={dateRange}
                                granularity={granularity}
                                customFrom={customFrom}
                                customTo={customTo}
                                compareMode={compareMode}
                                filteredCampaigns={defCampaigns}
                                dateRangeBoundaries={dateRangeBoundaries}
                            />
                        </section>
                    )}
                    {campaignMetrics && (
                        <section>
                            <div className="flex items-center gap-2 mb-3">
                                <Send className="w-5 h-5 text-purple-600" />
                                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Campaign Performance
                                    <InfoTooltipIcon placement="top" content={(
                                        <div>
                                            <p className="font-semibold mb-1">What</p>
                                            <p>KPIs for campaign sends only.</p>
                                            <p className="font-semibold mt-2 mb-1">How</p>
                                            <p>Sort ascending/descending and inspect details to learn what drives outcomes.</p>
                                            <p className="font-semibold mt-2 mb-1">Why</p>
                                            <p>Reuse what works like offer, timing, and creative. Iterate on weak ones.</p>
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
                                bigValue={abbreviatedBigValueForCampaigns(campaignChartMetric)}
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
                                chartType={campaignChartType}
                                onChartTypeChange={setCampaignChartType}
                                secondaryMetricKey={campaignSecondaryMetric}
                                secondaryMetricOptions={campaignMetricOptions as any}
                                onSecondaryMetricChange={m => setCampaignSecondaryMetric(m as any)}
                                secondaryBigValue={abbreviatedBigValueForCampaigns(campaignSecondaryMetric)}
                                secondarySeries={campaignSecondaryChartSeries?.primary || null}
                                secondaryColorHue="#ec4899"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {/* Row 1 */}
                                <MetricCard title="Total Revenue" value={formatCurrency(campaignMetrics.totalRevenue.value)} change={campaignMetrics.totalRevenue.change} isPositive={campaignMetrics.totalRevenue.isPositive} previousValue={campaignMetrics.totalRevenue.previousValue} previousPeriod={campaignMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={campaignSeries.totalRevenue} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Average Order Value" value={formatCurrency(campaignMetrics.averageOrderValue.value)} change={campaignMetrics.averageOrderValue.change} isPositive={campaignMetrics.averageOrderValue.isPositive} previousValue={campaignMetrics.averageOrderValue.previousValue} previousPeriod={campaignMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={campaignSeries.averageOrderValue} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Total Orders" value={formatNumber(campaignMetrics.totalOrders.value)} change={campaignMetrics.totalOrders.change} isPositive={campaignMetrics.totalOrders.isPositive} previousValue={campaignMetrics.totalOrders.previousValue} previousPeriod={campaignMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={campaignSeries.totalOrders} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Conversion Rate" value={formatPercent(campaignMetrics.conversionRate.value)} change={campaignMetrics.conversionRate.change} isPositive={campaignMetrics.conversionRate.isPositive} previousValue={campaignMetrics.conversionRate.previousValue} previousPeriod={campaignMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={campaignSeries.conversionRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                {/* Row 2 */}
                                <MetricCard title="Open Rate" value={formatPercent(campaignMetrics.openRate.value)} change={campaignMetrics.openRate.change} isPositive={campaignMetrics.openRate.isPositive} previousValue={campaignMetrics.openRate.previousValue} previousPeriod={campaignMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={campaignSeries.openRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Click Rate" value={formatPercent(campaignMetrics.clickRate.value)} change={campaignMetrics.clickRate.change} isPositive={campaignMetrics.clickRate.isPositive} previousValue={campaignMetrics.clickRate.previousValue} previousPeriod={campaignMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={campaignSeries.clickRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Click-to-Open Rate" value={formatPercent(campaignMetrics.clickToOpenRate.value)} change={campaignMetrics.clickToOpenRate.change} isPositive={campaignMetrics.clickToOpenRate.isPositive} previousValue={campaignMetrics.clickToOpenRate.previousValue} previousPeriod={campaignMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={campaignSeries.clickToOpenRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Revenue per Email" value={formatCurrency(campaignMetrics.revenuePerEmail.value)} change={campaignMetrics.revenuePerEmail.change} isPositive={campaignMetrics.revenuePerEmail.isPositive} previousValue={campaignMetrics.revenuePerEmail.previousValue} previousPeriod={campaignMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={campaignSeries.revenuePerEmail} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                {/* Row 3 */}
                                <MetricCard title="Emails Sent" value={formatNumber(campaignMetrics.emailsSent.value)} change={campaignMetrics.emailsSent.change} isPositive={campaignMetrics.emailsSent.isPositive} previousValue={campaignMetrics.emailsSent.previousValue} previousPeriod={campaignMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={campaignSeries.emailsSent} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Unsubscribe Rate" value={formatPercent(campaignMetrics.unsubscribeRate.value)} change={campaignMetrics.unsubscribeRate.change} isPositive={campaignMetrics.unsubscribeRate.isPositive} previousValue={campaignMetrics.unsubscribeRate.previousValue} previousPeriod={campaignMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={campaignSeries.unsubscribeRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Spam Rate" value={formatPercent(campaignMetrics.spamRate.value)} change={campaignMetrics.spamRate.change} isPositive={campaignMetrics.spamRate.isPositive} previousValue={campaignMetrics.spamRate.previousValue} previousPeriod={campaignMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={campaignSeries.spamRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                                <MetricCard title="Bounce Rate" value={formatPercent(campaignMetrics.bounceRate.value)} change={campaignMetrics.bounceRate.change} isPositive={campaignMetrics.bounceRate.isPositive} previousValue={campaignMetrics.bounceRate.previousValue} previousPeriod={campaignMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={campaignSeries.bounceRate} compareMode={compareMode} category="campaign" chartType={campaignChartType} />
                            </div>
                        </section>
                    )}
                    {/* Campaign Send Volume Impact - moved above Send Frequency */}
                    {HAS_ACTIVE_ACCOUNT && (
                        <SendVolumeImpactV2
                            dateRange={dateRange}
                            granularity={granularity}
                            customFrom={customFrom}
                            customTo={customTo}
                            compareMode={compareMode}
                        />
                    )}
                    {/* Campaign Send Frequency */}
                    {HAS_ACTIVE_ACCOUNT && defCampaigns.length > 0 && (
                        <CampaignSendFrequency
                            campaigns={defCampaigns}
                            allCampaigns={ALL_CAMPAIGNS}
                            onGuidance={setFrequencyGuidance}
                        />
                    )}
                    {/* Audience Size Performance */}
                    {HAS_ACTIVE_ACCOUNT && defCampaigns.length > 0 && (
                        <AudienceSizePerformance
                            campaigns={defCampaigns}
                            allCampaigns={ALL_CAMPAIGNS}
                        />
                    )}
                    {/* Campaign Gaps and Losses */}
                    {HAS_ACTIVE_ACCOUNT && (
                        <CampaignGapsAndLosses
                            dateRange={dateRange}
                            granularity={granularity}
                            customFrom={customFrom}
                            customTo={customTo}
                            filteredCampaigns={defCampaigns}
                        />
                    )}
                    {/* Day of Week and Hour of Day Performance */}
                    {HAS_ACTIVE_ACCOUNT && defCampaigns.length > 0 && (
                        <>
                            <DayOfWeekPerformance
                                filteredCampaigns={defCampaigns}
                                dateRange={dateRange}
                                frequencyRecommendation={frequencyGuidance ? deriveFrequencyRecommendation(frequencyGuidance) : undefined}
                            />
                            <HourOfDayPerformance
                                filteredCampaigns={defCampaigns}
                                dateRange={dateRange}
                            />
                        </>
                    )}
                    {/* Campaign Details */}
                    {campaignMetrics && (
                        <section>
                            <div className="section-card">
                                <div className="section-header">
                                    <div className="flex items-center gap-2">
                                        <MailSearch className="w-5 h-5 text-purple-600" />
                                        <h3 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Campaign Details
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
                                        </h3>
                                    </div>
                                    <div className="section-controls flex-wrap gap-y-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Sort:</span>
                                            <div className="flex gap-1.5 ml-1 flex-nowrap">
                                                <button onClick={() => setCampaignSortOrder('desc')} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${campaignSortOrder === 'desc' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Desc</button>
                                                <button onClick={() => setCampaignSortOrder('asc')} className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${campaignSortOrder === 'asc' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'}`}>Asc</button>
                                            </div>
                                        </div>
                                        <div className="relative min-w-0 w-full sm:w-auto">
                                            <SelectBase value={selectedCampaignMetric} onChange={e => setSelectedCampaignMetric((e.target as HTMLSelectElement).value)} className="w-full sm:w-auto px-3 py-1.5 pr-8 rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">
                                                {campaignMetricOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                            </SelectBase>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    {getSortedCampaigns().slice(0, displayedCampaigns).map((c, i) => (
                                        <div key={c.id} className={`group relative p-3 sm:p-4 avoid-break ${i !== 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''} md:grid md:items-center md:gap-4 md:[grid-template-columns:minmax(0,1fr)_400px_max-content]`}>
                                            {/* Subject (col 1) */}
                                            <div className="md:col-start-1 md:col-end-2 min-w-0">
                                                <div className="flex items-center gap-3 mb-1.5">
                                                    <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.subject}</h4>
                                                </div>
                                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 truncate">{c.campaignName}</p>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">Sent on {c.sentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {c.sentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">{formatNumber(c.emailsSent)} recipients</p>
                                                {/* Segments removed per requirements */}
                                            </div>

                                            {/* Details (col 2 on md+, below on mobile) */}
                                            <div className="hidden md:flex md:col-start-2 md:col-end-3 justify-center">
                                                <div className="text-xs grid grid-cols-2 gap-x-6 gap-y-1">
                                                    {['revenue', 'revenuePerEmail', 'openRate', 'clickRate', 'clickToOpenRate', 'emailsSent', 'totalOrders', 'avgOrderValue', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].map(mk => (
                                                        <div key={mk} className="flex justify-between gap-4">
                                                            <span className="text-gray-500 dark:text-gray-400">{campaignMetricOptions.find(opt => opt.value === mk)?.label || mk}</span>
                                                            <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100">{formatMetricValue((c as any)[mk] as number, mk)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="md:hidden mt-3 flex justify-center">
                                                <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1">
                                                    {['revenue', 'revenuePerEmail', 'openRate', 'clickRate', 'clickToOpenRate', 'emailsSent', 'totalOrders', 'avgOrderValue', 'conversionRate', 'unsubscribeRate', 'spamRate', 'bounceRate'].map(mk => (
                                                        <div key={mk} className="flex justify-between gap-3">
                                                            <span className="text-gray-500 dark:text-gray-400">{campaignMetricOptions.find(opt => opt.value === mk)?.label || mk}</span>
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
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-purple-600" />
                                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Flow Performance
                                        <InfoTooltipIcon placement="top" content={(
                                            <div>
                                                <p className="font-semibold mb-1">What</p>
                                                <p>KPIs for flow emails only.</p>
                                                <p className="font-semibold mt-2 mb-1">How</p>
                                                <p>Compare flow performance metrics over time to identify trends and opportunities.</p>
                                                <p className="font-semibold mt-2 mb-1">Why</p>
                                                <p>Optimize your automated email sequences for better engagement and revenue.</p>
                                            </div>
                                        )} />
                                    </h2>
                                </div>
                                {(() => {
                                    try {
                                        const liveFlows = (dm.getFlowEmails?.() || []).filter((e: any) => e?.status && String(e.status).toLowerCase() === 'live');
                                        const namesSet = new Set<string>();
                                        for (const e of liveFlows) { if (e?.flowName) namesSet.add(e.flowName); }
                                        const names = Array.from(namesSet).sort();
                                        if (names.length === 0) return null;
                                        return (
                                            <div className="relative">
                                                <SelectBase value={selectedFlow} onChange={e => setSelectedFlow((e.target as HTMLSelectElement).value)} className="px-3 py-1.5 pr-8 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm">
                                                    <option value="all">All Flows</option>
                                                    {names.map(n => <option key={n} value={n}>{n}</option>)}
                                                </SelectBase>
                                            </div>
                                        );
                                    } catch { return null; }
                                })()}
                            </div>
                            {/* Flow Timeseries Chart */}
                            <TimeSeriesChart
                                title="Flow Performance"
                                metricKey={flowChartMetric}
                                metricOptions={campaignMetricOptions as any}
                                onMetricChange={m => setFlowChartMetric(m)}
                                bigValue={abbreviatedBigValueForFlows(flowChartMetric)}
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
                                chartType={flowChartType}
                                onChartTypeChange={setFlowChartType}
                                secondaryMetricKey={flowSecondaryMetric}
                                secondaryMetricOptions={campaignMetricOptions as any}
                                onSecondaryMetricChange={m => setFlowSecondaryMetric(m as any)}
                                secondaryBigValue={abbreviatedBigValueForFlows(flowSecondaryMetric)}
                                secondarySeries={flowSecondaryChartSeries?.primary || null}
                                secondaryColorHue="#ec4899"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {/* Row 1 */}
                                <MetricCard title="Total Revenue" value={formatCurrency(flowMetrics.totalRevenue.value)} change={flowMetrics.totalRevenue.change} isPositive={flowMetrics.totalRevenue.isPositive} previousValue={flowMetrics.totalRevenue.previousValue} previousPeriod={flowMetrics.totalRevenue.previousPeriod} dateRange={dateRange} metricKey="revenue" sparklineData={flowSeries.totalRevenue} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Average Order Value" value={formatCurrency(flowMetrics.averageOrderValue.value)} change={flowMetrics.averageOrderValue.change} isPositive={flowMetrics.averageOrderValue.isPositive} previousValue={flowMetrics.averageOrderValue.previousValue} previousPeriod={flowMetrics.averageOrderValue.previousPeriod} dateRange={dateRange} metricKey="avgOrderValue" sparklineData={flowSeries.averageOrderValue} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Total Orders" value={formatNumber(flowMetrics.totalOrders.value)} change={flowMetrics.totalOrders.change} isPositive={flowMetrics.totalOrders.isPositive} previousValue={flowMetrics.totalOrders.previousValue} previousPeriod={flowMetrics.totalOrders.previousPeriod} dateRange={dateRange} metricKey="totalOrders" sparklineData={flowSeries.totalOrders} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Conversion Rate" value={formatPercent(flowMetrics.conversionRate.value)} change={flowMetrics.conversionRate.change} isPositive={flowMetrics.conversionRate.isPositive} previousValue={flowMetrics.conversionRate.previousValue} previousPeriod={flowMetrics.conversionRate.previousPeriod} dateRange={dateRange} metricKey="conversionRate" sparklineData={flowSeries.conversionRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                {/* Row 2 */}
                                <MetricCard title="Open Rate" value={formatPercent(flowMetrics.openRate.value)} change={flowMetrics.openRate.change} isPositive={flowMetrics.openRate.isPositive} previousValue={flowMetrics.openRate.previousValue} previousPeriod={flowMetrics.openRate.previousPeriod} dateRange={dateRange} metricKey="openRate" sparklineData={flowSeries.openRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Click Rate" value={formatPercent(flowMetrics.clickRate.value)} change={flowMetrics.clickRate.change} isPositive={flowMetrics.clickRate.isPositive} previousValue={flowMetrics.clickRate.previousValue} previousPeriod={flowMetrics.clickRate.previousPeriod} dateRange={dateRange} metricKey="clickRate" sparklineData={flowSeries.clickRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Click-to-Open Rate" value={formatPercent(flowMetrics.clickToOpenRate.value)} change={flowMetrics.clickToOpenRate.change} isPositive={flowMetrics.clickToOpenRate.isPositive} previousValue={flowMetrics.clickToOpenRate.previousValue} previousPeriod={flowMetrics.clickToOpenRate.previousPeriod} dateRange={dateRange} metricKey="clickToOpenRate" sparklineData={flowSeries.clickToOpenRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Revenue per Email" value={formatCurrency(flowMetrics.revenuePerEmail.value)} change={flowMetrics.revenuePerEmail.change} isPositive={flowMetrics.revenuePerEmail.isPositive} previousValue={flowMetrics.revenuePerEmail.previousValue} previousPeriod={flowMetrics.revenuePerEmail.previousPeriod} dateRange={dateRange} metricKey="revenuePerEmail" sparklineData={flowSeries.revenuePerEmail} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                {/* Row 3 */}
                                <MetricCard title="Emails Sent" value={formatNumber(flowMetrics.emailsSent.value)} change={flowMetrics.emailsSent.change} isPositive={flowMetrics.emailsSent.isPositive} previousValue={flowMetrics.emailsSent.previousValue} previousPeriod={flowMetrics.emailsSent.previousPeriod} dateRange={dateRange} metricKey="emailsSent" sparklineData={flowSeries.emailsSent} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Unsubscribe Rate" value={formatPercent(flowMetrics.unsubscribeRate.value)} change={flowMetrics.unsubscribeRate.change} isPositive={flowMetrics.unsubscribeRate.isPositive} previousValue={flowMetrics.unsubscribeRate.previousValue} previousPeriod={flowMetrics.unsubscribeRate.previousPeriod} dateRange={dateRange} metricKey="unsubscribeRate" sparklineData={flowSeries.unsubscribeRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Spam Rate" value={formatPercent(flowMetrics.spamRate.value)} change={flowMetrics.spamRate.change} isPositive={flowMetrics.spamRate.isPositive} previousValue={flowMetrics.spamRate.previousValue} previousPeriod={flowMetrics.spamRate.previousPeriod} dateRange={dateRange} metricKey="spamRate" sparklineData={flowSeries.spamRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                                <MetricCard title="Bounce Rate" value={formatPercent(flowMetrics.bounceRate.value)} change={flowMetrics.bounceRate.change} isPositive={flowMetrics.bounceRate.isPositive} previousValue={flowMetrics.bounceRate.previousValue} previousPeriod={flowMetrics.bounceRate.previousPeriod} dateRange={dateRange} metricKey="bounceRate" sparklineData={flowSeries.bounceRate} compareMode={compareMode} category="flow" chartType={flowChartType} />
                            </div>
                        </section>
                    )}
                </>)}
                {/* Flow Step Analysis – only when an account is active */}
                {HAS_ACTIVE_ACCOUNT && (
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
                )}
                {HAS_ACTIVE_ACCOUNT && (
                    <AudienceCharts dateRange={dateRange} granularity={granularity} customFrom={customFrom} customTo={customTo} referenceDate={REFERENCE_DATE} />
                )}
                {/* Sticky end sentinel (1px spacer) */}
                <div ref={el => setStickyEndRef(el)} style={{ height: 1 }} />
                {HAS_ACTIVE_ACCOUNT && (
                    <section>
                        <CustomSegmentBlock
                            dateRange={dateRange}
                            customFrom={customFrom}
                            customTo={customTo}
                            referenceDate={REFERENCE_DATE}
                            onSetMainDateRange={(fromISO, toISO) => {
                                let from = fromISO;
                                let to = toISO;
                                // Clamp to allowed window
                                if (from && from < allowedMinISO) from = allowedMinISO;
                                if (to && to > allowedMaxISO) to = allowedMaxISO;
                                // Ensure from <= to
                                if (from && to && new Date(from) > new Date(to)) {
                                    to = from;
                                }
                                setCustomFrom(from);
                                setCustomTo(to);
                                setDateRange('custom');
                            }}
                        />
                    </section>
                )}
            </div></div>

            {/* Sharing feature removed */}
        </div>
    );
}
