"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { Workflow, GitBranch, AlertTriangle, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import SelectBase from "../ui/SelectBase";
import { DataManager } from '../../lib/data/dataManager';
import { thirdTicks, formatTickLabels, computeAxisMax } from '../../lib/utils/chartTicks';
import InfoTooltipIcon from '../InfoTooltipIcon';

interface FlowStepAnalysisProps {
    dateRange: string;
    granularity: 'daily' | 'weekly' | 'monthly';
    customFrom?: string;
    customTo?: string;
    compareMode?: 'prev-period' | 'prev-year';
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
}

export default function FlowStepAnalysis({ dateRange, granularity, customFrom, customTo, compareMode = 'prev-period' }: FlowStepAnalysisProps) {
    const [hoveredPoint, setHoveredPoint] = useState<{
        chartIndex: number;
        x: number;
        y: number;
        value: number;
        date: string;
        pointIndex: number;
    } | null>(null);

    const metricOptions = [
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

    const [selectedFlow, setSelectedFlow] = useState<string>('');
    const [selectedMetric, setSelectedMetric] = useState<string>('revenue');

    const dataManager = DataManager.getInstance();
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
    }, [dateRange, customFrom, customTo, dataManager, compareMode]);

    const liveFlowEmails = useMemo(() => ALL_FLOW_EMAILS.filter(e => e.status && e.status.toLowerCase() === 'live'), [ALL_FLOW_EMAILS]);

    const uniqueFlowNames = useMemo(() => {
        const names = new Set<string>();
        for (const e of liveFlowEmails) if (e.flowName) names.add(e.flowName);
        return Array.from(names).sort();
    }, [liveFlowEmails]);

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
        console.log(`Flow emails for ${selectedFlow}:`, flowEmails.length);

        if (flowEmails.length === 0) {
            console.warn(`No emails found for flow: ${selectedFlow}`);
            return [];
        }

        const stepMetrics: FlowStepMetrics[] = [];
        let previousEmailsSent = 0;

        flowSequenceInfo.messageIds.forEach((messageId, idx) => {
            let stepEmails = flowEmails.filter(email => email.flowMessageId === messageId);

            // Fallback: if no emails match messageId, try sequence position
            if (stepEmails.length === 0) {
                console.warn(`No emails for messageId ${messageId}, trying sequence position ${idx + 1}`);
                stepEmails = flowEmails.filter(email => email.sequencePosition === idx + 1);
            }

            // If still no emails, create empty step
            if (stepEmails.length === 0) {
                console.warn(`No emails found for step ${idx + 1} in flow ${selectedFlow}`);
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
                    totalClicks: 0
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
                totalClicks
            });

            previousEmailsSent = totalEmailsSent;
        });

        console.log(`Generated ${stepMetrics.length} step metrics for ${selectedFlow}`);
        return stepMetrics;
    }, [selectedFlow, currentFlowEmails, flowSequenceInfo]);

    // Flow Step Score (0–100) with pillars: Money (70), Deliverability penalties (20), Volume (10)
    const stepScores = useMemo(() => {
        if (!flowStepMetrics.length) return { results: [] as any[], context: { rpeBaseline: 0, s1Sends: 0 } };
        const arr = flowStepMetrics;
        const s1Sends = arr[0]?.emailsSent || 0;
        const flowRevenueTotal = arr.reduce((sum, s) => sum + (s.revenue || 0), 0);

        // Baseline fallback: ≥250 → ≥100 → all
        const baselinePool = (() => {
            let pool = arr.filter(s => s.emailsSent >= 250);
            if (!pool.length) pool = arr.filter(s => s.emailsSent >= 100);
            if (!pool.length) pool = arr;
            return pool;
        })();
        const rpes = baselinePool.map(s => s.revenuePerEmail).filter(v => Number.isFinite(v));
        const sortedRpe = [...rpes].sort((a, b) => a - b);
        const rpeBaseline = (() => { const n = sortedRpe.length; return n ? (n % 2 ? sortedRpe[(n - 1) / 2] : (sortedRpe[n / 2 - 1] + sortedRpe[n / 2]) / 2) : 0; })();

        const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

        const results = arr.map((s, i) => {
            const prev = i > 0 ? arr[i - 1] : null;
            const notes: string[] = [];

            // Money pillar (max 70): A1 (35), A2 (15), A3 (20)
            const index = rpeBaseline > 0 ? (s.revenuePerEmail / rpeBaseline) : 0;
            const a1 = clamp(((index - 0.5) / (1.25 - 0.5)) * 35, 0, 35); // 0.5x -> 0, 1.25x -> 35
            if (index >= 1.1) notes.push('RPE above baseline'); else if (index < 0.9) notes.push('RPE below baseline');

            let a2 = 0;
            if (prev && prev.revenuePerEmail > 0) {
                const delta = (s.revenuePerEmail - prev.revenuePerEmail) / prev.revenuePerEmail;
                a2 = clamp((delta / 0.5) * 15, 0, 15); // +50% vs prior -> full 15
                if (delta > 0.1) notes.push('RPE up vs prior');
                if (delta < -0.1) notes.push('RPE down vs prior');
                // Extra dampening when reach collapses and RPE below baseline
                const drop = prev.emailsSent > 0 ? (prev.emailsSent - s.emailsSent) / prev.emailsSent : 0;
                if (drop > 0.6 && index < 1.0) { a2 = Math.min(a2, 3); notes.push('Heavy reach drop'); }
            } else {
                a2 = s.revenuePerEmail >= rpeBaseline ? 8 : 4;
            }

            const revenueShare = flowRevenueTotal > 0 ? (s.revenue / flowRevenueTotal) : 0;
            let a3 = 0;
            if (revenueShare >= 0.30) a3 = 20; else if (revenueShare >= 0.20) a3 = 16; else if (revenueShare >= 0.10) a3 = 10; else if (revenueShare >= 0.05) a3 = 6; else if (revenueShare >= 0.02) a3 = 3; else a3 = 0;
            if (revenueShare >= 0.2) notes.push('High revenue share');

            const moneyPoints = clamp(a1 + a2 + a3, 0, 70);

            // Deliverability penalties (max 20, negative). Hard stop on severe issues.
            const unsub = s.unsubscribeRate; // percent
            const spam = s.spamRate; // percent
            const bounce = s.bounceRate; // percent
            let penalties: Array<{ type: 'unsubscribe' | 'spam' | 'bounce'; amount: number; tier: number }> = [];
            let hardStop = false;
            // Spam tiers
            if (spam >= 0.08) { hardStop = true; penalties.push({ type: 'spam', amount: 20, tier: 3 }); }
            else if (spam >= 0.05) { penalties.push({ type: 'spam', amount: 15, tier: 2 }); }
            else if (spam >= 0.03) { penalties.push({ type: 'spam', amount: 8, tier: 1 }); }
            // Unsubscribe tiers
            if (unsub >= 0.8) { hardStop = true; penalties.push({ type: 'unsubscribe', amount: 12, tier: 3 }); }
            else if (unsub >= 0.5) { penalties.push({ type: 'unsubscribe', amount: 8, tier: 2 }); }
            else if (unsub >= 0.3) { penalties.push({ type: 'unsubscribe', amount: 4, tier: 1 }); }
            // Bounce tiers
            if (bounce >= 2.0) { hardStop = true; penalties.push({ type: 'bounce', amount: 10, tier: 3 }); }
            else if (bounce >= 1.5) { penalties.push({ type: 'bounce', amount: 6, tier: 2 }); }
            else if (bounce >= 1.0) { penalties.push({ type: 'bounce', amount: 3, tier: 1 }); }

            let deliverabilityPenalty = penalties.reduce((sum, p) => sum + p.amount, 0);
            deliverabilityPenalty = Math.min(deliverabilityPenalty, 20);
            const deliverabilityPoints = -deliverabilityPenalty;
            if (penalties.length) notes.push('Deliverability penalties');

            // Volume (max 10) + small-sample penalty
            const sends = s.emailsSent;
            let vol = 0;
            if (sends >= Math.max(1000, 0.5 * s1Sends)) vol = 10;
            else if (sends >= Math.max(500, 0.25 * s1Sends)) vol = 7;
            else if (sends >= Math.max(250, 0.10 * s1Sends)) vol = 5;
            else if (sends >= 100) vol = 3; else vol = 1;
            const smallSamplePenalty = sends < 250 ? 3 : 0; // subtract from vol
            const volumePoints = clamp(vol - smallSamplePenalty, 0, 10);
            if (smallSamplePenalty > 0) notes.push('Small sample');

            let score = clamp(moneyPoints + deliverabilityPoints + volumePoints, 0, 100);
            let action: 'scale' | 'keep' | 'improve' | 'pause' = 'improve';
            if (hardStop) action = 'pause';
            else if (score >= 75) action = 'scale';
            else if (score >= 60) action = 'keep';
            else if (score >= 40) action = 'improve';
            else action = 'pause';

            return {
                score,
                action,
                notes,
                pillars: {
                    money: { points: moneyPoints, A1_rpeIndex: a1, A2_punch: a2, A3_absRevenue: a3 },
                    deliverability: { points: deliverabilityPoints, penalties, hardStop },
                    volume: { points: volumePoints, smallSamplePenalty, baseline: { s1: s1Sends } }
                },
                baselines: { rpeBaseline, revenueShare },
            };
        });

        return { results, context: { rpeBaseline, s1Sends } } as const;
    }, [flowStepMetrics]);

    // Summary and indicator availability
    const indicatorAvailable = useMemo(() => !hasDuplicateNames && isOrderConsistent, [hasDuplicateNames, isOrderConsistent]);
    const totalFlowSends = useMemo(() => flowStepMetrics.reduce((sum, s) => sum + (s.emailsSent || 0), 0), [flowStepMetrics]);
    const notEnoughDataCard = useMemo(() => totalFlowSends < 2000, [totalFlowSends]);

    // Add-step suggestion logic + estimate (Option B)
    const addStepSuggestion = useMemo(() => {
        if (!indicatorAvailable || !flowStepMetrics.length) return { suggested: false } as any;
        const lastIdx = flowStepMetrics.length - 1;
        const last = flowStepMetrics[lastIdx];
        const s1Sends = (stepScores as any).context?.s1Sends as number;
        const rpeMedian = (stepScores as any).context?.rpeBaseline as number;
        const lastRes = (stepScores as any).results?.[lastIdx] as any | undefined;
        const lastAction = lastRes?.action as ('scale'|'keep'|'improve'|'pause'|undefined);
        const volumeOk = last.emailsSent >= Math.max(500, Math.round(0.05 * s1Sends));
        const deliverabilityOk = last.unsubscribeRate <= 0.30 && last.spamRate <= 0.03;
        const rpeOk = last.revenuePerEmail >= rpeMedian;
        const prev = lastIdx > 0 ? flowStepMetrics[lastIdx - 1] : null;
        const deltaRpeOk = prev ? (last.revenuePerEmail - prev.revenuePerEmail) >= 0 : true;
        const lastStepRevenue = last.revenue || 0;
        const flowRevenue = flowStepMetrics.reduce((sum, s) => sum + (s.revenue || 0), 0);
        const lastRevenuePct = flowRevenue > 0 ? (lastStepRevenue / flowRevenue) * 100 : 0;
        const absoluteRevenueOk = (lastStepRevenue >= 500) || (lastRevenuePct >= 5);

        // Date window gating: show only if "recent" (last X days) OR custom ending at last email date
        const dm = dataManager;
        const lastEmailDate = dm.getLastEmailDate();
        const endsAtLast = dateRange === 'all' ? false : (dateRange === 'custom' ? (customTo ? new Date(customTo).toDateString() === lastEmailDate.toDateString() : false) : true);
        const days = dateRange === 'custom' && customFrom && customTo
            ? Math.max(1, Math.ceil((new Date(customTo).getTime() - new Date(customFrom).getTime()) / (1000 * 60 * 60 * 24)))
            : (dateRange === 'all' ? 0 : parseInt(dateRange.replace('d', '')));
        const isRecentWindow = endsAtLast && (days === 30 || days === 90);

        // Suggest add-step when last step is a Scale action and all gates pass.
        const suggested = lastAction === 'scale' && rpeOk && deltaRpeOk && deliverabilityOk && volumeOk && absoluteRevenueOk && isRecentWindow;

        // Estimate (Option B) when suggested or to include in JSON gates
        const rpeFloor = (() => {
            const rpes = flowStepMetrics.map(s => s.revenuePerEmail).filter(v => isFinite(v) && v >= 0).sort((a, b) => a - b);
            if (!rpes.length) return last.revenuePerEmail;
            const idx = Math.floor(0.25 * (rpes.length - 1));
            let floor = rpes[idx];
            if (!isFinite(floor)) floor = last.revenuePerEmail;
            return Math.min(floor, last.revenuePerEmail);
        })();
        const projectedReach = Math.round(last.emailsSent * 0.5);
        const estimatedRevenue = Math.round(projectedReach * rpeFloor * 100) / 100;

        const reason = suggested
            ? (flowStepMetrics.length === 1 ? 'Strong RPE and healthy deliverability' : `S${last.sequencePosition} performing well; follow-up could add value`)
            : undefined;

        return {
            suggested,
            reason,
            horizonDays: isRecentWindow ? (days as 30 | 90) : undefined,
            estimate: suggested ? { projectedReach, rpeFloor, estimatedRevenue, assumptions: { reachPctOfLastStep: 0.5, rpePercentile: 25, clampedToLastStepRpe: true } } : undefined,
            gates: {
                lastStepRevenue,
                lastStepRevenuePctOfFlow: lastRevenuePct,
                deliverabilityOk,
                volumeOk,
                rpeOk,
                deltaRpeOk,
                isRecentWindow
            }
        } as const;
    }, [indicatorAvailable, flowStepMetrics, stepScores, dataManager, dateRange, customFrom, customTo]);

    const getStepSparklineData = React.useCallback((sequencePosition: number, metric: string) => {
        if (!selectedFlow) return [] as { value: number; date: string }[];
        const chartEmails = currentFlowEmails;
        return dataManager.getFlowStepTimeSeries(chartEmails, selectedFlow, sequencePosition, metric, dateRange, granularity, customFrom, customTo);
    }, [selectedFlow, currentFlowEmails, dataManager, dateRange, granularity, customFrom, customTo]);

    const sharedYAxisRange = useMemo(() => {
        if (!selectedFlow) return { min: 0, max: 10 };
        const metricConfig = metricOptions.find(m => m.value === selectedMetric);
        const type = metricConfig?.format === 'currency' ? 'currency' : metricConfig?.format === 'percentage' ? 'percentage' : 'number';
        let allValues: number[] = [];
        let allPrevValues: number[] = [];
        for (let position = 1; flowSequenceInfo && position <= flowSequenceInfo.sequenceLength; position++) {
            const data = getStepSparklineData(position, selectedMetric);
            allValues = allValues.concat(data.map(d => Math.max(0, d.value)));
            if (dateWindows && dateRange !== 'all') {
                const { prevStartDateOnly, prevEndDateOnly } = dateWindows;
                try {
                    const prevData = dataManager.getFlowStepTimeSeries(previousFlowEmails, selectedFlow || '', position, selectedMetric, 'custom', granularity, prevStartDateOnly.toISOString().slice(0, 10), prevEndDateOnly.toISOString().slice(0, 10));
                    if (prevData && prevData.length) allPrevValues = allPrevValues.concat(prevData.map((d: any) => Math.max(0, d.value)));
                } catch { }
            }
        }
        if (allValues.length === 0 && allPrevValues.length === 0) return { min: 0, max: 10 };
        const max = computeAxisMax(allValues, allPrevValues, type as any);
        return { min: 0, max };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFlow, selectedMetric, flowSequenceInfo, getStepSparklineData, dateWindows, dateRange, granularity]);

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
        const metricConfig = (metricOptions as any).find((m: any) => m.value === metric);
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

    const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const renderStepChart = (step: FlowStepMetrics, index: number) => {
        const sparklineData = getStepSparklineData(step.sequencePosition, selectedMetric);
        const periodChange = getStepPeriodChange(step.sequencePosition, selectedMetric);
        const value = step[selectedMetric as keyof FlowStepMetrics] as number;
        const yAxisRange = sharedYAxisRange;
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
                    {isZeroChange ? (
                        <ArrowRight className="inline w-4 h-4 mr-1" />
                    ) : (isIncrease ? (
                        <ArrowUp className="inline w-4 h-4 mr-1" />
                    ) : (
                        <ArrowDown className="inline w-4 h-4 mr-1" />
                    ))}
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
            for (let i = 0; i < tickCount; i++) { const idx = Math.round((i / (tickCount - 1)) * (sparklineData.length - 1)); const point = sparklineData[idx]; const x = (idx / (sparklineData.length - 1)) * 850; const label = new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); xTicks.push({ x, label }); }
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
                            const action = res.action as 'scale'|'keep'|'improve'|'pause';
                            const color = action === 'scale' ? '#10b981' // emerald
                                : action === 'keep' ? '#7c3aed' // purple
                                : action === 'improve' ? '#f59e0b' // amber
                                : '#e11d48'; // red
                            const label = action === 'scale' ? 'Scale'
                                : action === 'keep' ? 'Keep'
                                : action === 'improve' ? 'Improve/Test'
                                : 'Pause/Merge';
                            const m = res.pillars?.money?.points ?? 0;
                            const d = res.pillars?.deliverability?.points ?? 0;
                            const v = res.pillars?.volume?.points ?? 0;
                            const tip = `${label} • Score ${Math.round(res.score)} (Money ${Math.round(m)}, Deliverability ${Math.round(d)}, Volume ${Math.round(v)})`;
                            return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} title={tip} aria-label={tip} />;
                        })() : null}
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{step.emailName}</span>
                        {duplicateNameCounts[step.emailName] > 1 && (
                            <span className="inline-flex items-center" title={`Multiple emails share the name "${step.emailName}" (${duplicateNameCounts[step.emailName]}).`} aria-label="Duplicate step name warning">
                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                            </span>
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
                                {xTicks.map((tick, i) => (
                                    <g key={i}>
                                        {/* Removed vertical tick mark to simplify design; keep label */}
                                        <text x={tick.x} y={145} textAnchor="middle" fontSize="12" fill="#6b7280">{tick.label}</text>
                                    </g>
                                ))}
                                {(() => {
                                    const points = sparklineData.map((point, i) => { const x = (i / (sparklineData.length - 1)) * 850; const y = 120 - ((point.value - yAxisRange.min) / (yAxisRange.max - yAxisRange.min)) * 100; return { x, y, value: point.value, date: point.date }; });
                                    if (points.length === 0) return null;
                                    let pathD = `M ${points[0].x},${points[0].y}`;
                                    for (let i = 1; i < points.length; i++) {
                                        const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) * 0.4;
                                        const cp1y = points[i - 1].y;
                                        const cp2x = points[i].x - (points[i].x - points[i - 1].x) * 0.4;
                                        const cp2y = points[i].y;
                                        pathD += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i].x},${points[i].y}`;
                                    }
                                    const areaPath = pathD + ` L 850,120 L 0,120 Z`;

                                    // Build compare series area if previous period exists
                                    let compareArea: string | null = null;
                                    try {
                                        if (dateWindows && dateRange !== 'all') {
                                            const { prevStartDateOnly, prevEndDateOnly } = dateWindows;
                                            const prevData = dataManager.getFlowStepTimeSeries(previousFlowEmails, selectedFlow || '', step.sequencePosition, selectedMetric, 'custom', granularity, prevStartDateOnly.toISOString().slice(0, 10), prevEndDateOnly.toISOString().slice(0, 10));
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
                                        }
                                    } catch { }

                                    const formatTooltipValue = (value: number): string => {
                                        const metricConfig = metricOptions.find(m => m.value === selectedMetric);
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
                                            {/* Compare shaded area (previous period) */}
                                            {compareArea && (
                                                <path d={compareArea} fill={`url(#cmp-gradient-${index})`} stroke="none" />
                                            )}
                                            {/* Ultra-light baseline within drawable area (draw once under line) */}
                                            <line x1={0} y1={120} x2={850} y2={120} className="stroke-gray-200 dark:stroke-gray-700" />
                                            {/* Primary line (selected date range) */}
                                            <path d={pathD} fill="none" stroke={chartColor} strokeWidth="2.5" />
                                            {/* Overlay baseline to mask the line exactly at baseline for crisp resting effect */}
                                            <line x1={0} y1={120} x2={850} y2={120} className="stroke-gray-200 dark:stroke-gray-700" />
                                            {/* Hover points */}
                                            {points.map((point, i) => (
                                                <circle
                                                    key={i}
                                                    cx={point.x}
                                                    cy={point.y}
                                                    r="10"
                                                    fill="transparent"
                                                    style={{ cursor: 'pointer' }}
                                                    onMouseEnter={(e) => {
                                                        e.stopPropagation();
                                                        setHoveredPoint({
                                                            chartIndex: index,
                                                            x: point.x,
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
                                            ))}
                                            {/* Visible hover point */}
                                            {hoveredPoint && hoveredPoint.chartIndex === index && (
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
                                        const metricConfig = metricOptions.find(m => m.value === selectedMetric);
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
                                        if (!dateWindows || dateRange === 'all') return null;
                                        const { prevStartDateOnly, prevEndDateOnly } = dateWindows;
                                        try {
                                            const prevData = dataManager.getFlowStepTimeSeries(previousFlowEmails, selectedFlow || '', step.sequencePosition, selectedMetric, 'custom', granularity, prevStartDateOnly.toISOString().slice(0, 10), prevEndDateOnly.toISOString().slice(0, 10));
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
                                                        const metricConfig = metricOptions.find(m => m.value === selectedMetric);
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

    return (
        <section className="section-card">
            <div className="section-header mb-2">
                <div className="flex items-center gap-2">
                    <Workflow className="w-6 h-6 text-purple-600" />
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Flow Step Analysis
                        <InfoTooltipIcon placement="bottom-start" content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>Performance by step inside a selected flow.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>Pick a flow and a metric to see each message side by side. Rates are computed per message; revenue is total for that step.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Find weak links, rename confusing steps, and test subject lines or timing where drop a0offs appear.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="section-controls">
                    <div className="relative">
                        <SelectBase value={selectedFlow} onChange={(e) => setSelectedFlow((e.target as HTMLSelectElement).value)} className="px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                            {uniqueFlowNames.map((flow: string) => (<option key={flow} value={flow}>{flow}</option>))}
                        </SelectBase>
                    </div>
                    <div className="relative">
                        <SelectBase value={selectedMetric} onChange={(e) => setSelectedMetric((e.target as HTMLSelectElement).value)} className="px-4 py-2 pr-8 rounded-lg border cursor-pointer bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                            {metricOptions.map(metric => (<option key={metric.value} value={metric.value}>{metric.label}</option>))}
                        </SelectBase>
                    </div>
                </div>
            </div>
            {/* Add-step suggestion (header-level dots removed; dots shown per step) */}
            {selectedFlow && indicatorAvailable && (addStepSuggestion as any)?.suggested && (
                <div className="mb-3">
                    <div className="mt-1 text-[11px] text-gray-700 dark:text-gray-200">
                        {flowStepMetrics.length === 1 ? (
                            <span>Consider adding a second step (strong RPE and healthy deliverability).
                                {(addStepSuggestion as any)?.estimate ? (
                                    <span className="ml-1 text-gray-500" title="Estimate is conservative and depends on how many emails your flow sends and may vary with audience behavior.">
                                        Est. +{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((addStepSuggestion as any).estimate.estimatedRevenue)} in next {(addStepSuggestion as any).horizonDays} days
                                    </span>
                                ) : null}
                            </span>
                        ) : (
                            <span>Consider adding a follow-up after S{flowStepMetrics[flowStepMetrics.length - 1].sequencePosition} (solid RPE, clear deliverability).
                                {(addStepSuggestion as any)?.estimate ? (
                                    <span className="ml-1 text-gray-500" title="Estimate is conservative and depends on how many emails your flow sends and may vary with audience behavior.">
                                        Est. +{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((addStepSuggestion as any).estimate.estimatedRevenue)} in next {(addStepSuggestion as any).horizonDays} days
                                    </span>
                                ) : null}
                            </span>
                        )}
                    </div>
                </div>
            )}
            {/* Naming note styled like Data Coverage Notice (purple) */}
            <div className="mb-3">
                <div className="p-0 text-purple-700 dark:text-purple-200">
                    <span className="text-xs"><span className="font-medium">Naming Note:</span> Flow steps are organized by message names. When you create an A/B test, Klaviyo may give the same name to multiple emails, which can mess up the order. To avoid this, rename emails with clear suffixes like “-A” and “-B” so the order stays correct.</span>
                </div>
            </div>

            {/* Not enough data empty state card (still render charts below) */}
            {selectedFlow && notEnoughDataCard && (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900 mb-3">
                    <div className="text-sm text-gray-700 dark:text-gray-200">Not enough data. This module uses limited data for the selected window; results may be noisy.</div>
                </div>
            )}

            {selectedFlow && (
                <div className="grid grid-cols-1 gap-6">
                    {flowStepMetrics.map((step, index) => renderStepChart(step, index))}
                </div>
            )}
        </section>
    );
}
