"use client";
import React from 'react';
import { Users, UserCheck, DollarSign, TrendingUp, SquareUser, AlertCircle, Trash2, PiggyBank, CheckCircle, MousePointerClick, Repeat2, ChevronDown } from 'lucide-react';
import InfoTooltipIcon from '../InfoTooltipIcon';
import InactivityRevenueDrain from './InactivityRevenueDrain';
import EngagementByTenure from './EngagementByTenure';
import { DataManager } from '../../lib/data/dataManager';
import { getConsentSplitMetrics } from '../../lib/analytics/consentSplitMetrics';

export default function AudienceCharts({ dateRange, granularity, customFrom, customTo, referenceDate }: { dateRange: string; granularity: 'daily' | 'weekly' | 'monthly'; customFrom?: string; customTo?: string; referenceDate?: Date }) {
    const dataManager = DataManager.getInstance();
    const audienceInsights = dataManager.getAudienceInsights();
    const subscribers = dataManager.getSubscribers();
    const hasData = subscribers.length > 0;
    const [showDeadWeightGuide, setShowDeadWeightGuide] = React.useState(false);
    const [showPurchaseActionDetails, setShowPurchaseActionDetails] = React.useState(false);
    const [showLifetimeActionDetails, setShowLifetimeActionDetails] = React.useState(false);
    const [showHighValueActionDetails, setShowHighValueActionDetails] = React.useState(false);
    const [showInactiveActionDetails, setShowInactiveActionDetails] = React.useState(false);
    const [showEngagementAgeDetails, setShowEngagementAgeDetails] = React.useState(false);
    const [showConsentSplitDetails, setShowConsentSplitDetails] = React.useState(false);

    const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    const formatPercent = (value: number) => {
        const formatted = value.toFixed(1);
        const num = parseFloat(formatted);
        return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
    };

    type PurchaseSegmentKey = 'never' | 'one' | 'repeat';
    interface PurchaseActionSegment {
        key: PurchaseSegmentKey;
        label: string;
        count: number;
        percentage: number;
        recommendation: string;
        caution?: string;
        ideas: string[];
    }
    interface PurchaseActionNote {
        headline: string;
        body: string;
        segments: PurchaseActionSegment[];
    }
    interface LifetimeSegmentDetail {
        label: string;
        count: number;
        percentage: number;
        summary: string;
        ideas: string[];
    }
    interface LifetimeActionNote {
        headline: string;
        body: string;
        segments: LifetimeSegmentDetail[];
    }
    interface HighValueSegmentDetail {
        label: string;
        name: string;
        rangeText: string;
        customers: number;
        revenue: number;
        revenueShare: number;
        revenueShareOfList: number;
    }
    interface HighValueActionNote {
        headline: string;
        body: string;
        segments: Array<{ name: string; rangeText: string; revenueShare: number; summary: string; ideas: string[]; customers: number; revenue: number }>;
    }
    interface EngagementAgeNote {
        headline: string;
        summary: string;
        paragraph: string;
    }
    interface ConsentSplitNote {
        headline: string;
        summary: string;
        paragraph: string;
    }

    type ConsentGroupKey = 'Subscribed' | 'Not Subscribed';

    const purchaseFrequencyData = [
        { label: 'Never', value: audienceInsights.purchaseFrequency.never, percentage: (audienceInsights.purchaseFrequency.never / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '1 Order', value: audienceInsights.purchaseFrequency.oneOrder, percentage: (audienceInsights.purchaseFrequency.oneOrder / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '2 Orders', value: audienceInsights.purchaseFrequency.twoOrders, percentage: (audienceInsights.purchaseFrequency.twoOrders / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '3-5 Orders', value: audienceInsights.purchaseFrequency.threeTo5, percentage: (audienceInsights.purchaseFrequency.threeTo5 / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '6+ Orders', value: audienceInsights.purchaseFrequency.sixPlus, percentage: (audienceInsights.purchaseFrequency.sixPlus / (audienceInsights.totalSubscribers || 1)) * 100 }
    ];

    const purchaseActionNote = React.useMemo<PurchaseActionNote | null>(() => {
        const total = audienceInsights.totalSubscribers || 0;
        if (!total) return null;
        const pf = audienceInsights.purchaseFrequency;
        const toPct = (value: number) => total > 0 ? (value / total) * 100 : 0;
        const repeatCount = (pf.twoOrders || 0) + (pf.threeTo5 || 0) + (pf.sixPlus || 0);

        const segments: PurchaseActionSegment[] = [
            {
                key: 'never',
                label: 'Never Purchased',
                count: pf.never || 0,
                percentage: toPct(pf.never || 0),
                recommendation: 'Reintroduce the brand value with welcome refreshers, proof, and seasonal hooks to earn the first order.',
                caution: 'Do not suppress this cohort purely on purchase history. Watch opens and clicks elsewhere before making suppression calls.',
                ideas: [
                    'First-order perk or welcome reminder with clear positioning',
                    'Best-seller spotlight that leans on reviews or social proof',
                    'Educational series that demystifies the product line'
                ]
            },
            {
                key: 'one',
                label: 'One Order',
                count: pf.oneOrder || 0,
                percentage: toPct(pf.oneOrder || 0),
                recommendation: 'Treat one-timers as the highest-leverage segment and trigger retention offers that make the second purchase inevitable.',
                ideas: [
                    'Post-purchase follow-up with complementary product picks',
                    'Loyalty or referral incentive that unlocks after order two',
                    'Time-limited second-purchase bonus such as free shipping or a bundle offer'
                ]
            },
            {
                key: 'repeat',
                label: 'Repeat Buyers (2+ Orders)',
                count: repeatCount,
                percentage: toPct(repeatCount),
                recommendation: 'Keep loyalists feeling like insiders so they stay active and advocate for the brand.',
                ideas: [
                    'VIP or loyalty program invite with milestone perks',
                    'Early access drops or collection previews reserved for loyalists',
                    'Personalized thank-you or recommendation campaigns'
                ]
            }
        ];

        if (!segments.length) return null;
        const dominant = segments.slice(1).reduce<PurchaseActionSegment>((prev, current) => current.percentage > prev.percentage ? current : prev, segments[0]);
        let adaptBody = '';
        switch (dominant.key) {
            case 'never':
                adaptBody = 'Improve acquisition-to-first-purchase conversion with trust-building sequences and proof-driven welcome content.';
                break;
            case 'one':
                adaptBody = 'Prioritize win-back and cross-sell programs that move one-time buyers into automated second-order journeys.';
                break;
            case 'repeat':
                adaptBody = 'Invest in loyalty, exclusivity, and community touchpoints to keep repeat buyers engaged and protect CLV.';
                break;
            default:
                adaptBody = 'Balance efforts across acquisition, second-order conversion, and loyalty to keep the distribution healthy.';
        }

        const adaptHeadline = `${dominant.label} leads the distribution (${formatPercent(dominant.percentage)})`;
        const filteredSegments = segments.filter(segment => segment.count > 0 && segment.percentage > 0);

        return {
            headline: adaptHeadline,
            body: adaptBody,
            segments: filteredSegments
        };
    }, [audienceInsights.purchaseFrequency, audienceInsights.totalSubscribers]);

    const lifetimeData = React.useMemo(() => ([
        { label: '0-3 months', value: audienceInsights.lifetimeDistribution.zeroTo3Months, percentage: (audienceInsights.lifetimeDistribution.zeroTo3Months / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '3-6 months', value: audienceInsights.lifetimeDistribution.threeTo6Months, percentage: (audienceInsights.lifetimeDistribution.threeTo6Months / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '6-12 months', value: audienceInsights.lifetimeDistribution.sixTo12Months, percentage: (audienceInsights.lifetimeDistribution.sixTo12Months / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '1-2 years', value: audienceInsights.lifetimeDistribution.oneToTwoYears, percentage: (audienceInsights.lifetimeDistribution.oneToTwoYears / (audienceInsights.totalSubscribers || 1)) * 100 },
        { label: '2+ years', value: audienceInsights.lifetimeDistribution.twoYearsPlus, percentage: (audienceInsights.lifetimeDistribution.twoYearsPlus / (audienceInsights.totalSubscribers || 1)) * 100 }
    ]), [
        audienceInsights.lifetimeDistribution.zeroTo3Months,
        audienceInsights.lifetimeDistribution.threeTo6Months,
        audienceInsights.lifetimeDistribution.sixTo12Months,
        audienceInsights.lifetimeDistribution.oneToTwoYears,
        audienceInsights.lifetimeDistribution.twoYearsPlus,
        audienceInsights.totalSubscribers
    ]);

    const lifetimeActionNote = React.useMemo<LifetimeActionNote | null>(() => {
        const total = audienceInsights.totalSubscribers || 0;
        if (!total) return null;

        const zeroTo3 = audienceInsights.lifetimeDistribution.zeroTo3Months || 0;
        const threeTo6 = audienceInsights.lifetimeDistribution.threeTo6Months || 0;
        const sixTo12 = audienceInsights.lifetimeDistribution.sixTo12Months || 0;
        const oneToTwo = audienceInsights.lifetimeDistribution.oneToTwoYears || 0;
        const twoPlus = audienceInsights.lifetimeDistribution.twoYearsPlus || 0;

        const groups = [
            {
                key: 'new' as const,
                label: '0-6 months',
                count: zeroTo3 + threeTo6,
                percentage: ((zeroTo3 + threeTo6) / total) * 100,
            },
            {
                key: 'mid' as const,
                label: '6-12 months',
                count: sixTo12,
                percentage: (sixTo12 / total) * 100,
            },
            {
                key: 'old' as const,
                label: '1+ years',
                count: oneToTwo + twoPlus,
                percentage: ((oneToTwo + twoPlus) / total) * 100,
            }
        ];

        const sorted = [...groups].sort((a, b) => b.percentage - a.percentage);
        const [leader, runnerUp] = sorted;
        const dominance = leader.percentage - (runnerUp?.percentage ?? 0);
        const newGroup = groups.find(g => g.key === 'new');
        const midGroup = groups.find(g => g.key === 'mid');
        const oldGroup = groups.find(g => g.key === 'old');

        let headline: string;
        if (dominance < 5) {
            headline = 'Balanced mix across subscriber age groups';
        } else if (leader.key === 'new') {
            headline = `New joiners (0-6 months) lead the list (${formatPercent(newGroup?.percentage ?? leader.percentage)})`;
        } else if (leader.key === 'mid') {
            headline = `6-12 months leads the list (${formatPercent(midGroup?.percentage ?? leader.percentage)})`;
        } else {
            headline = `1+ year subscribers lead the list (${formatPercent(oldGroup?.percentage ?? leader.percentage)})`;
        }

        let body: string;
        if (dominance < 5) {
            body = 'No single age group dominates, so keep onboarding, relationship building, and reactivation running in parallel.';
        } else if (leader.key === 'new') {
            body = 'Focus your content on welcoming recent sign-ups, teaching them the basics, and nudging their first actions.';
        } else if (leader.key === 'mid') {
            body = 'Center your messaging on reinforcing value for six-to-twelve-month subscribers who already know the fundamentals.';
        } else {
            body = 'Refresh long-tenure subscribers with updates, exclusives, and light reactivation before you trim disengaged profiles.';
        }

        const segmentCopy: Record<string, { summary: string; ideas: string[] }> = {
            '0-3 months': {
                summary: 'Welcome and educate new joiners so they understand the brand and what to do next.',
                ideas: [
                    'Send a paced onboarding sequence that tells the brand story and core promise',
                    'Share quick-start guides, FAQs, or setup tips that help them get value fast',
                    'Test gentle early nudges like welcome bundles, limited discounts, or milestone reminders'
                ]
            },
            '3-6 months': {
                summary: 'They know the basics, so reinforce their choice and personalise future messaging.',
                ideas: [
                    'Share customer stories, case studies, or social proof that validates staying engaged',
                    'Invite them to update preferences or join communities so content becomes more personal',
                    'Introduce curated collections or bundles that encourage exploration without heavy pressure'
                ]
            },
            '6-12 months': {
                summary: 'Established subscribers respond to deeper education and reminders of ongoing value.',
                ideas: [
                    'Highlight advanced use cases, product refreshers, or behind-the-scenes updates',
                    'Remind them about loyalty perks, referrals, or insider benefits they might earn',
                    'Ask for feedback or surveys—they have enough context to share meaningful input'
                ]
            },
            '1-2 years': {
                summary: 'Long-term members need gentle reminders of relevance without overwhelming frequency.',
                ideas: [
                    'Run light-touch nurture or seasonal updates that signal what is new or timely',
                    'Offer exclusive previews or anniversary-themed content to renew excitement',
                    'Adjust cadence or move them into lower-frequency tracks if they prefer less email'
                ]
            },
            '2+ years': {
                summary: 'Legacy subscribers need a clear reason to stay on the list.',
                ideas: [
                    'Send reactivation-style updates such as “what’s new since you joined” or milestone recaps',
                    'Use anniversary or appreciation messages that highlight their history with the brand',
                    'If they stay silent, shift them to a low-frequency stream and plan a final sunset touch'
                ]
            }
        };

        const segments: LifetimeSegmentDetail[] = lifetimeData.map(item => {
            const copy = segmentCopy[item.label];
            return {
                label: item.label,
                count: item.value,
                percentage: item.percentage,
                summary: copy?.summary ?? '',
                ideas: copy?.ideas ?? []
            };
        });

        return { headline, body, segments };
    }, [lifetimeData, audienceInsights.lifetimeDistribution.zeroTo3Months, audienceInsights.lifetimeDistribution.threeTo6Months, audienceInsights.lifetimeDistribution.sixTo12Months, audienceInsights.lifetimeDistribution.oneToTwoYears, audienceInsights.lifetimeDistribution.twoYearsPlus, audienceInsights.totalSubscribers]);

    // High-value customer segments (exclusive bins: 2x–<3x, 3x–<6x, 6x+ of buyer AOV) with buyer-share and list-share revenue percentages
    const highValueSegments = React.useMemo<HighValueSegmentDetail[]>(() => {
        if (!hasData) return [] as HighValueSegmentDetail[];
        const aov = audienceInsights.avgClvBuyers;
        const totalBuyerRevenue = subscribers.reduce((acc, s) => acc + ((s.isBuyer ? ((s.historicClv ?? s.totalClv) || 0) : 0)), 0);
        const totalListRevenue = subscribers.reduce((acc, s) => acc + (((s.historicClv ?? s.totalClv) || 0)), 0);
        if (!aov || aov <= 0) {
            const t2 = 0, t3 = 0, t6 = 0;
            return [
                { label: `2x–<3x AOV (${formatCurrency(t2)}–<${formatCurrency(t3)})`, name: '2x-3x AOV', rangeText: `${formatCurrency(t2)}–<${formatCurrency(t3)}`, customers: 0, revenue: 0, revenueShare: 0, revenueShareOfList: 0 },
                { label: `3x–<6x AOV (${formatCurrency(t3)}–<${formatCurrency(t6)})`, name: '3x-6x AOV', rangeText: `${formatCurrency(t3)}–<${formatCurrency(t6)}`, customers: 0, revenue: 0, revenueShare: 0, revenueShareOfList: 0 },
                { label: `6x+ AOV (${formatCurrency(t6)}+)`, name: '6x+ AOV', rangeText: `${formatCurrency(t6)}+`, customers: 0, revenue: 0, revenueShare: 0, revenueShareOfList: 0 },
            ];
        }
        const t2 = aov * 2, t3 = aov * 3, t6 = aov * 6;
        const toCents = (n: number) => Math.round(n * 100);
        const fromCents = (c: number) => c / 100;
        const t3Minus = fromCents(Math.max(0, toCents(t3) - 1));
        const t6Minus = fromCents(Math.max(0, toCents(t6) - 1));
        const segments: HighValueSegmentDetail[] = [
            { label: `2x-3x AOV (${formatCurrency(t2)}–${formatCurrency(t3Minus)})`, name: '2x-3x AOV', rangeText: `${formatCurrency(t2)}–${formatCurrency(t3Minus)}`, customers: 0, revenue: 0, revenueShare: 0, revenueShareOfList: 0 },
            { label: `3x-6x AOV (${formatCurrency(t3)}–${formatCurrency(t6Minus)})`, name: '3x-6x AOV', rangeText: `${formatCurrency(t3)}–${formatCurrency(t6Minus)}`, customers: 0, revenue: 0, revenueShare: 0, revenueShareOfList: 0 },
            { label: `6x+ AOV (${formatCurrency(t6)}+)`, name: '6x+ AOV', rangeText: `${formatCurrency(t6)}+`, customers: 0, revenue: 0, revenueShare: 0, revenueShareOfList: 0 },
        ];
        for (const s of subscribers) {
            if (!s.isBuyer) continue;
            const h = (s.historicClv ?? s.totalClv) || 0;
            if (h <= 0) continue;
            if (h >= t6) { segments[2].customers++; segments[2].revenue += h; }
            else if (h >= t3) { segments[1].customers++; segments[1].revenue += h; }
            else if (h >= t2) { segments[0].customers++; segments[0].revenue += h; }
        }
        segments.forEach(seg => {
            seg.revenueShare = totalBuyerRevenue > 0 ? (seg.revenue / totalBuyerRevenue) * 100 : 0;
            seg.revenueShareOfList = totalListRevenue > 0 ? (seg.revenue / totalListRevenue) * 100 : 0;
        });
        return segments;
    }, [hasData, audienceInsights.avgClvBuyers, subscribers]);

    const highValueActionNote = React.useMemo<HighValueActionNote | null>(() => {
        if (!highValueSegments.length) return null;
        const totalShare = highValueSegments.reduce((sum, seg) => sum + seg.revenueShareOfList, 0);
        const formatShare = (value: number) => formatPercent(value);
        const headline = `High-value customers generate ${formatShare(totalShare)} of total revenue.`;

        const sortedByShare = [...highValueSegments].sort((a, b) => b.revenueShare - a.revenueShare);
        const top = sortedByShare[0];
        const second = sortedByShare[1];
        const smallest = sortedByShare[sortedByShare.length - 1];
        const diffTop = top && second ? top.revenueShare - second.revenueShare : 0;
        const sixPlus = highValueSegments.find(seg => seg.name === '6x+ AOV');
        const sixPlusDominant = sixPlus ? sixPlus.revenueShareOfList >= (totalShare / 3) : false;

        let body: string;
        if (sixPlusDominant) {
            body = 'Anchor a VIP track for 6x+ AOV alongside lift programs for the lower tiers.';
        } else if (diffTop < 2) {
            body = `Balance lift efforts across tiers and protect ${smallest.name} with personal recognition.`;
        } else {
            body = `Prioritize moving customers up from ${top.name} while protecting ${smallest.name} with personal recognition.`;
        }

        const ideaMap: Record<string, string[]> = {
            '2x-3x AOV': [
                'Promote spend-threshold offers that unlock bonuses or free gifts',
                'Bundle complementary products or multi-packs to grow basket size',
                'Suggest add-on upsells after checkout to increase order value'
            ],
            '3x-6x AOV': [
                'Offer early access to launches or limited runs',
                'Accelerate loyalty rewards or tier upgrades to keep them active',
                'Deliver personalised product recommendation emails tuned to their history'
            ],
            '6x+ AOV': [
                'Schedule concierge-style outreach or account manager check-ins',
                'Surprise with thank-you gifts or exclusive merch drops',
                'Invite them to invitation-only previews or advisory moments'
            ]
        };

        const topShare = top?.revenueShare ?? 0;
        const minShare = smallest?.revenueShare ?? 0;

        const segments = highValueSegments.map(seg => {
            const share = seg.revenueShare;
            const comparable = highValueSegments.some(other => other !== seg && Math.abs(share - other.revenueShare) < 2);
            let summary: string;
            const shareLabel = formatPercent(share);
            if (comparable) {
                summary = `Comparable to other tiers (${shareLabel}).`;
            } else if (share === topShare && diffTop >= 2) {
                summary = `Largest share of high-value revenue (${shareLabel}).`;
            } else if (share === minShare) {
                summary = `Smallest share (${shareLabel}); individual spend is high but scale is limited.`;
            } else {
                summary = `Meaningful mid-tier contribution (${shareLabel}).`;
            }
            summary += '.';
            return {
                name: seg.name,
                rangeText: seg.rangeText,
                revenueShare: seg.revenueShare,
                summary,
                ideas: ideaMap[seg.name] || [],
                customers: seg.customers,
                revenue: seg.revenue
            };
        });

        return { headline, body, segments };
    }, [highValueSegments]);

    const engagementAgeNote = React.useMemo<EngagementAgeNote | null>(() => {
        if (!hasData) return null;
        const dm = dataManager;
        const ageDefs = [
            { key: '0_6m', label: '0–6 months', minM: 0, maxM: 5 },
            { key: '6_12m', label: '6–12 months', minM: 6, maxM: 11 },
            { key: '1_2y', label: '1–2 years', minM: 12, maxM: 23 },
            { key: '2y_plus', label: '2+ years', minM: 24, maxM: Infinity },
        ];

        const anchor = (() => {
            if (dateRange === 'custom' && customTo) {
                const d = new Date(customTo + 'T23:59:59');
                if (!isNaN(d.getTime())) return d;
            }
            if (referenceDate) {
                const d = new Date(referenceDate);
                if (!isNaN(d.getTime())) return d;
            }
            return dm.getLastEmailDate();
        })();

        if (!anchor) return null;

        const diffMonths = (anchorDate: Date, start: Date) => {
            let months = (anchorDate.getFullYear() - start.getFullYear()) * 12 + (anchorDate.getMonth() - start.getMonth());
            if (anchorDate.getDate() < start.getDate()) months -= 1;
            return Math.max(0, months);
        };

        const diffDays = (anchorDate: Date, last: Date) => {
            const MS = 1000 * 60 * 60 * 24;
            const a = new Date(anchorDate); a.setHours(0, 0, 0, 0);
            const b = new Date(last); b.setHours(0, 0, 0, 0);
            return Math.floor((a.getTime() - b.getTime()) / MS);
        };

        const buckets = ageDefs.map(def => ({
            key: def.key,
            label: def.label,
            denom: 0,
            neverCount: 0,
            recentCount: 0,
            deepCount: 0,
        }));

        subscribers.forEach(sub => {
            const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
            if (!created) return;
            const ageMonths = diffMonths(anchor, created);
            const def = ageDefs.find(a => ageMonths >= a.minM && ageMonths <= a.maxM);
            if (!def) return;
            const bucket = buckets.find(b => b.key === def.key);
            if (!bucket) return;
            bucket.denom += 1;

            const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
            const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;
            const last = lastOpen && lastClick ? (lastOpen > lastClick ? lastOpen : lastClick) : (lastOpen || lastClick);
            if (!last) {
                bucket.neverCount += 1;
                return;
            }
            const days = diffDays(anchor, last);
            if (days <= 30) bucket.recentCount += 1;
            if (days >= 120) bucket.deepCount += 1;
        });

        const total = buckets.reduce((sum, b) => sum + b.denom, 0);
        if (total === 0) return null;

        const metrics = buckets.map(b => ({
            key: b.key,
            label: b.label,
            share: (b.denom / total) * 100,
            neverPct: b.denom > 0 ? (b.neverCount / b.denom) * 100 : 0,
            recentPct: b.denom > 0 ? (b.recentCount / b.denom) * 100 : 0,
            deepPct: b.denom > 0 ? (b.deepCount / b.denom) * 100 : 0,
        }));

        const highNever = metrics.reduce((prev, curr) => (curr.neverPct > prev.neverPct ? curr : prev), metrics[0]);
        const highRecent = metrics.reduce((prev, curr) => (curr.recentPct > prev.recentPct ? curr : prev), metrics[0]);
        const weightedNever = metrics.reduce((sum, m) => sum + (m.share * m.neverPct) / 100, 0);
        const weightedRecent = metrics.reduce((sum, m) => sum + (m.share * m.recentPct) / 100, 0);
        const overallTrend = weightedRecent >= weightedNever ? 'recent_outpaces_never' : 'never_outpaces_recent';
        const olderMetrics = metrics.filter(m => m.key === '1_2y' || m.key === '2y_plus');
        const avgDeepOlder = olderMetrics.length ? olderMetrics.reduce((sum, m) => sum + m.deepPct, 0) / olderMetrics.length : 0;
        const maxOlderNever = olderMetrics.length ? Math.max(...olderMetrics.map(m => m.neverPct)) : 0;

        let maintenance: 'cleaned_old_inactives' | 'aging_dead_weight' | 'neutral';
        if (olderMetrics.length && avgDeepOlder < 0.5 && maxOlderNever < 1) maintenance = 'cleaned_old_inactives';
        else if (olderMetrics.length && (avgDeepOlder >= 1 || maxOlderNever >= 5)) maintenance = 'aging_dead_weight';
        else maintenance = 'neutral';

        let acquisition: 'broad_low_quality' | 'strong_new_cohorts' | 'mixed_new_cohorts';
        const newBucket = metrics.find(m => m.key === '0_6m');
        if (newBucket && highNever.key === '0_6m' && newBucket.neverPct >= 20) acquisition = 'broad_low_quality';
        else if (newBucket && highRecent.key === '0_6m' && newBucket.recentPct >= 25 && newBucket.neverPct < 10) acquisition = 'strong_new_cohorts';
        else acquisition = 'mixed_new_cohorts';

        let stability: 'habits_form_by_month6' | 'midlife_drop' | 'steady_across_ages';
        const sixTo12 = metrics.find(m => m.key === '6_12m');
        const oneToTwo = metrics.find(m => m.key === '1_2y');
        if (highRecent && (highRecent.key === '6_12m' || highRecent.key === '1_2y') && newBucket && Math.abs(highRecent.recentPct - newBucket.recentPct) <= 2) {
            stability = 'habits_form_by_month6';
        } else if (sixTo12 && oneToTwo && (sixTo12.recentPct - oneToTwo.recentPct) > 5) {
            stability = 'midlife_drop';
        } else {
            stability = 'steady_across_ages';
        }

        let headline: string;
        if (maintenance === 'cleaned_old_inactives') headline = 'Engagement quality strengthens with age, suggesting consistent list hygiene.';
        else if (maintenance === 'aging_dead_weight') headline = 'Older cohorts show accumulated inactivity, pointing to list hygiene gaps.';
        else if (acquisition === 'strong_new_cohorts') headline = 'New joiners are engaging well, indicating high-quality acquisition.';
        else if (acquisition === 'broad_low_quality') headline = 'Many new profiles never engage, diluting list quality.';
        else headline = 'Engagement varies by profile age, with mixed signals on quality.';

        let summary: string;
        if (acquisition === 'broad_low_quality') summary = 'Onboarding and habit-building for 0–6 month profiles should be the immediate focus.';
        else if (maintenance === 'aging_dead_weight') summary = 'Reactivation and sunset programs for older cohorts need attention.';
        else if (maintenance === 'cleaned_old_inactives') summary = 'Keep hygiene strong while investing in growth and nurture programs.';
        else if (stability === 'habits_form_by_month6') summary = 'Maintain momentum in the six-to-twelve-month window to solidify habits.';
        else if (stability === 'midlife_drop') summary = 'Re-energize one-to-two-year cohorts to prevent drop-off.';
        else summary = 'Balance onboarding, nurture, and hygiene to keep cohorts aligned.';

        const sentences: string[] = [];
        if (acquisition === 'broad_low_quality') sentences.push('A high share of never-engaged profiles inside the first six months shows acquisition is broad but low intent.');
        else if (acquisition === 'strong_new_cohorts') sentences.push('Early cohorts already interact, indicating acquisition brings in motivated subscribers.');
        else sentences.push('New cohorts mix eager readers with quiet sign-ups, hinting at uneven acquisition quality.');

        if (overallTrend === 'recent_outpaces_never') sentences.push('Across the whole list, recent interactions still outweigh the portion that never engages, so the channel retains momentum.');
        else sentences.push('Across the whole list, never-engaged profiles outweigh recent opens, underscoring the need to tighten early nurture.');

        if (maintenance === 'cleaned_old_inactives') sentences.push('Older age groups stay relatively clean, suggesting consistent suppression of dead weight.');
        else if (maintenance === 'aging_dead_weight') sentences.push('Older cohorts store dormant addresses, signalling that hygiene work has lagged.');
        else sentences.push('Older cohorts are neither especially clean nor especially cluttered, leaving room to tighten hygiene.');

        if (stability === 'habits_form_by_month6') sentences.push('Engagement habits appear to form by the six-month mark and hold through the first year.');
        else if (stability === 'midlife_drop') sentences.push('Engagement fades once profiles pass the one-year mark, showing habits require mid-life reinforcement.');
        else sentences.push('Engagement stays fairly even as profiles age, avoiding dramatic swings.');

        if (acquisition === 'broad_low_quality') sentences.push('Allocate extra effort to onboarding flows, welcome education, and early proof that encourages first actions.');
        else if (maintenance === 'aging_dead_weight') sentences.push('Dedicate resources to reactivation and sunset campaigns so older cohorts either re-engage or exit gracefully.');
        else if (stability === 'midlife_drop') sentences.push('Balance onboarding wins with programs that re-energize the one-to-two-year audience.');
        else sentences.push('Distribute effort across welcome journeys, loyalty reinforcement, and recurring hygiene checks.');

        sentences.push('If the pattern flips—strong early engagement but heavy inactivity later—it usually points to hygiene issues rather than acquisition, so keep watching these signals.');

        const paragraph = sentences.slice(0, 5).join(' ');

        return { headline, summary, paragraph };
    }, [hasData, subscribers, dataManager, dateRange, customTo, referenceDate]);

    const consentSplitNote = React.useMemo<ConsentSplitNote | null>(() => {
        if (!hasData) return null;
        if (!subscribers.length) return null;

        const safeDate = (value?: Date) => {
            if (!value) return null;
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? null : d;
        };

        const anchorDate = safeDate(referenceDate) || safeDate(dataManager.getLastEmailDate()) || new Date();

        const range = (() => {
            try {
                if (dateRange === 'custom' && customFrom && customTo) {
                    return {
                        start: new Date(`${customFrom}T00:00:00`),
                        end: new Date(`${customTo}T23:59:59`)
                    };
                }
                if (dateRange === 'all') {
                    const createdDates = subscribers
                        .map(sub => sub.profileCreated instanceof Date ? sub.profileCreated.getTime() : NaN)
                        .filter(ts => !Number.isNaN(ts));
                    if (!createdDates.length) return null;
                    return { start: new Date(Math.min(...createdDates)), end: new Date(Math.max(...createdDates)) };
                }
                if (typeof dateRange === 'string' && dateRange.endsWith('d')) {
                    const days = parseInt(dateRange.replace('d', ''), 10) || 30;
                    const end = new Date(anchorDate);
                    end.setHours(23, 59, 59, 999);
                    const start = new Date(end);
                    start.setDate(start.getDate() - days + 1);
                    start.setHours(0, 0, 0, 0);
                    return { start, end };
                }
                return null;
            } catch {
                return null;
            }
        })();

        const filteredSubscribers = range
            ? subscribers.filter(sub => {
                const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
                if (!created) return false;
                return created >= range.start && created <= range.end;
            })
            : subscribers;

        if (!filteredSubscribers.length) return null;

        const periodLabel = (() => {
            if (!range) return 'the selected window';
            if (typeof dateRange === 'string' && dateRange.endsWith('d')) {
                const days = parseInt(dateRange.replace('d', ''), 10) || 30;
                return `profiles created in the last ${days} days`;
            }
            if (dateRange === 'custom' && customFrom && customTo) {
                const from = new Date(`${customFrom}T00:00:00`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                const to = new Date(`${customTo}T00:00:00`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                return `profiles created between ${from} and ${to}`;
            }
            if (dateRange === 'all') {
                return 'the full subscriber history';
            }
            const from = range.start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            const to = range.end.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            return `profiles created between ${from} and ${to}`;
        })();

        const toMap = (groups: { key: ConsentGroupKey; value: number; sampleSize: number; percentOfGroup?: number | null }[]) => {
            return groups.reduce<Record<ConsentGroupKey, { value: number; sampleSize: number; percent?: number }>>((acc, group) => {
                acc[group.key] = { value: group.value || 0, sampleSize: group.sampleSize || 0, percent: group.percentOfGroup ?? undefined };
                return acc;
            }, {
                Subscribed: { value: 0, sampleSize: 0 },
                'Not Subscribed': { value: 0, sampleSize: 0 },
            });
        };

        const countMap = toMap(getConsentSplitMetrics(filteredSubscribers, 'count', anchorDate).groups);
        const revenueMap = toMap(getConsentSplitMetrics(filteredSubscribers, 'totalRevenue', anchorDate).groups);
        const engagedMap = toMap(getConsentSplitMetrics(filteredSubscribers, 'engaged30', anchorDate).groups);

        const subscribedCount = countMap.Subscribed.value;
        const notSubscribedCount = countMap['Not Subscribed'].value;
        const totalCount = subscribedCount + notSubscribedCount;

        if (totalCount === 0) return null;

        const subscribedRevenue = revenueMap.Subscribed.value;
        const notSubscribedRevenue = revenueMap['Not Subscribed'].value;
        const totalRevenue = subscribedRevenue + notSubscribedRevenue;

        const subscribedVolumeShare = totalCount > 0 ? (subscribedCount / totalCount) * 100 : 0;
        const notSubscribedVolumeShare = 100 - subscribedVolumeShare;
        const subscribedValueShare = totalRevenue > 0 ? (subscribedRevenue / totalRevenue) * 100 : subscribedVolumeShare;
        const notSubscribedValueShare = 100 - subscribedValueShare;

        const subscribedEngaged = engagedMap.Subscribed.percent ?? 0;
        const notSubscribedEngaged = engagedMap['Not Subscribed'].percent ?? 0;
        const engagedDelta = subscribedEngaged - notSubscribedEngaged;

        const valueDiff = subscribedValueShare - notSubscribedValueShare;
        const volumeDiff = subscribedVolumeShare - notSubscribedVolumeShare;

        const subscribedValueLead = valueDiff >= 5;
        const notSubscribedValueLead = valueDiff <= -5;
        const subscribedVolumeLead = volumeDiff >= 5;
        const notSubscribedVolumeLead = volumeDiff <= -5;
        const engagedLeadSubscribed = engagedDelta >= 2;
        const engagedLeadNotSubscribed = engagedDelta <= -2;

        const shareLabel = formatPercent(subscribedValueShare);
        const headline = `Subscribed profiles drive ${shareLabel} of tracked revenue for ${periodLabel}.`;

        const subscribedValueMeaningful = subscribedValueShare >= 10;
        const notSubscribedValueMeaningful = notSubscribedValueShare >= 10;

        let summary: string;
        if (subscribedValueLead && engagedLeadSubscribed) {
            summary = 'Subscribed profiles bring the most value and activity, so grow that opted-in list and invite imports to confirm.';
        } else if (notSubscribedVolumeLead) {
            summary = 'Not subscribed profiles make up most of the list, so ask them to opt in and remove the ones who stay quiet.';
        } else if (notSubscribedValueLead) {
            summary = 'Revenue leans on not subscribed profiles, so turn their spend into opt-ins and tidy up inactive records.';
        } else {
            summary = 'Value and engagement are split, so run opt-in pushes and regular clean-up together.';
        }

        const describeShare = (pct: number) => {
            if (pct >= 65) return 'Most';
            if (pct >= 55) return 'More than half';
            if (pct >= 45) return 'Roughly half';
            if (pct >= 35) return 'Less than half';
            return 'A small slice';
        };

        const sentences: string[] = [];
        const timeframeDescriptor = periodLabel || 'the selected window';

        const firstSentenceLead = describeShare(subscribedValueShare);
        sentences.push(`${firstSentenceLead} of the revenue we track still comes from subscribed profiles during ${timeframeDescriptor}.`);

        if (engagedLeadSubscribed) {
            sentences.push('They also open and click more in the recent window, which shows opted-in readers stay engaged.');
        } else if (engagedLeadNotSubscribed) {
            sentences.push('Not subscribed contacts are opening slightly more right now, so recent imports still respond when nudged.');
        } else {
            sentences.push('Recent engagement looks similar for both groups, so consent status by itself does not tell you who is active.');
        }

        if (notSubscribedVolumeLead) {
            sentences.push('Not subscribed profiles make up more of the list, which boosts reach but adds deliverability risk if they cool off.');
        } else if (subscribedVolumeLead) {
            sentences.push('Subscribed profiles also dominate volume, so growth is anchored in permission-based channels.');
        } else {
            sentences.push('Overall volume is fairly balanced between consented and imported cohorts.');
        }

        let ltvSentence: string;
        if (subscribedValueMeaningful && notSubscribedValueMeaningful) {
            ltvSentence = 'Both groups account for a noticeable share of lifetime value, so keep their journeys active.';
        } else if (subscribedValueMeaningful) {
            ltvSentence = 'Subscribed profiles account for a noticeable share of lifetime value, so keep that audience warm.';
        } else if (notSubscribedValueMeaningful) {
            ltvSentence = 'Not subscribed contacts still hold a noticeable slice of lifetime value, so move them toward opt-in before they drop off.';
        } else {
            ltvSentence = 'Lifetime value is spread thin across both consent groups right now.';
        }
        sentences.push(ltvSentence);

        let actionSentence: string;
        if (subscribedValueLead) {
            actionSentence = 'Offer simple welcome perks to reward subscribers, and send a short opt-in series to imports so they can join them.';
        } else if (notSubscribedValueLead) {
            actionSentence = 'Plan a quick opt-in path for not subscribed buyers and remove imports who stay silent after a few reminders.';
        } else {
            actionSentence = 'Run opt-in nudges alongside fast clean-up passes that pause emails to imports who never respond.';
        }
        sentences.push(actionSentence);

        sentences.push('If imports start growing faster than revenue from subscribers, slow new imports and focus on collecting consent first.');

        const paragraph = sentences.slice(0, 6).join(' ');

        return {
            headline,
            summary,
            paragraph
        };
    }, [hasData, subscribers, dataManager, dateRange, customFrom, customTo, referenceDate]);

    // Inactive segments
    interface InactiveSegmentDetail {
        label: string;
        count: number;
        percent: number;
        olderThan30DaysPct?: number;
    }

    const inactiveSegments = React.useMemo<InactiveSegmentDetail[]>(() => {
        if (!hasData) return [];
        const lastEmailDate = dataManager.getLastEmailDate();
        const total = subscribers.length;
        const neverActiveCount = subscribers.filter(sub => {
            if (sub.lastActive == null) return true;
            if (sub.lastActive instanceof Date) {
                const t = sub.lastActive.getTime();
                return isNaN(t) || t === 0;
            }
            return true;
        }).length;
        const counters = [
            { label: 'Never Active', count: neverActiveCount, olderThan30DaysPct: 0 },
            { label: 'Inactive for 90+ days', days: 90, count: 0 },
            { label: 'Inactive for 120+ days', days: 120, count: 0 },
            { label: 'Inactive for 180+ days', days: 180, count: 0 },
            { label: 'Inactive for 365+ days', days: 365, count: 0 },
        ] as any[];
        let neverActiveOlderThan30 = 0;
        subscribers.forEach(sub => {
            if (sub.lastActive && lastEmailDate) {
                const diffDays = Math.floor((lastEmailDate.getTime() - sub.lastActive.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays >= 90) counters[1].count++;
                if (diffDays >= 120) counters[2].count++;
                if (diffDays >= 180) counters[3].count++;
                if (diffDays >= 365) counters[4].count++;
            } else if (sub.lastActive == null) {
                const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
                if (created && lastEmailDate) {
                    const diff = Math.floor((lastEmailDate.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
                        if (diff >= 30) neverActiveOlderThan30++;
                }
            }
        });
        counters[0].olderThan30DaysPct = neverActiveCount > 0 ? (neverActiveOlderThan30 / neverActiveCount) * 100 : 0;
        return counters.map(c => ({ label: c.label, count: c.count, percent: total > 0 ? (c.count / total) * 100 : 0, olderThan30DaysPct: c.olderThan30DaysPct }));
    }, [hasData, subscribers, dataManager]);

    // Dead Weight Subscribers & Savings module
    const deadWeight = React.useMemo(() => {
        if (!hasData) return null as null | {
            segment1: string[]; // emails
            segment2: string[];
            combined: string[];
            currentPrice: number | null;
            newPrice: number | null;
            monthlySavings: number | null;
            annualSavings: number | null;
        };

        const anchor = referenceDate ? new Date(referenceDate) : dataManager.getLastEmailDate();
        const daysDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

        // Pricing tiers (min, max, price)
        const pricing: { min: number; max: number; price: number }[] = [
            { min: 0, max: 250, price: 0 },
            { min: 251, max: 500, price: 20 },
            { min: 501, max: 1000, price: 30 },
            { min: 1001, max: 1500, price: 45 },
            { min: 1501, max: 2500, price: 60 },
            { min: 2501, max: 3000, price: 70 },
            { min: 3001, max: 3500, price: 80 },
            { min: 3501, max: 5000, price: 100 },
            { min: 5001, max: 5500, price: 110 },
            { min: 5501, max: 6000, price: 130 },
            { min: 6001, max: 6500, price: 140 },
            { min: 6501, max: 10000, price: 150 },
            { min: 10001, max: 10500, price: 175 },
            { min: 10501, max: 11000, price: 200 },
            { min: 11001, max: 11500, price: 225 },
            { min: 11501, max: 12000, price: 250 },
            { min: 12001, max: 12500, price: 275 },
            { min: 12501, max: 13000, price: 300 },
            { min: 13001, max: 13500, price: 325 },
            { min: 13501, max: 15000, price: 350 },
            { min: 15001, max: 20000, price: 375 },
            { min: 20001, max: 25000, price: 400 },
            { min: 25001, max: 26000, price: 425 },
            { min: 26001, max: 27000, price: 450 },
            { min: 27001, max: 28000, price: 475 },
            { min: 28001, max: 30000, price: 500 },
            { min: 30001, max: 35000, price: 550 },
            { min: 35001, max: 40000, price: 600 },
            { min: 40001, max: 45000, price: 650 },
            { min: 45001, max: 50000, price: 720 },
            { min: 50001, max: 55000, price: 790 },
            { min: 55001, max: 60000, price: 860 },
            { min: 60001, max: 65000, price: 930 },
            { min: 65001, max: 70000, price: 1000 },
            { min: 70001, max: 75000, price: 1070 },
            { min: 75001, max: 80000, price: 1140 },
            { min: 80001, max: 85000, price: 1205 },
            { min: 85001, max: 90000, price: 1265 },
            { min: 90001, max: 95000, price: 1325 },
            { min: 95001, max: 100000, price: 1380 },
            { min: 100001, max: 105000, price: 1440 },
            { min: 105001, max: 110000, price: 1495 },
            { min: 110001, max: 115000, price: 1555 },
            { min: 115001, max: 120000, price: 1610 },
            { min: 120001, max: 125000, price: 1670 },
            { min: 125001, max: 130000, price: 1725 },
            { min: 130001, max: 135000, price: 1785 },
            { min: 135001, max: 140000, price: 1840 },
            { min: 140001, max: 145000, price: 1900 },
            { min: 145001, max: 150000, price: 1955 },
            { min: 150001, max: 200000, price: 2070 },
            { min: 200001, max: 250000, price: 2300 },
        ];

        const priceFor = (count: number): number | null => {
            if (count > 250000) return null; // custom pricing
            const tier = pricing.find(t => count >= t.min && count <= t.max);
            return tier ? tier.price : null;
        };

        // Segment 1: First Active not set AND Last Active not set AND Created at least 30 days ago
        const seg1Emails: string[] = [];
        // Segment 2: Last Click >= 90 days ago AND Last Open >= 90 days ago AND Created >= 90 days ago
        const seg2Emails: string[] = [];

        subscribers.forEach(sub => {
            const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
            const createdAge = created ? daysDiff(anchor, created) : 0;
            const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
            const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;

            // Segment 1 condition (using firstActiveRaw to detect unset)
            const firstActiveUnset = !sub.firstActiveRaw; // raw missing
            const lastActiveUnset = !sub.lastActive;
            if (firstActiveUnset && lastActiveUnset && createdAge >= 30) {
                seg1Emails.push(sub.email.toLowerCase());
            }

            // Segment 2 condition
            if (createdAge >= 90) {
                const openAge = lastOpen ? daysDiff(anchor, lastOpen) : Infinity; // if missing treat as very old
                const clickAge = lastClick ? daysDiff(anchor, lastClick) : Infinity;
                if (openAge >= 90 && clickAge >= 90) {
                    seg2Emails.push(sub.email.toLowerCase());
                }
            }
        });

        // Combine & dedupe
        const combinedSet = new Set<string>([...seg1Emails, ...seg2Emails]);
        const combined = Array.from(combinedSet);

        const currentCount = subscribers.length;
        const deadWeightCount = combined.length;
        const projectedCount = Math.max(0, currentCount - deadWeightCount);

        const currentPrice = priceFor(currentCount);
        const newPrice = priceFor(projectedCount);
        const monthlySavings = currentPrice !== null && newPrice !== null ? currentPrice - newPrice : null;
        const annualSavings = monthlySavings !== null ? monthlySavings * 12 : null;

        return {
            segment1: seg1Emails,
            segment2: seg2Emails,
            combined,
            currentPrice,
            newPrice,
            monthlySavings,
            annualSavings,
        };
    }, [hasData, subscribers, dataManager]);

    if (!hasData) {
        return (
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <Users className="w-6 h-6 text-purple-600" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Audience Overview
                        <InfoTooltipIcon placement="bottom-start" content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>Key counts and averages about your audience today.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>We compute totals and simple percentages from your latest snapshot.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Use this as a quick health check before diving deeper.</p>
                            </div>
                        )} />
                    </h2>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-500" />
                    <p className="text-gray-600 dark:text-gray-400">No subscriber data available. Upload subscriber CSV to see audience insights.</p>
                </div>
            </section>
        );
    }

    return (
        <section>
            <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-purple-600" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">Audience Overview
                    <InfoTooltipIcon placement="bottom-start" content={(
                        <div>
                            <p className="font-semibold mb-1">What</p>
                            <p>Key counts and averages about your audience today.</p>
                            <p className="font-semibold mt-2 mb-1">How</p>
                            <p>We compute totals and simple percentages from your latest snapshot. Values follow your date range when relevant.</p>
                            <p className="font-semibold mt-2 mb-1">Why</p>
                            <p>Use this as a quick health check before diving deeper.</p>
                        </div>
                    )} />
                </h2>
            </div>
            <div className="mb-6">
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-2.5">
                    <p className="text-xs text-purple-900 dark:text-purple-100">
                        <span className="font-medium">Note:</span> Profile data through Sept 22, 2025. Active profiles only. Revenue reflects total CLV, not just Klaviyo-attributed.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Active Audience</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{audienceInsights.totalSubscribers.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Buyers</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{audienceInsights.buyerCount.toLocaleString()}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{(() => {
                        const value = (audienceInsights.buyerPercentage || 0);
                        const formatted = value.toFixed(1);
                        const num = parseFloat(formatted);
                        return num >= 1000 ? `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : `${formatted}%`;
                    })()} of total</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Avg CLV (All)</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(audienceInsights.avgClvAll)}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Avg CLV (Buyers)</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(audienceInsights.avgClvBuyers)}</p>
                </div>
            </div>

            <div className="mb-6">
                {/* Audience Growth module */}
                {React.createElement(require('./AudienceGrowth').default, { dateRange, granularity, customFrom, customTo })}
            </div>
            {/* Subscribed vs Not Subscribed module (below Audience Growth) */}
            <div className="mb-8">
                {React.createElement(require('./SubscribedVsNotSubscribed').default, { dateRange, customFrom, customTo, referenceDate })}
            </div>
            {consentSplitNote && (
                <div className="mb-8 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{consentSplitNote.headline}</p>
                            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{consentSplitNote.summary}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowConsentSplitDetails(prev => !prev)}
                            className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                            aria-expanded={showConsentSplitDetails}
                            aria-controls="consent-split-note-details"
                        >
                            {showConsentSplitDetails ? 'Hide Insights' : 'View Insights'}
                            <ChevronDown className={`w-4 h-4 transition-transform ${showConsentSplitDetails ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                    {showConsentSplitDetails && (
                        <div id="consent-split-note-details" className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            <p>{consentSplitNote.paragraph}</p>
                        </div>
                    )}
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Repeat2 className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Purchase Frequency Distribution
                            <InfoTooltipIcon placement="top" content={(
                                <div>
                                    <p className="font-semibold mb-1">What</p>
                                    <p>How many people bought once, twice, or many times.</p>
                                    <p className="font-semibold mt-2 mb-1">How</p>
                                    <p>We group profiles by total orders to show the shape of your buyer base.</p>
                                    <p className="font-semibold mt-2 mb-1">Why</p>
                                    <p>Spot opportunities to move one-time buyers to repeat purchasers.</p>
                                </div>
                            )} />
                        </h3>
                    </div>
                    <div className="space-y-3">
                        {purchaseFrequencyData.map((item) => (
                            <div key={item.label}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{`${item.value.toLocaleString()} (${formatPercent(item.percentage)})`}</span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${item.percentage}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                    {purchaseActionNote && (
                        <div className="mt-6 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{purchaseActionNote.headline}</p>
                                    {purchaseActionNote.body && (
                                        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{purchaseActionNote.body}</p>
                                    )}
                                </div>
                                {purchaseActionNote.segments.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowPurchaseActionDetails(prev => !prev)}
                                        className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                                        aria-expanded={showPurchaseActionDetails}
                                        aria-controls="purchase-action-note-details"
                                    >
                                        {showPurchaseActionDetails ? 'Hide Insights' : 'View Insights'}
                                        <ChevronDown className={`w-4 h-4 transition-transform ${showPurchaseActionDetails ? 'rotate-180' : ''}`} />
                                    </button>
                                )}
                            </div>
                            {showPurchaseActionDetails && purchaseActionNote.segments.length > 0 && (
                                <div id="purchase-action-note-details" className="mt-4 space-y-5">
                                    {purchaseActionNote.segments.map(segment => (
                                        <div key={segment.key} className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{segment.label}</span>
                                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{segment.count.toLocaleString()} • {formatPercent(segment.percentage)}</span>
                                            </div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{segment.recommendation}</p>
                                            {segment.caution && (
                                                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed"><span className="font-medium text-gray-700 dark:text-gray-300">Caution:</span> {segment.caution}</p>
                                            )}
                                            <div className="pt-1">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Campaign ideas</p>
                                                <ul className="mt-1 list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                                    {segment.ideas.map((idea, idx) => (
                                                        <li key={`${segment.key}-idea-${idx}`}>{idea}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <SquareUser className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Audience Lifetime
                            <InfoTooltipIcon placement="top" content={(
                                <div>
                                    <p className="font-semibold mb-1">What</p>
                                    <p>How long people have been on your list.</p>
                                    <p className="font-semibold mt-2 mb-1">How</p>
                                    <p>We bucket profiles by time since they joined.</p>
                                    <p className="font-semibold mt-2 mb-1">Why</p>
                                    <p>Balance acquisition and retention. A newer list needs more onboarding. An older list may need reactivation.</p>
                                </div>
                            )} />
                        </h3>
                    </div>
                    <div className="space-y-3">
                        {lifetimeData.map((item) => (
                            <div key={item.label}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{`${item.value.toLocaleString()} (${formatPercent(item.percentage)})`}</span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${item.percentage}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                    {lifetimeActionNote && (
                        <div className="mt-6 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{lifetimeActionNote.headline}</p>
                                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{lifetimeActionNote.body}</p>
                                </div>
                                {lifetimeActionNote.segments.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowLifetimeActionDetails(prev => !prev)}
                                        className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                                        aria-expanded={showLifetimeActionDetails}
                                        aria-controls="lifetime-action-note-details"
                                    >
                                        {showLifetimeActionDetails ? 'Hide Insights' : 'View Insights'}
                                        <ChevronDown className={`w-4 h-4 transition-transform ${showLifetimeActionDetails ? 'rotate-180' : ''}`} />
                                    </button>
                                )}
                            </div>
                            {showLifetimeActionDetails && lifetimeActionNote.segments.length > 0 && (
                                <div id="lifetime-action-note-details" className="mt-4 space-y-5">
                                    {lifetimeActionNote.segments.map(segment => (
                                        <div key={segment.label} className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{segment.label}</span>
                                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{segment.count.toLocaleString()} • {formatPercent(segment.percentage)}</span>
                                            </div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{segment.summary}</p>
                                            {segment.ideas.length > 0 && (
                                                <div className="pt-1">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Campaign ideas</p>
                                                    <ul className="mt-1 list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                                        {segment.ideas.map((idea, idx) => (
                                                            <li key={`${segment.label}-idea-${idx}`}>{idea}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* High-Value Customer Segments */}
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">High-Value Customer Segments
                        <InfoTooltipIcon placement="top" content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>Buyers who spend much more than average.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>We group buyers into 2x–&lt;3x, 3x–&lt;6x, and 6x+ of your buyer AOV (mutually exclusive tiers).</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Protect and grow these relationships with VIP offers and tailored flows.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="space-y-3">
                    {highValueSegments.map((seg) => (
                        <div key={seg.label}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{seg.label}</span>
                                <span className="text-sm text-gray-900 dark:text-gray-100">{seg.customers.toLocaleString()} customers • {formatCurrency(seg.revenue)} revenue • {formatPercent(seg.revenueShareOfList)} of total revenue</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${seg.revenueShareOfList}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
                {highValueActionNote && (
                    <div className="mt-6 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{highValueActionNote.headline}</p>
                                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{highValueActionNote.body}</p>
                            </div>
                            {highValueActionNote.segments.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setShowHighValueActionDetails(prev => !prev)}
                                    className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                                    aria-expanded={showHighValueActionDetails}
                                    aria-controls="high-value-action-note-details"
                                >
                                    {showHighValueActionDetails ? 'Hide Insights' : 'View Insights'}
                                    <ChevronDown className={`w-4 h-4 transition-transform ${showHighValueActionDetails ? 'rotate-180' : ''}`} />
                                </button>
                            )}
                        </div>
                        {showHighValueActionDetails && highValueActionNote.segments.length > 0 && (
                            <div id="high-value-action-note-details" className="mt-4 space-y-5">
                                {highValueActionNote.segments.map((segment, idx) => (
                                    <div key={`high-value-segment-${idx}`} className="space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{segment.name}</span>
                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{segment.customers.toLocaleString()} customers • {formatCurrency(segment.revenue)}</span>
                                        </div>
                                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{segment.summary}</p>
                                        {segment.ideas.length > 0 && (
                                            <div className="pt-1">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Campaign ideas</p>
                                                <ul className="mt-1 list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                                    {segment.ideas.map((idea, ideaIdx) => (
                                                        <li key={`hv-idea-${idx}-${ideaIdx}`}>{idea}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Inactive Segments */}
            <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                    <MousePointerClick className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Inactive Segments
                        <InfoTooltipIcon placement="top" content={(
                            <div>
                                <p className="font-semibold mb-1">What</p>
                                <p>How long profiles have gone without engaging.</p>
                                <p className="font-semibold mt-2 mb-1">How</p>
                                <p>We group profiles by days since the last open or click, and include those who never engaged.</p>
                                <p className="font-semibold mt-2 mb-1">Why</p>
                                <p>Spot inactivity early. Warm recent engagers and re-engage older cohorts before suppressing.</p>
                            </div>
                        )} />
                    </h3>
                </div>
                <div className="space-y-3">
                    {inactiveSegments.map((seg) => (
                        <div key={seg.label}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{seg.label}</span>
                                <span className="text-sm text-gray-900 dark:text-gray-100">{seg.count.toLocaleString()} ({formatPercent(seg.percent)})</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${seg.percent}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
                {(() => {
                    const totalInactive = inactiveSegments.reduce((sum, seg) => sum + seg.percent, 0);
                    const totalInactivePct = formatPercent(totalInactive);
                    const largest = inactiveSegments.reduce((prev, curr) => (curr.percent > prev.percent ? curr : prev), inactiveSegments[0]);
                    const largestIsNever = largest?.label === 'Never Active';
                    const allSmall = inactiveSegments.every(seg => seg.percent < 5);
                    let subline: string;
                    if (largestIsNever) subline = 'Warm recent joiners, escalate older non-engagers, and keep a clean list.';
                    else if (allSmall) subline = 'Run light reactivation and maintain conservative frequency.';
                    else subline = 'Prioritize staged reactivation and tighten list hygiene.';

                    const segmentIdeasMap: Record<string, string[]> = {
                        'Never Active': [
                            'Welcome refresher with strong proof and a single clear action',
                            '“What you’ve missed” digest that spotlights most-viewed content',
                            'Final nudge before suppression with preference link'
                        ],
                        'Inactive for 90+ days': [
                            'Seasonal “here’s what’s new” update',
                            'Preference update to reset cadence',
                            'Gentle offer or bundle reminder'
                        ],
                        'Inactive for 120+ days': [
                            'Stronger limited-time incentive',
                            '“Still want to hear from us?” consent check',
                            'Sunset countdown followed by suppression if no response'
                        ],
                        'Inactive for 180+ days': [
                            'Stronger limited-time incentive',
                            '“Still want to hear from us?” consent check',
                            'Sunset countdown followed by suppression if no response'
                        ],
                        'Inactive for 365+ days': [
                            'Stronger limited-time incentive',
                            '“Still want to hear from us?” consent check',
                            'Sunset countdown followed by suppression if no response'
                        ]
                    };

                    const segmentSummary = (seg: InactiveSegmentDetail) => {
                        if (seg.label === 'Never Active') {
                            const olderPct = seg.olderThan30DaysPct ?? 0;
                            return olderPct >= 50 ? 'Most have never engaged after 30 days.' : 'Many are new non-engagers; give them a short runway.';
                        }
                        if (seg.label === 'Inactive for 90+ days') {
                            return 'Early reactivation window; keep tone light.';
                        }
                        return 'Older inactivity cohort; escalate and decide.';
                    };

                    if (!inactiveSegments.some(seg => seg.percent > 0)) return null;

                    return (
                        <div className="mt-6 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Inactive profiles make up {totalInactivePct} of the list.</p>
                                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{subline}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowInactiveActionDetails(prev => !prev)}
                                    className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                                    aria-expanded={showInactiveActionDetails}
                                    aria-controls="inactive-action-note-details"
                                >
                                    {showInactiveActionDetails ? 'Hide Insights' : 'View Insights'}
                                    <ChevronDown className={`w-4 h-4 transition-transform ${showInactiveActionDetails ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                            {showInactiveActionDetails && (
                                <div id="inactive-action-note-details" className="mt-4 space-y-5">
                                    {inactiveSegments.filter(seg => seg.percent > 0).map((seg, idx) => (
                                        <div key={`inactive-segment-${idx}`} className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{seg.label}</span>
                                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{seg.count.toLocaleString()} • {formatPercent(seg.percent)}</span>
                                            </div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{segmentSummary(seg)}</p>
                                            {seg.label === 'Never Active' && (
                                                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">If a profile remains unengaged for 30 days, suppress.</p>
                                            )}
                                            <div className="pt-1">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Campaign ideas</p>
                                                <ul className="mt-1 list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                                    {(segmentIdeasMap[seg.label] || segmentIdeasMap['Inactive for 120+ days']).map((idea, ideaIdx) => (
                                                        <li key={`inactive-idea-${idx}-${ideaIdx}`}>{idea}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* Engagement by Tenure heatmap */}
            <EngagementByTenure subscribers={subscribers} dateRange={dateRange} customTo={customTo} />

            {engagementAgeNote && (
                <div className="mt-6 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{engagementAgeNote.headline}</p>
                            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{engagementAgeNote.summary}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowEngagementAgeDetails(prev => !prev)}
                            className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                            aria-expanded={showEngagementAgeDetails}
                            aria-controls="engagement-age-action-note-details"
                        >
                            {showEngagementAgeDetails ? 'Hide Insights' : 'View Insights'}
                            <ChevronDown className={`w-4 h-4 transition-transform ${showEngagementAgeDetails ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                    {showEngagementAgeDetails && (
                        <div id="engagement-age-action-note-details" className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            {engagementAgeNote.paragraph}
                        </div>
                    )}
                </div>
            )}

            {/* Inactivity Revenue Drain (placed after Inactive Segments and heatmap) */}
            <InactivityRevenueDrain subscribers={subscribers} />

            {/* Dead Weight Audience & Potential Savings */}
            {deadWeight && (
                <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Trash2 className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">Dead Weight Audience
                            <InfoTooltipIcon placement="top" content={(
                                <div>
                                    <p className="font-semibold mb-1">What</p>
                                    <p>People who never engaged or have been inactive for a long time and the cost impact.</p>
                                    <p className="font-semibold mt-2 mb-1">How</p>
                                    <p>We detect never active and long inactive profiles and estimate Klaviyo plan savings if suppressed.</p>
                                    <p className="font-semibold mt-2 mb-1">Why</p>
                                    <p>Try a light re engagement first. Then suppress to cut costs and protect deliverability.</p>
                                </div>
                            )} />
                        </h3>
                    </div>

                    {/* Summary */}
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div>
                            <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{deadWeight.combined.length.toLocaleString()}</p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Dead weight audience ({((deadWeight.combined.length / subscribers.length) * 100).toFixed(1)}% of list)</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Projected List After Purge</p>
                            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{(subscribers.length - deadWeight.combined.length).toLocaleString()}</p>
                        </div>
                    </div>

                    {/* Bar visualization */}
                    <div className="mt-6">
                        <div className="flex items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <span>Dead Weight</span>
                            <span>Total {subscribers.length.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500" style={{ width: `${(deadWeight.combined.length / subscribers.length) * 100}%` }} />
                        </div>
                    </div>

                    {/* Savings */}
                    <div className="mt-8">
                        {deadWeight.combined.length === 0 ? (
                            <div className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                                <CheckCircle className="w-4 h-4 mt-0.5" />
                                <div>
                                    <p className="font-medium mb-1 text-green-800 dark:text-green-300">No dead‑weight detected</p>
                                    <p className="text-xs leading-relaxed text-green-700 dark:text-green-400">You’re not overpaying for your Klaviyo account. Good job!</p>
                                </div>
                            </div>
                        ) : deadWeight.currentPrice === null ? (
                            <div className="text-sm text-gray-600 dark:text-gray-400">Custom pricing tier (&gt; 250,000). Savings not calculated.</div>
                        ) : deadWeight.monthlySavings !== null && deadWeight.monthlySavings > 0 ? (
                            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <PiggyBank className="w-5 h-5 text-purple-600" />
                                        <h4 className="text-md font-semibold text-gray-900 dark:text-gray-100">Potential Savings</h4>
                                    </div>
                                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">${deadWeight.annualSavings!.toLocaleString('en-US', { minimumFractionDigits: 0 })}<span className="text-lg font-medium text-gray-500 dark:text-gray-400"> / yr</span></p>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{deadWeight.monthlySavings!.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })} per month</p>
                                </div>
                                <div className="grid grid-cols-2 gap-6 text-sm">
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400">Current Monthly</p>
                                        <p className="font-medium text-gray-900 dark:text-gray-100">{deadWeight.currentPrice !== null ? deadWeight.currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }) : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400">After Purge</p>
                                        <p className="font-medium text-gray-900 dark:text-gray-100">{deadWeight.newPrice !== null ? deadWeight.newPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }) : '—'}</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-gray-600 dark:text-gray-400">You’re not overpaying for your Klaviyo account. Good job!</div>
                        )}
                    </div>
                    {deadWeight && deadWeight.monthlySavings !== null && deadWeight.monthlySavings > 0 && (
                        <p className="mt-6 text-xs text-gray-500 dark:text-gray-500">Estimation only. Klaviyo pricing may change at any time; actual savings may vary.</p>
                    )}
                    <div className="mt-3">
                        <button
                            type="button"
                            onClick={() => setShowDeadWeightGuide(true)}
                            className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline"
                        >How to suppress dead-weight audience in Klaviyo?</button>
                    </div>
                    {showDeadWeightGuide && (
                        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeadWeightGuide(false)}></div>
                            <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-6 animate-fade-in">
                                <div className="flex items-start justify-between mb-4">
                                    <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                        <Trash2 className="w-5 h-5 text-purple-600" /> Suppress Dead‑Weight Audience
                                    </h4>
                                    <button onClick={() => setShowDeadWeightGuide(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Close">
                                        ✕
                                    </button>
                                </div>
                                <div className="space-y-6 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                                    <div>
                                        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Create two Klaviyo segments:</p>
                                        <div className="space-y-4">
                                            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                                <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-1">Segment 1</p>
                                                <p className="font-medium mb-2">Inactive but emailable for 90+ days</p>
                                                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                                    <li>Person can receive email marketing</li>
                                                    <li>AND Opened Email equals 0 times in the last 90 days</li>
                                                    <li>AND Clicked Email equals 0 times in the last 90 days</li>
                                                    <li>AND Created at least 90 days ago</li>
                                                </ul>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                                <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-1">Segment 2</p>
                                                <p className="font-medium mb-2">Never active and older than 30 days</p>
                                                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                                    <li>Person can receive email marketing</li>
                                                    <li>AND First Active is not set</li>
                                                    <li>AND Last Active is not set</li>
                                                    <li>AND Created at least 30 days ago</li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Then suppress both segments:</p>
                                        <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                            <li>Go to <span className="font-medium">Lists & Segments</span>.</li>
                                            <li>For each segment, click the three vertical dots.</li>
                                            <li>Select <span className="font-medium">“Suppress current members.”</span></li>
                                            <li>Confirm with <span className="font-medium">“Bulk suppress.”</span></li>
                                        </ol>
                                    </div>
                                    <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg p-4 text-xs text-purple-800 dark:text-purple-200">
                                        After suppression, Klaviyo usually adjusts billing automatically. If it doesn’t update, go to <span className="font-medium">Billing → Change plan</span> and select the plan matching your new active subscriber count.
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-500">Tip: Keep a short re‑engagement flow before suppressing to attempt last‑chance activation.</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
