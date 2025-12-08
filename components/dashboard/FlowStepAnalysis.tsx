"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { Workflow, AlertTriangle, ArrowUp, ArrowDown, ArrowRight, ChevronDown, BarChart2, TrendingUp } from 'lucide-react';
import SelectBase from "../ui/SelectBase";
import { DataManager } from '../../lib/data/dataManager';
import { thirdTicks, formatTickLabels, computeAxisMax } from '../../lib/utils/chartTicks';
import InfoTooltipIcon from '../InfoTooltipIcon';
import TooltipPortal from '../TooltipPortal';
import {
    getRiskZone,
    getDeliverabilityPoints,
    getDeliverabilityZoneWithContext,
    computeOptimalLookbackDays,
    computeOptimalLookbackDaysSnapped,
    snapToPreset,
    hasStatisticalSignificance,
    getDeliverabilityRiskMessage,
    getInsufficientDataMessage,
    RiskZone,
    AccountDeliverabilityContext,
    SPAM_GREEN_LIMIT,
    SPAM_RED_LIMIT,
    BOUNCE_GREEN_LIMIT,
    BOUNCE_RED_LIMIT,
    MIN_SAMPLE_SIZE
} from '../../lib/analytics/deliverabilityZones';
import {
    calculateMoneyPillarScoreStandalone,
    getStandaloneRevenueScore,
    formatAnnualizedRevenue,
    getStandaloneRevenueDescription,
    getCalibratedTiers
} from '../../lib/analytics/revenueTiers';
import {
    inferFlowType,
    projectNewStepRevenue
} from '../../lib/analytics/flowDecayFactors';

const usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const formatUsd = (value: number) => usdFormatter.format(value || 0);

type ChartType = 'line' | 'bar';

const MIN_STEP_EMAILS = 250;
const MIN_FLOW_EMAILS_FOR_CONFIDENCE = 2000;

const KEEP_NOTE_VARIANTS = [
    'keeps this flow steady.',
    'continues to deliver for this flow.',
    'is pulling its weight right now.'
];

const IMPROVE_NOTE_VARIANTS = [
    'is slipping behind.',
    'needs fresh momentum.',
    'could use a reset.'
];

const IMPROVE_GUIDANCE_VARIANTS = [
    'Test fresher creative or tighten the delay to regain momentum.',
    'Refresh the content and adjust timing to lift results.',
    'Swap in a new offer and experiment with a shorter delay.'
];

const PAUSE_NOTE_VARIANTS = [
    'is raising red flags.',
    'is dragging the flow\'s performance down.',
    'is putting this flow at risk.'
];

const PAUSE_GUIDANCE_VARIANTS = [
    'Pause it while you rebuild the trigger and creative.',
    'Keep it paused until you overhaul the message and retargeting.',
    'Pause it, rework the content, then relaunch once the metrics recover.'
];

const LOW_VOLUME_VARIANTS = [
    (sends: number, min: number) => `Only ${sends.toLocaleString('en-US')} sends so far. Let it reach at least ${min.toLocaleString('en-US')} before you judge it.`,
    (sends: number, min: number) => `${sends.toLocaleString('en-US')} sends isn't enough signal yet. Aim for ${min.toLocaleString('en-US')} before you decide.`,
    (sends: number, min: number) => `Give it time. ${sends.toLocaleString('en-US')} sends are logged, but we need about ${min.toLocaleString('en-US')} to call it.`
];

const pickVariant = <T,>(arr: T[], index: number): T => arr[index % arr.length];

function buildFlowHeadline(flowName: string, stats: { allLowVolume: boolean; allWeak: boolean; good: number; needsWork: number; pauseCount: number; totalSteps: number; actionableSteps: number }): string {
    const base = flowName?.trim() || 'This flow';
    const shortName = base.length > 48 ? `${base.slice(0, 45)}…` : base;
    if (stats.allLowVolume) return `${shortName} needs more data`;
    if (stats.allWeak) return `Rebuild ${shortName}`;
    if (stats.pauseCount > 0 && stats.needsWork > 0) return `Pause and refresh steps in ${shortName}`;
    if (stats.pauseCount > 0) return `Pause weak steps in ${shortName}`;
    if (stats.needsWork > 0 && stats.good > 0) return `Tune the weak links in ${shortName}`;
    if (stats.needsWork > 0) return `Refresh ${shortName}`;
    if (stats.good === stats.totalSteps && stats.totalSteps > 0) return `${shortName} is performing well`;
    return `${shortName} is on track`;
}

const METRIC_OPTIONS = [
    // Display label changed per request; metric key remains 'revenue'
    { value: 'revenue', label: 'Total Revenue', format: 'currency' },
    { value: 'emailsSent', label: 'Emails Sent', format: 'number' },
    { value: 'openRate', label: 'Open Rate', format: 'percentage' },
    { value: 'clickRate', label: 'Click Rate', format: 'percentage' },
    { value: 'clickToOpenRate', label: 'Click to Open Rate', format: 'percentage' },
    { value: 'conversionRate', label: 'Conversion Rate', format: 'percentage' },
    { value: 'unsubscribeRate', label: 'Unsubscribe Rate', format: 'percentage', isNegative: true },
    { value: 'bounceRate', label: 'Bounce Rate', format: 'percentage', isNegative: true },
    { value: 'spamRate', label: 'Spam Rate', format: 'percentage', isNegative: true },
    { value: 'avgOrderValue', label: 'Average Order Value', format: 'currency' },
    { value: 'revenuePerEmail', label: 'Revenue per Email', format: 'currency' },
    { value: 'totalOrders', label: 'Total Orders', format: 'number' }
] as const;

interface FlowStepAnalysisProps {
    dateRange: string;
    granularity: 'daily' | 'weekly' | 'monthly';
    customFrom?: string;
    customTo?: string;
    compareMode?: 'none' | 'prev-period' | 'prev-year';
}

interface FlowStepMetrics {
    sequencePosition: number;
    emailName: string;
    emailsSent: number;
    revenue: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    unsubscribeRate: number;
    avgOrderValue: number;
    dropOffRate: number;
    bounceRate: number;
    spamRate: number;
    revenuePerEmail: number;
    totalOrders: number;
    totalClicks: number;
    // Raw counts for contribution analysis
    spamComplaintsCount: number;
    bouncesCount: number;
}

export default function FlowStepAnalysis({ dateRange, granularity, customFrom, customTo, compareMode = 'prev-period' }: FlowStepAnalysisProps) {
    const DIAG_DASHBOARD = (process.env.NEXT_PUBLIC_DIAG_DASHBOARD === '1');
    // Re-render when dataset hydrates/persists so date windows and flow lists refresh
    const [dataTick, setDataTick] = useState(0);
    useEffect(() => {
        const onHydrated = () => setDataTick(t => t + 1);
        if (typeof window !== 'undefined') {
            window.addEventListener('em:dataset-hydrated', onHydrated as any);
            window.addEventListener('em:dataset-persisted', onHydrated as any);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('em:dataset-hydrated', onHydrated as any);
                window.removeEventListener('em:dataset-persisted', onHydrated as any);
            }
        };
    }, []);
    const [hoveredPoint, setHoveredPoint] = useState<{
        chartIndex: number;
        x: number;
        y: number;
        value: number;
        date: string;
        pointIndex: number;
    } | null>(null);

    const [chartType, setChartType] = useState<ChartType>('line');
    const [selectedFlow, setSelectedFlow] = useState<string>('');
    const [selectedMetric, setSelectedMetric] = useState<string>('revenue');
    const [actionNoteExpanded, setActionNoteExpanded] = useState<boolean>(false);
    const actionNoteContentId = useMemo(() => {
        if (!selectedFlow) return 'flow-action-note-content';
        return `flow-action-note-content-${selectedFlow.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
    }, [selectedFlow]);

    const dataManager = DataManager.getInstance();
    const resolvedRange = useMemo(() => dataManager.getResolvedDateRange(dateRange, customFrom, customTo), [dataManager, dateRange, customFrom, customTo]);
    const daysInRange = resolvedRange
        ? Math.max(1, Math.ceil((resolvedRange.endDate.getTime() - resolvedRange.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1)
        : 7;
    let periodLabel: 'day' | 'week' | 'month';
    let periodsInRange: number;
    switch (granularity) {
        case 'daily':
            periodLabel = 'day';
            periodsInRange = daysInRange;
            break;
        case 'monthly':
            periodLabel = 'month';
            periodsInRange = Math.max(1, Math.round(daysInRange / 30));
            break;
        case 'weekly':
        default:
            periodLabel = 'week';
            periodsInRange = Math.max(1, Math.round(daysInRange / 7));
            break;
    }
    const ALL_FLOW_EMAILS = dataManager.getFlowEmails();

    const toDateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const dateWindows = useMemo(() => {
        let startDate: Date, endDate: Date;

        // Handle custom date range
        if (dateRange === 'custom' && customFrom && customTo) {
            startDate = new Date(customFrom + 'T00:00:00');
            endDate = new Date(customTo + 'T23:59:59');
        } else if (dateRange === 'all') {
            return null; // All time doesn't need windowing
        } else {
            // Preset ranges
            const days = parseInt(dateRange.replace('d', ''));
            endDate = toDateOnly(dataManager.getLastEmailDate());
            startDate = toDateOnly(new Date(endDate));
            startDate.setDate(endDate.getDate() - days + 1); // Fix: add +1 to match DataManager logic
        }

        // Calculate period days to match DataManager logic exactly
        let periodDays: number;
        if (dateRange === 'custom' && customFrom && customTo) {
            // For custom ranges, use the same formula as DataManager (no +1)
            periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            // Ensure at least 1 day for same-day ranges
            if (periodDays === 0) periodDays = 1;
        } else {
            // For preset ranges, use the parsed value
            periodDays = parseInt(dateRange.replace('d', ''));
        }

        // Calculate previous comparison window based on compareMode
        let prevStartDate: Date, prevEndDate: Date;
        if (compareMode === 'prev-year') {
            prevStartDate = new Date(startDate);
            prevEndDate = new Date(endDate);
            prevStartDate.setFullYear(prevStartDate.getFullYear() - 1);
            prevEndDate.setFullYear(prevEndDate.getFullYear() - 1);
            // Leap day adjustments (if current range includes Feb 29 not present previous year)
            if (startDate.getMonth() === 1 && startDate.getDate() === 29 && prevStartDate.getMonth() === 2) prevStartDate.setDate(0);
            if (endDate.getMonth() === 1 && endDate.getDate() === 29 && prevEndDate.getMonth() === 2) prevEndDate.setDate(0);
        } else {
            if (periodDays === 1) {
                prevEndDate = new Date(startDate);
                prevEndDate.setDate(prevEndDate.getDate() - 1);
                prevEndDate.setHours(23, 59, 59, 999);
                prevStartDate = new Date(prevEndDate);
                prevStartDate.setHours(0, 0, 0, 0);
            } else {
                prevEndDate = new Date(startDate);
                prevEndDate.setDate(prevEndDate.getDate() - 1);
                prevEndDate.setHours(23, 59, 59, 999);
                prevStartDate = new Date(prevEndDate);
                prevStartDate.setDate(prevStartDate.getDate() - periodDays + 1);
                prevStartDate.setHours(0, 0, 0, 0);
            }
        }

        return {
            startDateOnly: toDateOnly(startDate),
            endDateOnly: toDateOnly(endDate),
            prevStartDateOnly: toDateOnly(prevStartDate),
            prevEndDateOnly: toDateOnly(prevEndDate),
            days: periodDays
        };
    }, [dateRange, customFrom, customTo, dataManager, compareMode, dataTick]);

    const liveFlowEmails = useMemo(() => ALL_FLOW_EMAILS.filter(e => e.status && e.status.toLowerCase() === 'live'), [ALL_FLOW_EMAILS]);

    const uniqueFlowNames = useMemo(() => {
        const names = new Set<string>();
        for (const e of liveFlowEmails) if (e.flowName) names.add(e.flowName);
        return Array.from(names).sort();
    }, [liveFlowEmails]);

    // Ensure we have a selected flow as soon as names arrive (fallback to first)
    useEffect(() => {
        if (!selectedFlow && uniqueFlowNames.length > 0) {
            setSelectedFlow(uniqueFlowNames[0]);
        }
    }, [selectedFlow, uniqueFlowNames]);

    const currentFlowEmails = useMemo(() => {
        if (!dateWindows) return liveFlowEmails; // All time
        const { startDateOnly, endDateOnly } = dateWindows;
        return liveFlowEmails.filter(e => {
            const sent = new Date(e.sentDate);
            return sent >= startDateOnly && sent <= endDateOnly;
        });
    }, [liveFlowEmails, dateWindows]);

    const previousFlowEmails = useMemo(() => {
        if (!dateWindows) return []; // No comparison for all time
        const { prevStartDateOnly, prevEndDateOnly } = dateWindows;
        return liveFlowEmails.filter(e => {
            const sent = new Date(e.sentDate);
            return sent >= prevStartDateOnly && sent <= prevEndDateOnly;
        });
    }, [liveFlowEmails, dateWindows]);

    const flowSequenceInfo = useMemo(() => {
        if (!selectedFlow) return null;
        return dataManager.getFlowSequenceInfo(selectedFlow);
    }, [selectedFlow, dataManager]);

    const duplicateNameCounts = useMemo((): Record<string, number> => {
        const counts: Record<string, number> = {};
        const names = flowSequenceInfo?.emailNames || [];
        for (const raw of names) {
            const name = (raw || '').trim();
            if (!name) continue;
            counts[name] = (counts[name] || 0) + 1;
        }
        return counts;
    }, [flowSequenceInfo]);

    const hasDuplicateNames = useMemo(() => Object.values(duplicateNameCounts).some(c => c > 1), [duplicateNameCounts]);

    // Detect out-of-order steps by median sent date per step (simple monotonicity check)
    const isOrderConsistent = useMemo(() => {
        if (!selectedFlow) return true;
        try {
            const byStep: Array<{ pos: number; median: number } | null> = [];
            for (let pos = 1; flowSequenceInfo && pos <= flowSequenceInfo.sequenceLength; pos++) {
                const emails = currentFlowEmails.filter(e => e.flowName === selectedFlow && e.sequencePosition === pos);
                if (!emails.length) { byStep.push(null); continue; }
                const times = emails.map(e => new Date(e.sentDate).getTime()).sort((a, b) => a - b);
                const mid = Math.floor(times.length / 2);
                const median = times.length % 2 === 0 ? Math.round((times[mid - 1] + times[mid]) / 2) : times[mid];
                byStep.push({ pos, median });
            }
            // Ignore nulls (missing steps), require non-decreasing medians
            let last: number | null = null;
            for (const rec of byStep) {
                if (!rec) continue;
                if (last != null && rec.median < last) return false;
                last = rec.median;
            }
            return true;
        } catch { return true; }
    }, [selectedFlow, flowSequenceInfo, currentFlowEmails]);

    // Summaries for auto-selection logic
    const flowSummaries = useMemo(() => {
        const map: Record<string, { revenue: number }> = {};
        currentFlowEmails.forEach(e => {
            if (!e.flowName) return;
            map[e.flowName] = { revenue: (map[e.flowName]?.revenue || 0) + e.revenue };
        });
        return Object.entries(map).map(([flowName, metrics]) => ({ flowName, metrics }));
    }, [currentFlowEmails]);

    const flowStepMetrics = useMemo((): FlowStepMetrics[] => {
        if (!selectedFlow || !flowSequenceInfo) {
            return [];
        }

        const flowEmails = currentFlowEmails.filter(email => email.flowName === selectedFlow);
        if (DIAG_DASHBOARD) console.log(`Flow emails for ${selectedFlow}:`, flowEmails.length);

        if (flowEmails.length === 0) {
            if (DIAG_DASHBOARD) console.warn(`No emails found for flow: ${selectedFlow}`);
            return [];
        }

        const stepMetrics: FlowStepMetrics[] = [];
        let previousEmailsSent = 0;

        flowSequenceInfo.messageIds.forEach((messageId, idx) => {
            let stepEmails = flowEmails.filter(email => email.flowMessageId === messageId);

            // Fallback: if no emails match messageId, try sequence position
            if (stepEmails.length === 0) {
                if (DIAG_DASHBOARD) console.warn(`No emails for messageId ${messageId}, trying sequence position ${idx + 1}`);
                stepEmails = flowEmails.filter(email => email.sequencePosition === idx + 1);
            }

            // If still no emails, create empty step
            if (stepEmails.length === 0) {
                if (DIAG_DASHBOARD) console.warn(`No emails found for step ${idx + 1} in flow ${selectedFlow}`);
                const emailName = flowSequenceInfo.emailNames[idx] || `Step ${idx + 1}`;
                stepMetrics.push({
                    sequencePosition: idx + 1,
                    emailName,
                    emailsSent: 0,
                    revenue: 0,
                    openRate: 0,
                    clickRate: 0,
                    clickToOpenRate: 0,
                    conversionRate: 0,
                    unsubscribeRate: 0,
                    avgOrderValue: 0,
                    dropOffRate: 0,
                    bounceRate: 0,
                    spamRate: 0,
                    revenuePerEmail: 0,
                    totalOrders: 0,
                    totalClicks: 0,
                    // Raw counts for contribution analysis
                    spamComplaintsCount: 0,
                    bouncesCount: 0
                });
                return;
            }

            const sortedStepEmails = [...stepEmails].sort((a, b) => a.sentDate.getTime() - b.sentDate.getTime());
            const emailName = flowSequenceInfo.emailNames[idx] ||
                (sortedStepEmails.length > 0 ? sortedStepEmails[sortedStepEmails.length - 1].emailName : `Step ${idx + 1}`);

            // Calculate aggregated metrics for this step
            const totalEmailsSent = sortedStepEmails.reduce((sum, email) => sum + email.emailsSent, 0);
            const totalRevenue = sortedStepEmails.reduce((sum, email) => sum + email.revenue, 0);
            const totalOrders = sortedStepEmails.reduce((sum, email) => sum + email.totalOrders, 0);
            const totalOpens = sortedStepEmails.reduce((sum, email) => sum + email.uniqueOpens, 0);
            const totalClicks = sortedStepEmails.reduce((sum, email) => sum + email.uniqueClicks, 0);
            const totalUnsubscribes = sortedStepEmails.reduce((sum, email) => sum + email.unsubscribesCount, 0);
            const totalBounces = sortedStepEmails.reduce((sum, email) => sum + email.bouncesCount, 0);
            const totalSpam = sortedStepEmails.reduce((sum, email) => sum + email.spamComplaintsCount, 0);

            // Calculate rates
            const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
            const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
            const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
            const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
            const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubscribes / totalEmailsSent) * 100 : 0;
            const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;
            const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
            const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
            const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;

            // Calculate drop-off rate
            let dropOffRate = 0;
            if (idx > 0 && previousEmailsSent > 0) {
                dropOffRate = ((previousEmailsSent - totalEmailsSent) / previousEmailsSent) * 100;
            }

            stepMetrics.push({
                sequencePosition: idx + 1,
                emailName,
                emailsSent: totalEmailsSent,
                revenue: totalRevenue,
                openRate,
                clickRate,
                clickToOpenRate,
                conversionRate,
                unsubscribeRate,
                avgOrderValue,
                dropOffRate,
                bounceRate,
                spamRate,
                revenuePerEmail,
                totalOrders,
                totalClicks,
                // Raw counts for contribution analysis
                spamComplaintsCount: totalSpam,
                bouncesCount: totalBounces
            });

            previousEmailsSent = totalEmailsSent;
        });

        if (DIAG_DASHBOARD) console.log(`Generated ${stepMetrics.length} step metrics for ${selectedFlow}`);
        return stepMetrics;
    }, [selectedFlow, currentFlowEmails, flowSequenceInfo]);

    // Memoize current and previous time series per step to avoid recomputation on render/hover
    const stepSeriesByPosition = useMemo(() => {
        const record: Record<number, { curr: { value: number; date: string }[]; prev: { value: number; date: string }[] }> = {};
        if (!selectedFlow || !flowSequenceInfo) return record;
        const dateToISO = (d: Date) => d.toISOString().slice(0, 10);
        const hasDateWindow = Boolean(dateWindows);
        const currFrom = hasDateWindow ? dateToISO(dateWindows!.startDateOnly) : customFrom;
        const currTo = hasDateWindow ? dateToISO(dateWindows!.endDateOnly) : customTo;
        const prevFrom = hasDateWindow ? dateToISO(dateWindows!.prevStartDateOnly) : undefined;
        const prevTo = hasDateWindow ? dateToISO(dateWindows!.prevEndDateOnly) : undefined;
        for (let position = 1; position <= flowSequenceInfo.sequenceLength; position++) {
            try {
                const curr = dataManager.getFlowStepTimeSeries(
                    currentFlowEmails,
                    selectedFlow,
                    position,
                    selectedMetric,
                    hasDateWindow ? 'custom' : dateRange,
                    granularity,
                    currFrom,
                    currTo
                ) as { value: number; date: string }[];

                let prev: { value: number; date: string }[] = [];
                if (dateWindows && dateRange !== 'all') {
                    try {
                        prev = dataManager.getFlowStepTimeSeries(
                            previousFlowEmails,
                            selectedFlow,
                            position,
                            selectedMetric,
                            'custom',
                            granularity,
                            prevFrom,
                            prevTo
                        ) as { value: number; date: string }[];
                    } catch { /* ignore */ }
                }
                record[position] = { curr, prev };
            } catch {
                record[position] = { curr: [], prev: [] };
            }
        }
        return record;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFlow, flowSequenceInfo, currentFlowEmails, previousFlowEmails, selectedMetric, dateRange, granularity, customFrom, customTo, dataManager, dateWindows]);

    // Flow Step Score (0–100) with simplified pillars:
    // Money (70) = Revenue Index (35) + Absolute Revenue (35) - auto-calibrated to account size
    // Deliverability (20) = Spam Zone (10) + Bounce Zone (10) with green/yellow/red thresholds
    // Statistical Confidence (10) = based on per-step dynamic lookback for statistical significance
    const stepScores = useMemo(() => {
        if (!flowStepMetrics.length || !selectedFlow) return { results: [] as any[], context: { rpeBaseline: 0, s1Sends: 0, flowType: 'default' } };
        const arr = flowStepMetrics;
        const s1Sends = arr[0]?.emailsSent || 0;
        const flowRevenueTotal = arr.reduce((sum, s) => sum + (s.revenue || 0), 0);
        const totalFlowSendsInWindow = arr.reduce((sum, s) => sum + (s.emailsSent || 0), 0);

        // Resolve account-wide window for store revenue and total sends (flows+campaigns)
        const dm = dataManager;
        const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
        const start = resolved?.startDate ?? new Date(0);
        const end = resolved?.endDate ?? new Date();
        const accountAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), dm.getFlowEmails(), start, end);
        const storeRevenueTotal = accountAgg.totalRevenue || 0;
        const accountSendsTotal = accountAgg.emailsSent || 0;

        // Build account deliverability context for contribution-weighted scoring
        const accountContext: AccountDeliverabilityContext = {
            accountSends: accountAgg.emailsSent || 0,
            accountSpamComplaints: accountAgg.spamComplaintsCount || 0,
            accountBounces: accountAgg.bouncesCount || 0,
            accountSpamRate: accountAgg.spamRate || 0,
            accountBounceRate: accountAgg.bounceRate || 0
        };

        // Infer flow type for decay factors and projections
        const flowType = inferFlowType(selectedFlow);

        // Compute date range days for lookback calculations
        const dateRangeDays = resolved
            ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
            : 30;

        const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

        // Compute RI baseline (median RPE across steps; if one-step flow, use flows-only account RPE)
        const rpesForBaseline = arr
            .filter(s => (s.emailsSent || 0) > 0)
            .map(s => {
                const e = s.emailsSent || 0; const r = s.revenue || 0; return e > 0 ? r / e : 0;
            })
            .sort((a, b) => a - b);
        let medianRPE = 0;
        if (rpesForBaseline.length > 0) {
            const mid = Math.floor(rpesForBaseline.length / 2);
            medianRPE = rpesForBaseline.length % 2 === 0 ? (rpesForBaseline[mid - 1] + rpesForBaseline[mid]) / 2 : rpesForBaseline[mid];
        }
        if (arr.length === 1) {
            try {
                const flowsOnlyAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), start, end);
                medianRPE = flowsOnlyAgg.revenuePerEmail || 0;
            } catch { }
        }

        // Compute flow-level optimal lookback for banner display (snapped to presets)
        const flowOptimalLookbackDays = computeOptimalLookbackDaysSnapped(totalFlowSendsInWindow, dateRangeDays);

        const results: Array<any> = [];

        for (let i = 0; i < arr.length; i++) {
            const s = arr[i];
            const emailsSent = s.emailsSent || 0;
            const notes: string[] = [];

            // Calculate per-step optimal lookback and statistical significance
            const sendShareOfAccount = accountSendsTotal > 0 ? emailsSent / accountSendsTotal : 0;
            const optimalLookbackDays = computeOptimalLookbackDays(emailsSent, dateRangeDays);
            const optimalLookbackDaysSnapped = computeOptimalLookbackDaysSnapped(emailsSent, dateRangeDays);

            // Check if current date range meets the step's optimal lookback
            const dateRangeAdequate = daysInRange >= optimalLookbackDays * 0.8;

            // Volume is "sufficient" for confident recommendations if:
            // 1. We have 250+ sends AND adequate date range, OR
            // 2. We have fewer sends but the date range is adequate (step is just low-volume by nature)
            const hasMinSampleSize = emailsSent >= MIN_SAMPLE_SIZE;
            const volumeSufficient = hasMinSampleSize && dateRangeAdequate;

            // For UI: distinguish between "needs more time" vs "low volume step"
            const isLowVolumeStep = !hasMinSampleSize;
            const needsMoreTime = !dateRangeAdequate;

            // Money pillar (max 70) using STANDALONE annualized revenue scoring
            const rpe = emailsSent > 0 ? s.revenue / emailsSent : 0;
            const moneyScore = calculateMoneyPillarScoreStandalone(rpe, medianRPE, s.revenue, dateRangeDays);

            if (moneyScore.riValue >= 1.4) notes.push('High Revenue Index');
            if (storeRevenueTotal <= 0) notes.push('No store revenue in window');

            // Check if this is a high-value step based on annualized revenue ($50k+/yr)
            const isHighValueStep = moneyScore.annualizedRevenue >= 50000;

            // Deliverability Score D (0–20) using CONTEXT-AWARE zone-based scoring
            const spam = s.spamRate; // percent
            const bounce = s.bounceRate; // percent
            const stepSpamComplaints = s.spamComplaintsCount || 0;
            const stepBounces = s.bouncesCount || 0;

            // Get raw zones for display (before context adjustment)
            const rawSpamZone: RiskZone = spam > SPAM_RED_LIMIT ? 'red' : spam >= SPAM_GREEN_LIMIT ? 'yellow' : 'green';
            const rawBounceZone: RiskZone = bounce > BOUNCE_RED_LIMIT ? 'red' : bounce >= BOUNCE_GREEN_LIMIT ? 'yellow' : 'green';
            const rawOverallZone = getRiskZone(spam, bounce);

            // Get context-aware zone (considers account health and contribution)
            const contextZoneResult = getDeliverabilityZoneWithContext(
                spam, bounce, emailsSent, stepSpamComplaints, stepBounces, accountContext
            );

            // Use effective zone for action decisions (may be downgraded from raw)
            const effectiveZone = contextZoneResult.effectiveZone;
            const deliverabilityPoints = contextZoneResult.points;
            const wasDowngraded = contextZoneResult.wasDowngraded;

            // Calculate approximate spam/bounce points based on effective zone (10 points each max)
            const spamZone = rawSpamZone; // Keep raw for display
            const bounceZone = rawBounceZone; // Keep raw for display
            const spamPoints = rawSpamZone === 'green' ? 10 : rawSpamZone === 'yellow' ? 6 : 0;
            const bouncePoints = rawBounceZone === 'green' ? 10 : rawBounceZone === 'yellow' ? 6 : 0;
            const baseD = spamPoints + bouncePoints;
            const lowVolumeAdjusted = wasDowngraded;

            // Use EFFECTIVE zone for action decisions (not raw zone)
            const hasRedZone = effectiveZone === 'red';
            const hasYellowZone = effectiveZone === 'yellow';
            const hasRawRedZone = rawOverallZone === 'red'; // For display purposes

            // Statistical Confidence (max 10): based on statistical significance
            const scPoints = volumeSufficient
                ? clamp(Math.floor(emailsSent / 100), 0, 10)
                : (dateRangeAdequate ? clamp(Math.floor(emailsSent / 50), 0, 5) : 0); // Partial credit if date range is OK

            const moneyPoints = moneyScore.totalPoints;
            const highMoney = (moneyPoints >= 55) || (moneyScore.riValue >= 1.4);
            const lowMoney = (moneyPoints <= 35);

            let score = clamp(moneyPoints + deliverabilityPoints + scPoints, 0, 100);
            let action: 'scale' | 'keep' | 'improve' | 'pause' | 'insufficient' = 'improve';

            // Action determination based on EFFECTIVE zones (context-aware)
            if (!volumeSufficient && needsMoreTime) {
                // Date range too short for this step's volume
                action = hasRedZone ? 'pause' : 'insufficient';
                if (hasRedZone) {
                    const riskMsg = getDeliverabilityRiskMessage(effectiveZone, spam, bounce);
                    if (riskMsg) notes.push(riskMsg);
                } else {
                    notes.push(`Extend date range to at least ${optimalLookbackDaysSnapped} days for reliable insights.`);
                }
            } else if (!volumeSufficient && isLowVolumeStep && dateRangeAdequate) {
                // Low volume step but date range is adequate - provide guidance, not alarm
                // Only show "insufficient" if also has concerning metrics
                if (hasRedZone) {
                    action = 'pause';
                    const riskMsg = getDeliverabilityRiskMessage(effectiveZone, spam, bounce);
                    if (riskMsg) notes.push(riskMsg);
                } else if (hasYellowZone && !highMoney) {
                    action = 'improve';
                    notes.push(`Limited data (${emailsSent} sends)—results may be noisy but date range is adequate.`);
                } else {
                    // Low volume but no concerning signals - give benefit of doubt
                    action = highMoney ? 'keep' : 'improve';
                    notes.push(`Limited data (${emailsSent} sends)—results may be noisy.`);
                }
            } else if (hasRedZone) {
                // Effective red zone: this means the step is actually hurting account deliverability
                action = 'pause';
                const riskMsg = getDeliverabilityRiskMessage(effectiveZone, spam, bounce);
                if (riskMsg) notes.push(riskMsg);
            } else if (hasYellowZone && highMoney) {
                // Yellow zone with good money: keep but warn about risk
                action = 'keep';
                if (wasDowngraded) {
                    // Was downgraded from red → note the context
                    notes.push(contextZoneResult.reason);
                } else {
                    notes.push('Deliverability approaching warning thresholds—monitor closely');
                }
            } else if (hasYellowZone && !highMoney) {
                // Yellow zone with weak money: improve
                action = 'improve';
                if (wasDowngraded) {
                    notes.push(contextZoneResult.reason);
                } else {
                    notes.push('Address deliverability concerns');
                }
            } else if (score >= 75) {
                action = 'scale';
            } else if (score >= 60) {
                action = 'keep';
            } else if (score >= 40) {
                action = 'improve';
            } else {
                action = 'pause';
            }

            // Guardrail for high annualized revenue cases
            // Since we now use context-aware zones, red zone means genuine account threat
            // But we can still add a note for high-value steps with yellow zone
            const flowShareForGuard = flowRevenueTotal > 0 ? (s.revenue / flowRevenueTotal) : 0;
            const highRevenueShare = flowShareForGuard >= 0.10;
            if (action === 'pause' && !hasRedZone && (isHighValueStep || highRevenueShare)) {
                action = 'keep';
                notes.push('High revenue guardrail');
            }

            const resObj = {
                score,
                action,
                volumeInsufficient: !volumeSufficient && needsMoreTime, // Only show "Low volume" if date range is too short
                isLowVolumeStep,  // Step has <250 sends
                dateRangeAdequate,  // Date range meets step's optimal lookback
                needsMoreTime,  // Date range is too short for this step
                notes,
                pillars: {
                    money: {
                        points: moneyPoints,
                        ri: moneyScore.riValue,
                        riPts: moneyScore.riPoints,
                        standaloneRevPts: moneyScore.standalonePoints,
                        standaloneTierLabel: moneyScore.standaloneTierLabel,
                        annualizedRevenue: moneyScore.annualizedRevenue,
                        monthlyRevenue: moneyScore.monthlyRevenue,
                        absoluteRevenue: s.revenue
                    },
                    deliverability: {
                        points: deliverabilityPoints,
                        base: baseD,
                        lowVolumeAdjusted,
                        spamZone,  // Raw zone for display
                        bounceZone,  // Raw zone for display
                        effectiveZone,  // Context-aware zone used for decisions
                        wasDowngraded,
                        contextReason: contextZoneResult.reason,
                        spamPoints,
                        bouncePoints,
                        spamContribution: contextZoneResult.spamContribution,
                        bounceContribution: contextZoneResult.bounceContribution,
                        hasRedZone,  // Based on effective zone
                        hasYellowZone,  // Based on effective zone
                        hasRawRedZone  // Raw zone before context
                    },
                    confidence: {
                        points: scPoints,
                        optimalLookbackDays,
                        hasStatisticalSignificance: volumeSufficient
                    }
                },
                baselines: { flowRevenueTotal, storeRevenueTotal, medianRPE, dateRangeDays, accountContext },
            };
            results.push(resObj);
        }

        return { results, context: { s1Sends, storeRevenueTotal, accountSendsTotal, flowType, medianRPE, dateRangeDays, flowOptimalLookbackDays, accountContext } } as const;
    }, [flowStepMetrics, dataManager, dateRange, customFrom, customTo, selectedFlow]);

    // Summary and indicator availability
    const indicatorAvailable = useMemo(() => !hasDuplicateNames && isOrderConsistent, [hasDuplicateNames, isOrderConsistent]);
    // Account-wide flow coverage to decide if we're already at max history
    const flowCoverage = useMemo(() => {
        if (!ALL_FLOW_EMAILS?.length) return { days: 0, totalSends: 0 };
        const sends = ALL_FLOW_EMAILS.reduce((sum, f) => sum + (f.emailsSent || 0), 0);
        const dateStamps = ALL_FLOW_EMAILS
            .map(f => f.sentDate?.getTime())
            .filter(n => Number.isFinite(n)) as number[];
        if (!dateStamps.length) return { days: 0, totalSends: sends };
        const min = Math.min(...dateStamps);
        const max = Math.max(...dateStamps);
        const days = Math.max(1, Math.round((max - min) / (1000 * 60 * 60 * 24)) + 1);
        return { days, totalSends: sends };
    }, [ALL_FLOW_EMAILS]);

    const isAtMaxAvailableRange = useMemo(() => {
        if (!flowCoverage.days) return false;
        return daysInRange >= flowCoverage.days * 0.9; // within 10% of full coverage
    }, [daysInRange, flowCoverage.days]);

    const hardLowVolumeWindow = useMemo(() => {
        // If we are looking at a long window (365+ days or max coverage) and still below threshold, treat as account-level low volume.
        const largeWindow = isAtMaxAvailableRange || daysInRange >= 365;
        return largeWindow && flowCoverage.totalSends > 0 && flowCoverage.totalSends < MIN_FLOW_EMAILS_FOR_CONFIDENCE;
    }, [daysInRange, flowCoverage.totalSends, isAtMaxAvailableRange]);

    const accountInsufficient = useMemo(() => {
        if (!flowCoverage.days) return false;
        // If we're already at the edge of historical coverage and still under the flow threshold,
        // or we have low volume even on large windows, treat it as account-level insufficiency.
        if (isAtMaxAvailableRange && flowCoverage.totalSends < MIN_FLOW_EMAILS_FOR_CONFIDENCE) return true;
        if (hardLowVolumeWindow) return true;
        return false;
    }, [flowCoverage.days, flowCoverage.totalSends, isAtMaxAvailableRange, hardLowVolumeWindow]);

    // Add-step suggestion logic with variance-based projections
    const addStepSuggestion = useMemo(() => {
        if (!indicatorAvailable || !flowStepMetrics.length || !selectedFlow) return { suggested: false } as any;
        const lastIdx = flowStepMetrics.length - 1;
        const last = flowStepMetrics[lastIdx];
        const s1Sends = (stepScores as any).context?.s1Sends as number;
        const flowType = (stepScores as any).context?.flowType || 'default';
        const medianRPE = (stepScores as any).context?.medianRPE || 0;
        const lastRes = (stepScores as any).results?.[lastIdx] as any | undefined;
        const lastScoreVal = Number(lastRes?.score) || 0;

        // Check if last step has any red zone issues
        const lastHasRedZone = lastRes?.pillars?.deliverability?.hasRedZone;

        const volumeOk = last.emailsSent >= Math.max(MIN_STEP_EMAILS, Math.round(0.05 * s1Sends));
        // Deliverability gate: no red zone on last step
        const deliverabilityOk = !lastHasRedZone;

        // RPE checks
        const rpeOk = medianRPE > 0 ? last.revenuePerEmail >= medianRPE : true;
        const prev = lastIdx > 0 ? flowStepMetrics[lastIdx - 1] : null;
        const deltaRpeOk = prev ? (last.revenuePerEmail - prev.revenuePerEmail) >= 0 : true;

        const lastStepRevenue = last.revenue || 0;
        const flowRevenue = flowStepMetrics.reduce((sum, s) => sum + (s.revenue || 0), 0);
        const lastRevenuePct = flowRevenue > 0 ? (lastStepRevenue / flowRevenue) * 100 : 0;

        // Get annualized revenue for high-value check
        const dateRangeDays = (stepScores as any).context?.dateRangeDays || 30;
        const standaloneResult = getStandaloneRevenueScore(lastStepRevenue, dateRangeDays);
        const isHighValueStep = standaloneResult.annualizedRevenue >= 50000; // $50k+/yr
        const absoluteRevenueOk = (lastStepRevenue >= 500) || (lastRevenuePct >= 5);

        // Date window gating
        const dm = dataManager;
        const lastEmailDate = dm.getLastEmailDate();
        const endsAtLast = (dateRange === 'custom')
            ? (customTo ? new Date(customTo).toDateString() === lastEmailDate.toDateString() : false)
            : true;
        const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
        const days = resolved ? Math.max(1, Math.ceil((resolved.endDate.getTime() - resolved.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1) : 0;
        const weeksInRange = Math.max(1, days / 7);
        const isRecentWindow = endsAtLast;

        // Suggest add-step: lower score threshold (65) for high-value steps ($50k+/yr)
        // High-value steps can bypass RPE comparisons since absolute revenue is compelling
        const scoreThreshold = isHighValueStep ? 65 : 75;
        const rpeGatesPass = isHighValueStep ? true : (rpeOk && deltaRpeOk);
        const suggested = (lastScoreVal >= scoreThreshold) && deliverabilityOk && rpeGatesPass && volumeOk && absoluteRevenueOk && isRecentWindow;

        // Generate variance-based projection using the new utility
        let projection = null;
        if (suggested || (volumeOk && isRecentWindow)) {
            const stepRPEs = flowStepMetrics.map(s => s.revenuePerEmail).filter(r => r > 0);
            projection = projectNewStepRevenue(
                selectedFlow,
                last.emailsSent,
                last.revenuePerEmail,
                stepRPEs,
                medianRPE,
                weeksInRange
            );
        }

        const reason = suggested
            ? (isHighValueStep
                ? `This step generates ${standaloneResult.tierLabel.toLowerCase()} revenue (~$${Math.round(standaloneResult.monthlyRevenue / 1000)}k/mo)—a follow-up could add significant value`
                : (flowStepMetrics.length === 1
                    ? 'Strong RPE and healthy deliverability'
                    : `Email ${last.sequencePosition} performing well; follow-up could add value`))
            : undefined;

        return {
            suggested,
            reason,
            horizonDays: isRecentWindow ? days : undefined,
            projection: projection ? {
                expectedRevenue: projection.projectedRevenuePerWeek.mid,
                lowEstimate: projection.projectedRevenuePerWeek.low,
                highEstimate: projection.projectedRevenuePerWeek.high,
                projectedReach: projection.projectedReachPerWeek,
                expectedRPE: projection.conservativeRPE,
                decayFactor: projection.decayFactor,
                confidenceLevel: projection.confidenceLevel,
                flowType: projection.flowType
            } : undefined,
            // Legacy estimate format for backward compatibility
            estimate: projection ? {
                projectedReach: projection.projectedReachPerWeek,
                rpeFloor: projection.conservativeRPE,
                estimatedRevenue: projection.projectedRevenuePerWeek.mid,
                assumptions: {
                    reachPctOfLastStep: projection.decayFactor,
                    rpePercentile: 25,
                    clampedToLastStepRpe: true
                }
            } : undefined,
            gates: {
                lastStepRevenue,
                lastStepRevenuePctOfFlow: lastRevenuePct,
                deliverabilityOk,
                volumeOk,
                rpeOk,
                deltaRpeOk,
                absoluteRevenueOk,
                isRecentWindow,
                lastScoreVal
            }
        } as const;
    }, [indicatorAvailable, flowStepMetrics, stepScores, dataManager, dateRange, customFrom, customTo, selectedFlow]);

    const flowActionNote = useMemo(() => {
        if (!selectedFlow || !flowStepMetrics.length) return null;
        const results = (stepScores as any).results as Array<any> | undefined;
        if (!results) return null;

        const stepItems: React.ReactNode[] = [];
        let good = 0;
        let needsWork = 0;
        let pauseCount = 0;
        let lowVolume = 0;

        const renderSentence = (fragments: React.ReactNode[]) => (
            <span>
                {fragments.map((fragment, fragmentIdx) => (
                    <React.Fragment key={fragmentIdx}>
                        {fragmentIdx > 0 ? ' ' : null}
                        {fragment}
                    </React.Fragment>
                ))}
            </span>
        );

        const joinWithAnd = (items: string[]) => {
            if (!items.length) return '';
            if (items.length === 1) return items[0];
            if (items.length === 2) return `${items[0]} and ${items[1]}`;
            return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
        };

        flowStepMetrics.forEach((step, idx) => {
            const res = results[idx];
            if (!res) return;
            const emailBaseLabel = `Email ${step.sequencePosition}`;
            const emailName = (step.emailName || '').trim();
            const label = emailName ? `${emailBaseLabel} (${emailName})` : emailBaseLabel;
            const labelNode = <strong className="font-semibold">{label}</strong>;
            const emails = step.emailsSent || 0;
            if (res.volumeInsufficient) {
                lowVolume++;
                const lowVolumeMessage = pickVariant(LOW_VOLUME_VARIANTS, idx)(emails, MIN_STEP_EMAILS);
                stepItems.push(renderSentence([
                    <>{labelNode} needs more data.</>,
                    lowVolumeMessage
                ]));
                return;
            }

            const ri = res.pillars?.money?.ri ?? 0;
            const ersPct = (res.pillars?.money?.storeShare ?? 0) * 100;
            const openRate = step.openRate ?? 0;
            const clickRate = step.clickRate ?? 0;
            const unsubRate = step.unsubscribeRate ?? 0;
            const spamRate = step.spamRate ?? 0;
            const perPeriodRevenue = periodsInRange > 0 ? step.revenue / periodsInRange : step.revenue;
            const revenueText = formatUsd(perPeriodRevenue);
            const riDelta = (ri - 1) * 100;

            const perEmailDetail = (() => {
                if (!isFinite(ri) || !isFinite(riDelta)) return '';
                const deltaAbs = Math.round(Math.abs(riDelta));
                if (deltaAbs < 5) return 'Per-email revenue is roughly in line with this flow\'s median';
                const direction = riDelta >= 0 ? 'above' : 'below';
                return `Per-email revenue sits about ${deltaAbs}% ${direction} the flow\'s median`;
            })();

            const issueSummary = () => {
                const notes: string[] = [];
                if (ri < 1) notes.push('per-email revenue trails the flow average');
                if (ersPct < 0.5) notes.push(`it contributed only ${ersPct.toFixed(1)}% of this flow\'s revenue in the selected window`);
                if (openRate < 20) notes.push(`opens are ${openRate.toFixed(1)}%`);
                if (clickRate < 1) notes.push(`clicks are ${clickRate.toFixed(1)}%`);
                if (unsubRate > 1) notes.push(`unsubscribe rate is ${unsubRate.toFixed(2)}%`);
                if (spamRate >= 0.3) notes.push(`spam complaints are ${spamRate.toFixed(3)}%`);
                if (!notes.length) return 'Performance is lagging benchmarks.';
                return `${notes.length > 1 ? 'Key issues: ' : 'Key issue: '}${joinWithAnd(notes)}.`;
            };

            const shareSentence = `It drove ${ersPct.toFixed(1)}% of this flow\'s revenue in the selected window.`;
            const perEmailSentence = perEmailDetail ? `${perEmailDetail}.` : '';
            const revenueSentence = `Average revenue: ${revenueText} per ${periodLabel}.`;
            const engagementParts: string[] = [];
            if (openRate > 0) engagementParts.push(`opens around ${openRate.toFixed(1)}%`);
            if (clickRate > 0) engagementParts.push(`clicks at ${clickRate.toFixed(1)}%`);
            const engagementSentence = engagementParts.length ? `Engagement runs with ${joinWithAnd(engagementParts)}.` : '';
            const detailSentence = [shareSentence, perEmailSentence, revenueSentence, engagementSentence].filter(Boolean).join(' ');

            switch (res.action as 'scale' | 'keep' | 'improve' | 'pause' | 'insufficient') {
                case 'scale':
                case 'keep': {
                    good++;
                    const keepFragments: React.ReactNode[] = [
                        <>{labelNode} {pickVariant(KEEP_NOTE_VARIANTS, idx)}</>
                    ];
                    if (detailSentence) keepFragments.push(detailSentence);
                    stepItems.push(renderSentence(keepFragments));
                    break;
                }
                case 'improve': {
                    needsWork++;
                    const issue = issueSummary();
                    const improveFragments: React.ReactNode[] = [
                        <>{labelNode} {pickVariant(IMPROVE_NOTE_VARIANTS, idx)}</>,
                        issue
                    ];
                    if (detailSentence) improveFragments.push(detailSentence);
                    improveFragments.push(pickVariant(IMPROVE_GUIDANCE_VARIANTS, idx));
                    stepItems.push(renderSentence(improveFragments));
                    break;
                }
                case 'pause': {
                    pauseCount++;
                    const issue = issueSummary();
                    const pauseFragments: React.ReactNode[] = [
                        <>{labelNode} {pickVariant(PAUSE_NOTE_VARIANTS, idx)}</>,
                        issue
                    ];
                    if (detailSentence) pauseFragments.push(detailSentence);
                    pauseFragments.push(pickVariant(PAUSE_GUIDANCE_VARIANTS, idx));
                    stepItems.push(
                        <span className="text-rose-700 dark:text-rose-300">
                            {pauseFragments.map((fragment, fragmentIdx) => (
                                <React.Fragment key={fragmentIdx}>
                                    {fragmentIdx > 0 ? ' ' : null}
                                    {fragment}
                                </React.Fragment>
                            ))}
                        </span>
                    );
                    break;
                }
                default:
                    break;
            }
        });

        const totalSteps = flowStepMetrics.length;
        const actionableSteps = totalSteps - lowVolume;
        const allLowVolume = lowVolume === totalSteps;
        const allWeak = actionableSteps > 0 && good === 0 && (needsWork + pauseCount === actionableSteps);

        const headlineTitle = buildFlowHeadline(selectedFlow, { allLowVolume, allWeak, good, needsWork, pauseCount, totalSteps, actionableSteps });
        let title = headlineTitle;
        let bodyParts: string[] = [];
        if (allLowVolume) {
            bodyParts = [`Each email has fewer than ${MIN_STEP_EMAILS.toLocaleString('en-US')} sends. Let this flow run longer before making changes.`];
        } else if (allWeak) {
            bodyParts = ['Every email trails benchmarks. Revisit the trigger and refresh each message before adding more touches.'];
        } else {
            const parts: string[] = [];
            if (good > 0) {
                if (good === totalSteps) {
                    const word = totalSteps === 1 ? 'email' : (totalSteps === 2 ? 'two emails' : totalSteps === 3 ? 'all three emails' : `all ${totalSteps} emails`);
                    const wordCap = `${word.charAt(0).toUpperCase()}${word.slice(1)} are performing well.`;
                    parts.push(`${wordCap} Keep them running.`);
                } else {
                    const countWord = (() => {
                        if (good === 1) return 'One email is';
                        if (good === 2) return 'Two emails are';
                        if (good === 3) return 'Three emails are';
                        return `${good} emails are`;
                    })();
                    parts.push(`${countWord} performing well. Keep them running.`);
                }
            }
            if (needsWork > 0) parts.push(`${needsWork === 1 ? 'One email needs testing' : `${needsWork} emails need testing`} to improve timing or creative.`);
            if (pauseCount > 0) parts.push(`${pauseCount === 1 ? 'Pause the flagged email' : 'Pause the flagged emails'} until you rebuild them.`);
            if (lowVolume > 0) parts.push(`Collect more sends for the ${lowVolume === 1 ? 'low-volume email' : 'low-volume emails'}.`);
            bodyParts = parts.length ? [parts.join(' ')] : [];
        }

        if ((addStepSuggestion as any)?.suggested && (addStepSuggestion as any)?.estimate) {
            const lastStep = flowStepMetrics[flowStepMetrics.length - 1];
            const est = (addStepSuggestion as any).estimate;
            const perPeriodGain = periodsInRange > 0 ? est.estimatedRevenue / periodsInRange : est.estimatedRevenue;
            stepItems.push(
                <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    Adding one more email after <strong>Email {lastStep.sequencePosition}</strong> could unlock an estimated revenue increase of {formatUsd(perPeriodGain)} per {periodLabel}.
                </span>
            );
        }

        const totalSends = flowStepMetrics.reduce((sum, step) => sum + (step.emailsSent || 0), 0);
        const sample = `Based on ${totalSends.toLocaleString('en-US')} emails in this flow during the selected range. Review this flow across other date ranges and make sure it supports any objectives beyond revenue before acting.`;

        return { title, bodyParts, items: stepItems, sample };
    }, [selectedFlow, flowStepMetrics, stepScores, addStepSuggestion, periodsInRange, periodLabel]);

    const getStepSparklineData = React.useCallback((sequencePosition: number, _metric: string) => {
        if (!selectedFlow) return [] as { value: number; date: string }[];
        return stepSeriesByPosition[sequencePosition]?.curr || [];
    }, [selectedFlow, stepSeriesByPosition]);

    const getStepYAxisRange = (currSeries: { value: number; date: string }[], prevSeries: { value: number; date: string }[]) => {
        const metricConfig = METRIC_OPTIONS.find(m => m.value === selectedMetric);
        const type = metricConfig?.format === 'currency' ? 'currency' : metricConfig?.format === 'percentage' ? 'percentage' : 'number';
        const currValues = currSeries.map(d => Math.max(0, d.value));
        const prevValues = prevSeries.map(d => Math.max(0, d.value));
        if (currValues.length === 0 && prevValues.length === 0) return { min: 0, max: 10 };
        const max = computeAxisMax(currValues, prevValues.length > 0 ? prevValues : null, type as any);
        return { min: 0, max };
    };

    const getStepPeriodChange = (sequencePosition: number, metric: string): { change: number; isPositive: boolean; previousValue: number; previousPeriod: { startDate: Date; endDate: Date } } | null => {
        if (!selectedFlow || dateRange === 'all') return null;
        const currStepEmails = currentFlowEmails.filter(e => e.flowName === selectedFlow && e.sequencePosition === sequencePosition);
        const prevStepEmails = previousFlowEmails.filter(e => e.flowName === selectedFlow && e.sequencePosition === sequencePosition);
        if (currStepEmails.length === 0) return null;
        const totals = (emails: typeof currStepEmails) => emails.reduce((acc, e) => ({
            emailsSent: acc.emailsSent + (e.emailsSent || 0),
            revenue: acc.revenue + (e.revenue || 0),
            orders: acc.orders + (e.totalOrders || 0),
            opens: acc.opens + (e.uniqueOpens || 0),
            clicks: acc.clicks + (e.uniqueClicks || 0),
            unsubs: acc.unsubs + (e.unsubscribesCount || 0),
            bounces: acc.bounces + (e.bouncesCount || 0),
            spam: acc.spam + (e.spamComplaintsCount || 0),
        }), { emailsSent: 0, revenue: 0, orders: 0, opens: 0, clicks: 0, unsubs: 0, bounces: 0, spam: 0 });
        const calc = (emails: typeof currStepEmails) => {
            const t = totals(emails);
            switch (metric) {
                case 'revenue': return t.revenue;
                case 'emailsSent': return t.emailsSent;
                case 'totalOrders': return t.orders;
                case 'avgOrderValue': return t.orders > 0 ? t.revenue / t.orders : 0;
                case 'revenuePerEmail': return t.emailsSent > 0 ? t.revenue / t.emailsSent : 0;
                case 'openRate': return t.emailsSent > 0 ? (t.opens / t.emailsSent) * 100 : 0;
                case 'clickRate': return t.emailsSent > 0 ? (t.clicks / t.emailsSent) * 100 : 0;
                case 'clickToOpenRate': return t.opens > 0 ? (t.clicks / t.opens) * 100 : 0;
                case 'conversionRate': return t.clicks > 0 ? (t.orders / t.clicks) * 100 : 0;
                case 'unsubscribeRate': return t.emailsSent > 0 ? (t.unsubs / t.emailsSent) * 100 : 0;
                case 'bounceRate': return t.emailsSent > 0 ? (t.bounces / t.emailsSent) * 100 : 0;
                case 'spamRate': return t.emailsSent > 0 ? (t.spam / t.emailsSent) * 100 : 0;
                default: return 0;
            }
        };
        const currentValue = calc(currStepEmails);
        const previousValue = calc(prevStepEmails);
        if (prevStepEmails.length === 0 || previousValue === 0) return null;
        const change = ((currentValue - previousValue) / previousValue) * 100;

        // Match MetricCard zero change logic: exactly 0.0%
        const isZeroChange = Math.abs(change) < 0.01;

        let isPositive: boolean;
        if (isZeroChange) {
            isPositive = true; // Neutral for zero change
        } else {
            const isNegativeMetric = ['unsubscribeRate', 'spamRate', 'bounceRate'].includes(metric);
            isPositive = isNegativeMetric ? change < 0 : change > 0;
        }

        const previousPeriod = { startDate: dateWindows!.prevStartDateOnly, endDate: dateWindows!.prevEndDateOnly };
        return { change, isPositive, previousValue, previousPeriod };
    };

    const formatMetricValue = (value: number, metric: string) => {
        const metricConfig = (METRIC_OPTIONS as any).find((m: any) => m.value === metric);
        if (!metricConfig) return value.toString();
        if (metricConfig.format === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        if (metricConfig.format === 'percentage') {
            const formatted = metric === 'spamRate' ? value.toFixed(3) : value.toFixed(2);
            const num = parseFloat(formatted);
            return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: metric === 'spamRate' ? 3 : 2, maximumFractionDigits: metric === 'spamRate' ? 3 : 2 })}%` : `${formatted}%`;
        }
        if (metric === 'emailsSent' || metric === 'totalOrders') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    };

    const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

    const renderStepChart = (step: FlowStepMetrics, index: number) => {
        const sparklineData = getStepSparklineData(step.sequencePosition, selectedMetric);
        const prevSeries = stepSeriesByPosition[step.sequencePosition]?.prev || [];
        const periodChange = getStepPeriodChange(step.sequencePosition, selectedMetric);
        const value = step[selectedMetric as keyof FlowStepMetrics] as number;
        const yAxisRange = getStepYAxisRange(sparklineData, prevSeries);
        let chartColor = '#10b981';
        let dotColor = chartColor;
        let changeNode: React.ReactNode = null;
        if (periodChange && dateRange !== 'all') {
            const isIncrease = periodChange.change > 0;
            const isGood = periodChange.isPositive;

            // Check for exactly 0% change
            const isZeroChange = Math.abs(periodChange.change) < 0.01;
            const hasInsufficientData = periodChange.previousValue === 0;

            let colorClass: string;

            if (isZeroChange) {
                // Gray arrow for exactly 0% change
                colorClass = 'text-gray-600 dark:text-gray-400';
            } else if (hasInsufficientData) {
                // Treat as neutral display in emerald per brand (rare path)
                colorClass = 'text-emerald-600 dark:text-emerald-400';
            } else {
                // Brand colors for actual changes
                colorClass = isGood ? 'text-emerald-600' : 'text-rose-600';
            }

            const isSingleDay = formatDate(periodChange.previousPeriod.startDate) === formatDate(periodChange.previousPeriod.endDate);
            const label = compareMode === 'prev-year' ? 'Same period last year' : 'Previous period';
            const trendTooltip = isSingleDay
                ? `${label} (${formatDate(periodChange.previousPeriod.startDate)}): ${formatMetricValue(periodChange.previousValue, selectedMetric)}`
                : `${label} (${formatDate(periodChange.previousPeriod.startDate)} – ${formatDate(periodChange.previousPeriod.endDate)}): ${formatMetricValue(periodChange.previousValue, selectedMetric)}`;

            // Chart color: keep emerald for all lines; compare arrow conveys sentiment
            if (isZeroChange || hasInsufficientData) {
                chartColor = '#10b981'; // Emerald for neutral cases
            } else {
                chartColor = '#10b981'; // Keep emerald for charts, compare arrows show sentiment
            }
            dotColor = chartColor;

            changeNode = (
                <span className={`text-sm font-semibold tabular-nums ${colorClass}`} title={trendTooltip} aria-label={trendTooltip}>
                    {isZeroChange ? '0.0' : (() => {
                        const changeValue = Math.abs(periodChange.change);
                        const formatted = changeValue.toFixed(1);
                        const num = parseFloat(formatted);
                        return num >= 1000 ? num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatted;
                    })()}%
                </span>
            );
        }
        const chartGradient = `linear-gradient(180deg, ${chartColor}40 0%, ${chartColor}10 100%)`;
        let xTicks: { x: number; label: string }[] = [];
        if (sparklineData.length > 1) {
            const tickCount = Math.min(6, sparklineData.length);
            for (let i = 0; i < tickCount; i++) { const idx = Math.round((i / (tickCount - 1)) * (sparklineData.length - 1)); const point = sparklineData[idx]; const x = (idx / (sparklineData.length - 1)) * 850; const label = new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); xTicks.push({ x, label }); }
        }
        let yTicks: { y: number; label: string }[] = [];
        if (yAxisRange.max > yAxisRange.min) {
            const axisMax = yAxisRange.max; // already computed per metric
            const type = ['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(selectedMetric) ? 'currency' : (['openRate', 'clickRate', 'clickToOpenRate', 'conversionRate', 'unsubscribeRate', 'bounceRate', 'spamRate'].includes(selectedMetric) ? 'percentage' : 'number') as any;
            const vals = thirdTicks(axisMax, type as any);
            const labels = formatTickLabels(vals, type as any, axisMax);
            yTicks = vals.map((v, i) => ({ y: 120 - ((v - yAxisRange.min) / (axisMax - yAxisRange.min)) * 100, label: labels[i] }));
        }
        return (
            <div key={step.sequencePosition} className="p-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {indicatorAvailable ? (() => {
                            const res = (stepScores as any).results?.[index] as any | undefined;
                            if (!res) return null;
                            // If there's no store revenue in the selected window, show a disabled gray N/A indicator
                            const storeRevTotalCtx = (stepScores as any).context?.storeRevenueTotal as number | undefined;
                            if (!storeRevTotalCtx || storeRevTotalCtx <= 0) {
                                const naTipNode = (
                                    <div className="max-w-xs">
                                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Score N/A</div>
                                        <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">No store revenue in the selected window.</div>
                                    </div>
                                );
                                return (
                                    <TooltipPortal content={naTipNode}>
                                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#9ca3af' }} aria-label={`Score N/A indicator`} />
                                    </TooltipPortal>
                                );
                            }
                            const action = res.action as 'scale' | 'keep' | 'improve' | 'pause' | 'insufficient';
                            const color = action === 'scale' ? '#10b981'
                                : action === 'keep' ? '#0ea5e9'
                                    : action === 'improve' ? '#f59e0b'
                                        : action === 'pause' ? '#e11d48'
                                            : '#a855f7';
                            const label = action === 'scale' ? 'Scale'
                                : action === 'keep' ? 'Keep steady'
                                    : action === 'improve' ? 'Improve/Test'
                                        : action === 'pause' ? 'Pause'
                                            : 'Low volume';
                            const m = res.pillars?.money?.points ?? 0;
                            const d = res.pillars?.deliverability?.points ?? 0;
                            const c = res.pillars?.confidence?.points ?? 0;
                            const baseD = res.pillars?.deliverability?.base;
                            const lva = res.pillars?.deliverability?.lowVolumeAdjusted;
                            const tipNode = (() => {
                                // Helper formatters
                                const pct2 = (v: number) => `${(v).toFixed(2)}%`;
                                const pct3 = (v: number) => `${(v).toFixed(3)}%`;
                                const fmtUsd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v);

                                // Money pillar values
                                const riVal = res.pillars?.money?.ri ?? 0;
                                const absoluteRev = res.pillars?.money?.absoluteRevenue ?? step.revenue ?? 0;
                                const riPts = res.pillars?.money?.riPts ?? 0;
                                const standaloneRevPts = res.pillars?.money?.standaloneRevPts ?? 0;
                                const standaloneTierLabel = res.pillars?.money?.standaloneTierLabel || '';
                                const annualizedRevenue = res.pillars?.money?.annualizedRevenue ?? 0;
                                const monthlyRevenue = res.pillars?.money?.monthlyRevenue ?? 0;
                                const flowColor = riPts >= 25 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300';
                                const standaloneColor = standaloneRevPts >= 25 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300';

                                // Format annualized revenue
                                const fmtAnnual = (v: number) => {
                                    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M/yr`;
                                    if (v >= 1000) return `$${(v / 1000).toFixed(0)}k/yr`;
                                    return `$${v.toFixed(0)}/yr`;
                                };

                                // Deliverability zone values (spam and bounce only)
                                const spam = step.spamRate;
                                const bounce = step.bounceRate;
                                const spamZone = res.pillars?.deliverability?.spamZone || 'green';
                                const bounceZone = res.pillars?.deliverability?.bounceZone || 'green';
                                const spamPts = res.pillars?.deliverability?.spamPoints ?? 0;
                                const bouncePts = res.pillars?.deliverability?.bouncePoints ?? 0;

                                // Zone color mapping
                                const zoneColor = (zone: string) => {
                                    switch (zone) {
                                        case 'green': return 'text-emerald-600 dark:text-emerald-400';
                                        case 'yellow': return 'text-amber-600 dark:text-amber-400';
                                        case 'red': return 'text-rose-600 dark:text-rose-400';
                                        default: return 'text-gray-700 dark:text-gray-300';
                                    }
                                };

                                // Zone indicator dot
                                const zoneDot = (zone: string) => {
                                    const bgColor = zone === 'green' ? 'bg-emerald-500' : zone === 'yellow' ? 'bg-amber-500' : 'bg-rose-500';
                                    return <span className={`inline-block w-2 h-2 rounded-full ${bgColor}`} />;
                                };

                                // Gating reasons based on zones
                                const hasRedZone = res.pillars?.deliverability?.hasRedZone;
                                const hasYellowZone = res.pillars?.deliverability?.hasYellowZone;
                                const volumeLow = !!res?.volumeInsufficient;
                                const gated = (res.action !== 'scale') && (hasRedZone || hasYellowZone || volumeLow);
                                const reasons: string[] = [];
                                if (spamZone === 'red') reasons.push('spam in red zone');
                                if (bounceZone === 'red') reasons.push('bounce in red zone');
                                if (spamZone === 'yellow') reasons.push('spam in yellow zone');
                                if (bounceZone === 'yellow') reasons.push('bounce in yellow zone');
                                if (volumeLow) reasons.push('insufficient data');

                                const deltaAdj = typeof baseD === 'number' ? (d - baseD) : 0;

                                // Confidence pillar values
                                const optimalLookback = res.pillars?.confidence?.optimalLookbackDays;
                                const hasSigificance = res.pillars?.confidence?.hasStatisticalSignificance;

                                return (
                                    <div className="max-w-xs">
                                        {/* Header */}
                                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label} · Score {Math.round(res.score)}</div>
                                        {/* Pillar summary */}
                                        <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">Money {Math.round(m)} · Deliverability {Math.round(d)} · Confidence {Math.round(c)}</div>

                                        {/* Money Pillar */}
                                        <div className="mt-2 text-xs text-gray-700 dark:text-gray-300 space-y-1">
                                            <div className="font-medium text-gray-800 dark:text-gray-200">Money</div>
                                            <div className="flex items-center gap-1">
                                                <span>Revenue Index:</span>
                                                <span className={`tabular-nums ${flowColor}`}>{`${(riVal).toFixed(1)}×`}</span>
                                                <span className="text-gray-500">→</span>
                                                <span className="tabular-nums">{Math.round(riPts)}/35</span>
                                            </div>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <span>Total Revenue:</span>
                                                <span className="tabular-nums">{fmtUsd(absoluteRev)}</span>
                                                <span className="text-gray-500">→</span>
                                                <span className={`tabular-nums ${standaloneColor}`}>{fmtAnnual(annualizedRevenue)}</span>
                                                <span className="text-gray-500">→</span>
                                                <span className="tabular-nums">{Math.round(standaloneRevPts)}/35</span>
                                            </div>
                                            {standaloneTierLabel && (
                                                <div className="text-[11px] text-gray-500 italic">{standaloneTierLabel} revenue tier</div>
                                            )}
                                        </div>

                                        {/* Deliverability Pillar (Spam + Bounce zones only) */}
                                        <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                                            <div className="font-medium text-gray-800 dark:text-gray-200">Deliverability</div>
                                            <div className="mt-1 space-y-0.5">
                                                <div className={`flex items-center gap-1 ${zoneColor(spamZone)}`}>
                                                    {zoneDot(spamZone)}
                                                    <span>Spam</span>
                                                    <span className="tabular-nums">({pct3(spam)})</span>
                                                    <span className="text-gray-500">→</span>
                                                    <span className="tabular-nums">{spamPts}/10</span>
                                                </div>
                                                <div className={`flex items-center gap-1 ${zoneColor(bounceZone)}`}>
                                                    {zoneDot(bounceZone)}
                                                    <span>Bounce</span>
                                                    <span className="tabular-nums">({pct2(bounce)})</span>
                                                    <span className="text-gray-500">→</span>
                                                    <span className="tabular-nums">{bouncePts}/10</span>
                                                </div>
                                            </div>
                                            {typeof baseD === 'number' && Math.abs(deltaAdj) > 0.05 ? (
                                                <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">Low-volume adj: +{(deltaAdj).toFixed(1)} → {Math.round(d)}</div>
                                            ) : null}
                                        </div>

                                        {/* Confidence Pillar */}
                                        <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                                            <div className="font-medium text-gray-800 dark:text-gray-200">Confidence</div>
                                            <div className="mt-1 space-y-0.5">
                                                <div>
                                                    <span>Emails sent:</span>
                                                    <span className="tabular-nums ml-1">{(step.emailsSent || 0).toLocaleString('en-US')}</span>
                                                    <span className="text-gray-500 mx-1">→</span>
                                                    <span className="tabular-nums">{Math.round(c)}/10</span>
                                                </div>
                                                {optimalLookback && (
                                                    <div className="text-[11px] text-gray-500">
                                                        Optimal lookback: {optimalLookback} days
                                                        {hasSigificance ? ' ✓' : ' (need more data)'}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Notes and gating reason */}
                                        {gated && reasons.length > 0 ? (
                                            <div className="pt-2 text-[11px] text-amber-700 dark:text-amber-300">
                                                {hasRedZone ? 'Paused due to: ' : 'Caution: '}{reasons.join(', ')}
                                            </div>
                                        ) : null}
                                        {res.notes?.length ? (
                                            <div className="pt-1 text-[11px] text-gray-600 dark:text-gray-400">{res.notes.join(' · ')}</div>
                                        ) : null}
                                    </div>
                                );
                            })();
                            return (
                                <TooltipPortal content={tipNode}>
                                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} aria-label={`${label} indicator`} />
                                </TooltipPortal>
                            );
                        })() : null}
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{step.emailName}</span>
                        {duplicateNameCounts[step.emailName] > 1 && (
                            <span className="inline-flex items-center" title={`Multiple emails share the name "${step.emailName}" (${duplicateNameCounts[step.emailName]}).`} aria-label="Duplicate step name warning">
                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                            </span>
                        )}
                        {(stepScores as any).results?.[index]?.volumeInsufficient && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 text-[11px] font-medium">Low volume</span>
                        )}
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMetricValue(value, selectedMetric)}</span>
                            {selectedMetric === 'conversionRate' && value > 100 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:bg-emerald-900/30">Includes view-through</span>
                            )}
                        </div>
                        {periodChange && dateRange !== 'all' && (
                            <div className="mt-1">{changeNode}</div>
                        )}
                        {/* Metric label intentionally omitted per design: metric is indicated in the dropdown */}
                    </div>
                </div>
                <div className="mt-6 relative" style={{ height: '160px' }}>
                    {sparklineData.length > 1 ? (
                        <div className="relative h-full flex">
                            <svg width="100%" height="100%" viewBox="0 0 850 160" style={{ position: 'absolute', left: 0, top: 0 }}>
                                <defs>
                                    <linearGradient id={`gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={chartColor} stopOpacity="0.25" />
                                        <stop offset="100%" stopColor={chartColor} stopOpacity="0.05" />
                                    </linearGradient>
                                    <linearGradient id={`cmp-gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={chartColor} stopOpacity="0.22" />
                                        <stop offset="100%" stopColor={chartColor} stopOpacity="0.08" />
                                    </linearGradient>
                                </defs>
                                {/* Y-axis tick marks and labels */}
                                {yTicks.map((tick, i) => (
                                    <g key={`ytick-${i}`}>
                                        <line x1={0} y1={tick.y} x2={850} y2={tick.y} className="stroke-gray-200 dark:stroke-gray-700" strokeDasharray="3,3" opacity={0.5} />
                                        <text x={-8} y={tick.y} textAnchor="end" fontSize="11" fill="#9ca3af" dominantBaseline="middle">{tick.label}</text>
                                    </g>
                                ))}
                                {xTicks.map((tick, i) => (
                                    <g key={i}>
                                        {/* Removed vertical tick mark to simplify design; keep label */}
                                        <text x={tick.x} y={145} textAnchor="middle" fontSize="12" fill="#6b7280">{tick.label}</text>
                                    </g>
                                ))}
                                {(() => {
                                    const points = sparklineData.map((point, i) => { const x = (i / (sparklineData.length - 1)) * 850; const y = 120 - ((point.value - yAxisRange.min) / (yAxisRange.max - yAxisRange.min)) * 100; return { x, y, value: point.value, date: point.date }; });
                                    if (points.length === 0) return null;

                                    // Line chart paths
                                    let pathD = `M ${points[0].x},${points[0].y}`;
                                    for (let i = 1; i < points.length; i++) {
                                        const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) * 0.4;
                                        const cp1y = points[i - 1].y;
                                        const cp2x = points[i].x - (points[i].x - points[i - 1].x) * 0.4;
                                        const cp2y = points[i].y;
                                        pathD += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i].x},${points[i].y}`;
                                    }
                                    const areaPath = pathD + ` L 850,120 L 0,120 Z`;

                                    // Build compare series area if previous period exists (use memoized previous series)
                                    let compareArea: string | null = null;
                                    try {
                                        const prevData = prevSeries;
                                        if (prevData && prevData.length >= 2) {
                                            const cmpPts = prevData.map((point, i) => { const x = (i / (prevData.length - 1)) * 850; const v = point.value; const y = 120 - ((v - yAxisRange.min) / (yAxisRange.max - yAxisRange.min)) * 100; return { x, y }; });
                                            let cmpPath = `M ${cmpPts[0].x},${cmpPts[0].y}`;
                                            for (let j = 1; j < cmpPts.length; j++) {
                                                const cp1x = cmpPts[j - 1].x + (cmpPts[j].x - cmpPts[j - 1].x) * 0.4;
                                                const cp1y = cmpPts[j - 1].y;
                                                const cp2x = cmpPts[j].x - (cmpPts[j].x - cmpPts[j - 1].x) * 0.4;
                                                const cp2y = cmpPts[j].y;
                                                cmpPath += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${cmpPts[j].x},${cmpPts[j].y}`;
                                            }
                                            compareArea = cmpPath + ` L 850,120 L 0,120 Z`;
                                        }
                                    } catch { }

                                    const formatTooltipValue = (value: number): string => {
                                        const metricConfig = METRIC_OPTIONS.find(m => m.value === selectedMetric);
                                        switch (metricConfig?.format) {
                                            case 'currency':
                                                return value >= 1000
                                                    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
                                                    : `$${value.toFixed(1)}`;
                                            case 'percentage':
                                                const formatted = value.toFixed(1);
                                                const num = parseFloat(formatted);
                                                return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
                                            case 'number':
                                            default:
                                                return value.toLocaleString('en-US');
                                        }
                                    };

                                    return (
                                        <g>
                                            {/* Compare shaded area (previous period) - always show area for context */}
                                            {compareArea && (
                                                <path d={compareArea} fill={`url(#cmp-gradient-${index})`} stroke="none" />
                                            )}
                                            {/* Ultra-light baseline within drawable area (draw once under line) */}
                                            <line x1={0} y1={120} x2={850} y2={120} className="stroke-gray-200 dark:stroke-gray-700" />

                                            {/* Primary Data */}
                                            {chartType === 'line' ? (
                                                <path d={pathD} fill="none" stroke={chartColor} strokeWidth="2.5" />
                                            ) : (
                                                points.map((point, i) => {
                                                    const count = points.length;
                                                    const step = 850 / count;
                                                    const barW = Math.max(4, Math.min(40, step * 0.7));
                                                    // Center bar in slot
                                                    const x = (i * step) + (step - barW) / 2;
                                                    const h = 120 - point.y;
                                                    return (
                                                        <rect
                                                            key={i}
                                                            x={x}
                                                            y={point.y}
                                                            width={barW}
                                                            height={h}
                                                            fill={chartColor}
                                                            opacity={0.8}
                                                            rx={2}
                                                        />
                                                    );
                                                })
                                            )}

                                            {/* Overlay baseline to mask the line exactly at baseline for crisp resting effect */}
                                            <line x1={0} y1={120} x2={850} y2={120} className="stroke-gray-200 dark:stroke-gray-700" />
                                            {/* Hover rectangles (full-height zones for easier tooltip triggering) */}
                                            {(() => {
                                                const cellW = 850 / Math.max(1, (points.length - 1));
                                                const step = 850 / points.length;

                                                return points.map((point, i) => {
                                                    // For bars, use slot logic. For lines, use point logic.
                                                    const xRect = chartType === 'bar' ? (i * step) : (point.x - cellW / 2);
                                                    const wRect = chartType === 'bar' ? step : cellW;

                                                    return (
                                                        <rect
                                                            key={i}
                                                            x={xRect}
                                                            y={0}
                                                            width={wRect}
                                                            height={120}
                                                            fill="transparent"
                                                            style={{ cursor: 'pointer' }}
                                                            onMouseEnter={(e) => {
                                                                e.stopPropagation();
                                                                setHoveredPoint({
                                                                    chartIndex: index,
                                                                    x: chartType === 'bar' ? (i * step) + step / 2 : point.x,
                                                                    y: point.y,
                                                                    value: point.value,
                                                                    date: point.date,
                                                                    pointIndex: i
                                                                });
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.stopPropagation();
                                                                setHoveredPoint(null);
                                                            }}
                                                        />
                                                    );
                                                });
                                            })()}
                                            {/* Visible hover point - only for line chart */}
                                            {chartType === 'line' && hoveredPoint && hoveredPoint.chartIndex === index && (
                                                <circle
                                                    cx={hoveredPoint.x}
                                                    cy={hoveredPoint.y}
                                                    r="4"
                                                    fill={chartColor}
                                                    stroke="white"
                                                    strokeWidth="2"
                                                />
                                            )}
                                        </g>
                                    );
                                })()}
                            </svg>
                            {/* Tooltip */}
                            {hoveredPoint && hoveredPoint.chartIndex === index && (
                                <div
                                    className="absolute z-20 px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
                                    style={{
                                        left: `${(hoveredPoint.x / 850) * 100}%`,
                                        top: `${Math.max(0, (hoveredPoint.y / 160) * 100 - 10)}%`,
                                        transform: 'translate(-50%, -100%)',
                                        marginTop: '-12px',
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    <div className="font-semibold mb-0.5">{hoveredPoint.date}</div>
                                    <div className="tabular-nums mb-1.5">{(() => {
                                        const metricConfig = METRIC_OPTIONS.find(m => m.value === selectedMetric);
                                        switch (metricConfig?.format) {
                                            case 'currency':
                                                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(hoveredPoint.value);
                                            case 'percentage':
                                                const formatted = hoveredPoint.value.toFixed(1);
                                                const num = parseFloat(formatted);
                                                return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
                                            case 'number':
                                            default:
                                                return hoveredPoint.value.toLocaleString('en-US');
                                        }
                                    })()}</div>
                                    {(() => {
                                        if (dateRange === 'all') return null;
                                        try {
                                            const prevData = prevSeries;
                                            if (!prevData || prevData.length === 0) return null;
                                            const idx = (sparklineData.length > 1 && prevData.length > 1)
                                                ? Math.round((hoveredPoint.pointIndex / (sparklineData.length - 1)) * (prevData.length - 1))
                                                : 0;
                                            const prevPoint = prevData[Math.min(Math.max(0, idx), prevData.length - 1)];
                                            const prevVal = prevPoint?.value;
                                            if (prevVal == null) return null;
                                            const change = prevVal !== 0 ? ((hoveredPoint.value - prevVal) / prevVal) * 100 : null;
                                            return (
                                                <>
                                                    <div className="font-semibold mt-1">{prevPoint.date}</div>
                                                    <div className="tabular-nums mb-1.5">{(() => {
                                                        const metricConfig = METRIC_OPTIONS.find(m => m.value === selectedMetric);
                                                        switch (metricConfig?.format) {
                                                            case 'currency':
                                                                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(prevVal);
                                                            case 'percentage':
                                                                const formatted = prevVal.toFixed(1);
                                                                const num = parseFloat(formatted);
                                                                return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
                                                            case 'number':
                                                            default:
                                                                return prevVal.toLocaleString('en-US');
                                                        }
                                                    })()}</div>
                                                    {change != null && isFinite(change) && (
                                                        <div className="flex justify-between gap-3 pt-0.5"><span className="text-gray-500 dark:text-gray-400">Change</span><span className="tabular-nums">{`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</span></div>
                                                    )}
                                                </>
                                            );
                                        } catch { return null; }
                                    })()}
                                </div>
                            )}
                        </div>
                    ) : value === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <span className="text-sm text-gray-500">No data available</span>
                        </div>
                    ) : (
                        <div className="relative h-full flex items-end">
                            <div className="relative" style={{ width: '100%', height: `${Math.max((value / yAxisRange.max) * 100, 5)}%`, background: chartGradient, borderTop: `2px solid ${chartColor}`, borderRadius: '4px 4px 0 0' }} />
                        </div>
                    )}
                </div>
                {/* Legend */}
                <div className="mt-3 pb-1 flex items-center gap-6 text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                        <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
                            <line x1="1" y1="4" x2="21" y2="4" stroke={chartColor} strokeWidth="2.5" />
                        </svg>
                        <span>Selected date range</span>
                    </div>
                    {dateWindows && dateRange !== 'all' ? (
                        <div className="flex items-center gap-2">
                            <span className="inline-block w-3.5 h-3.5 rounded-[3px]" style={{ backgroundColor: chartColor, opacity: 0.18 }} />
                            <span>{compareMode === 'prev-year' ? 'Same period last year' : 'Previous period'}</span>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    };

    // Auto-select highest revenue flow when data loads or date range changes
    useEffect(() => {
        if (!selectedFlow && flowSummaries.length) {
            const top = [...flowSummaries].sort((a, b) => b.metrics.revenue - a.metrics.revenue)[0];
            if (top) setSelectedFlow(top.flowName);
        }
    }, [selectedFlow, flowSummaries]);
    useEffect(() => {
        setActionNoteExpanded(false);
    }, [selectedFlow]);
    useEffect(() => {
        if (!flowActionNote) {
            setActionNoteExpanded(false);
            return;
        }
        const bodyParts = Array.isArray(flowActionNote.bodyParts) ? flowActionNote.bodyParts : [];
        const headline = bodyParts.length ? bodyParts[0] : null;
        const detailBodyParts = headline ? bodyParts.slice(1) : bodyParts;
        const hasDetails = detailBodyParts.length > 0 || (flowActionNote.items?.length ?? 0) > 0 || Boolean(flowActionNote.sample);
        if (!hasDetails && actionNoteExpanded) {
            setActionNoteExpanded(false);
        }
    }, [flowActionNote, actionNoteExpanded]);

    return (
        <section className="section-card">
            <div className="section-header mb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Workflow className="w-6 h-6 text-purple-600" />
                    <h3 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Flow Step Analysis
                        <InfoTooltipIcon placement="bottom-start" content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>Performance by step inside a selected flow.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>Pick a flow and a metric to see each message side by side. Rates are computed per message; revenue is total for that step.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Find weak links, rename confusing steps, and test subject lines or timing where drop-offs appear.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="section-controls flex-wrap gap-y-2">
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200 dark:border-gray-700 mr-2">
                        <button
                            onClick={() => setChartType('line')}
                            className={`p-1.5 rounded-md transition-colors ${chartType === 'line' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            title="Line Chart"
                        >
                            <TrendingUp className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setChartType('bar')}
                            className={`p-1.5 rounded-md transition-colors ${chartType === 'bar' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            title="Bar Chart"
                        >
                            <BarChart2 className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="relative min-w-0 w-full sm:w-auto">
                        <SelectBase value={selectedFlow} onChange={(e) => setSelectedFlow((e.target as HTMLSelectElement).value)} className="w-full sm:w-auto px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                            {uniqueFlowNames.map((flow: string) => (<option key={flow} value={flow}>{flow}</option>))}
                        </SelectBase>
                    </div>
                    <div className="relative min-w-0 w-full sm:w-auto">
                        <SelectBase value={selectedMetric} onChange={(e) => setSelectedMetric((e.target as HTMLSelectElement).value)} className="w-full sm:w-auto px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                            {METRIC_OPTIONS.map(metric => (<option key={metric.value} value={metric.value}>{metric.label}</option>))}
                        </SelectBase>
                    </div>
                </div>
            </div>

            {/* Optimal Lookback Recommendation Banner */}
            {selectedFlow && flowStepMetrics.length > 0 && (() => {
                const flowOptimalDays = (stepScores as any).context?.flowOptimalLookbackDays || snapToPreset(daysInRange);
                const displayCurrentRange = snapToPreset(daysInRange);
                const isOptimalWindow = daysInRange >= flowOptimalDays * 0.9 && daysInRange <= flowOptimalDays * 1.1;
                const shouldShowOptimal = isOptimalWindow && !accountInsufficient;
                const shouldShowRecommendation = !isOptimalWindow && !accountInsufficient;

                return (
                    <div className="mb-3">
                        {accountInsufficient ? (
                            <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                                Not enough data in the account yet. Even across the last {flowCoverage.days ? flowCoverage.days.toLocaleString('en-US') : '—'} days, we only have {flowCoverage.totalSends.toLocaleString('en-US')} sends.
                            </div>
                        ) : shouldShowOptimal ? (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 italic">
                                ✓ You're analyzing the optimal date range ({flowOptimalDays} days) for this flow.
                            </p>
                        ) : shouldShowRecommendation ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                                For optimal accuracy, we recommend analyzing the last {flowOptimalDays} days based on this flow's volume.
                            </p>
                        ) : null}
                        {!accountInsufficient && displayCurrentRange !== daysInRange && (
                            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                                Current window aligns with the {displayCurrentRange}-day preset.
                            </p>
                        )}
                    </div>
                );
            })()}

            {/* Naming note styled like Data Coverage Notice (purple) */}
            <div className="mb-3">
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-2.5">
                    <div className="flex items-start gap-2.5 text-purple-700 dark:text-purple-200">
                        <div className="flex-1">
                            <span className="text-[11px]">Email names define flow steps. A/B tests often reuse names, which breaks order. Use suffixes like “-A” and “-B”.</span>
                        </div>
                    </div>
                </div>
            </div>

            {selectedFlow && (
                <div className="grid grid-cols-1 gap-6">
                    {flowStepMetrics.map((step, index) => renderStepChart(step, index))}
                </div>
            )}
            {selectedFlow && flowActionNote && (() => {
                const bodyParts = Array.isArray(flowActionNote.bodyParts) ? flowActionNote.bodyParts : [];
                const headline = bodyParts.length ? bodyParts[0] : null;
                const detailBodyParts = headline ? bodyParts.slice(1) : bodyParts;
                const hasDetails = detailBodyParts.length > 0 || (flowActionNote.items?.length ?? 0) > 0 || Boolean(flowActionNote.sample);
                const toggleLabel = actionNoteExpanded ? 'Hide Insights' : 'View Insights';
                const shouldShowDetails = hasDetails && actionNoteExpanded;
                return (
                    <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 mt-6">
                        <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{flowActionNote.title}</p>
                                {headline && (
                                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{headline}</p>
                                )}
                            </div>
                            {hasDetails && (
                                <button
                                    type="button"
                                    onClick={() => setActionNoteExpanded(prev => !prev)}
                                    className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                                    aria-expanded={actionNoteExpanded}
                                    aria-controls={actionNoteContentId}
                                >
                                    {toggleLabel}
                                    <ChevronDown className={`w-4 h-4 transition-transform ${actionNoteExpanded ? 'rotate-180' : ''}`} />
                                </button>
                            )}
                        </div>
                        {shouldShowDetails && (
                            <div id={actionNoteContentId} className="px-4 pb-4 pt-1">
                                {detailBodyParts.length > 0 && (
                                    <div className="space-y-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                        {detailBodyParts.map((line: string, idx: number) => (
                                            <p key={idx}>{line}</p>
                                        ))}
                                    </div>
                                )}
                                {flowActionNote.items?.length ? (
                                    <ul className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed list-disc pl-5">
                                        {flowActionNote.items.map((item, idx) => (
                                            <li key={idx}>{item}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                {flowActionNote.sample && (
                                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{flowActionNote.sample}</p>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}
        </section>
    );
}
