import type { ProcessedCampaign } from "../data/dataTypes";
import {
    computeSubjectAnalysis,
    type FeatureStat,
    type LengthBinStat,
} from "./subjectAnalysis";

export type CampaignSubjectLineTemplate = "general" | "warning" | "wins" | "insufficient";

export interface CampaignSubjectLineNoteCopy {
    headline: string;
    summary: string;
    paragraph: string;
}

export interface CampaignSubjectLineInsight {
    template: CampaignSubjectLineTemplate;
    topRevenueShare?: number;
    topRevenueCount?: number;
    totalRevenue?: number;
    totalEmails: number;
    bestLengthRange?: string;
    bestLengthDelta?: number;
    weakLengthRange?: string;
    weakLengthDelta?: number;
    strongCategory?: string;
    strongCategoryDelta?: number;
    weakCategory?: string;
    weakCategoryDelta?: number;
    totalCampaigns: number;
    note: CampaignSubjectLineNoteCopy;
}

type BaselineMetrics = ReturnType<typeof collectBaseline>;

type PeriodContext = ReturnType<typeof computePeriodContext>;

interface HighlightDetail {
    scope: "category" | "length";
    key: string;
    label: string;
    rpeLift: number;
    rpeValue: number;
    totalEmails: number;
    totalRevenue: number;
    revenueShare: number;
    openRateChange?: number;
    openRateValue?: number;
    clickRateChange?: number;
    clickRateValue?: number;
}

interface CampaignDiagnostic {
    id: string;
    emails: number;
    revenue: number;
    rpe: number;
    openRate: number;
    clickRate: number;
    ctor: number;
    spamRate: number;
    unsubRate: number;
    bounceRate: number;
    openDeltaPercent: number;
    clickDeltaPercent: number;
    ctorDeltaPercent: number;
    lowEfficiency: boolean;
    engagementReasons: string[];
    deliverabilityReasons: string[];
    engagementFlag: boolean;
    deliverabilityFlag: boolean;
    deliverabilityCritical: boolean;
}

interface WarningDetail {
    type: "revenue" | "deliverability";
    volumeShare: number;
    affectedEmails: number;
    affectedRevenue: number;
    affectedRpe?: number;
    baselineRpe: number;
    dropPercent?: number;
    metricLabel?: string;
    metricRate?: number;
    baselineMetric?: number;
    severity: "flag" | "critical";
    reasons: string[];
}

interface SignalSummary {
    warning?: WarningDetail;
    watchReasons: string[];
}

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});

const MIN_CAMPAIGNS_REQUIRED = 5;
const MIN_EMAILS_REQUIRED = 5000;
const MIN_EMAILS_FOR_HIGHLIGHT_SHARE = 0.05;
const MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE = 10000;
const MIN_EMAILS_FOR_WARNING = 10000;
const LOW_REVENUE_MULTIPLIER = 0.7; // 30% below baseline RPE
const LOW_REVENUE_VOLUME_THRESHOLD = 0.2; // 20% of emails in range
const LOW_REVENUE_REVENUE_THRESHOLD = 0.2; // 20% of revenue
const REVENUE_WATCH_VOLUME_THRESHOLD = 0.05; // 5% of emails for watch
const WINS_STRICT_MULTIPLIER = 2.0; // 2x baseline RPE
const WINS_FLEX_MULTIPLIER = 1.5; // 1.5x baseline when share >= threshold
const WINS_SHARE_THRESHOLD = 0.15; // 15% of revenue
const LAGGING_LIFT_THRESHOLD = -15; // -15% vs baseline
const IMPRESSIVE_RPE_MULTIPLIER = 2.0;

// Engagement thresholds (percent deltas vs baseline)
const OPEN_DROP_THRESHOLD = -15; // -15%
const CLICK_DROP_THRESHOLD = -20; // -20%
const CTOR_THRESHOLD = 0.10; // 10%

// Deliverability thresholds
const SPAM_FLAG = 0.001; // 0.1%
const SPAM_CRITICAL = 0.003; // 0.3%
const BOUNCE_FLAG = 0.02; // 2%
const BOUNCE_CRITICAL = 0.05; // 5%
const UNSUB_FLAG = 0.01; // 1%

function formatCurrency(value: number): string {
    return CURRENCY_FORMATTER.format(value || 0);
}

function formatPercent(value: number): string {
    return PERCENT_FORMATTER.format(value);
}

function formatPercentValue(percent: number): string {
    return PERCENT_FORMATTER.format(percent / 100);
}

function capitalize(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function approxPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function safeDivide(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return numerator / denominator;
}

function sum<T>(arr: T[], fn: (item: T) => number): number {
    return arr.reduce((acc, item) => acc + (fn(item) || 0), 0);
}

function collectBaseline(campaigns: ProcessedCampaign[]) {
    const totalRevenue = sum(campaigns, c => c.revenue || 0);
    const totalEmails = sum(campaigns, c => c.emailsSent || 0);
    const totalUnsubs = sum(campaigns, c => c.unsubscribesCount || 0);
    const totalSpam = sum(campaigns, c => c.spamComplaintsCount || 0);
    const totalBounces = sum(campaigns, c => c.bouncesCount || 0);
    const totalOpens = sum(campaigns, c => c.uniqueOpens || 0);
    const totalClicks = sum(campaigns, c => c.uniqueClicks || 0);

    const rpe = safeDivide(totalRevenue, totalEmails);
    const openRate = safeDivide(totalOpens, totalEmails);
    const clickRate = safeDivide(totalClicks, totalEmails);
    const ctor = totalOpens > 0 ? safeDivide(totalClicks, totalOpens) : 0;

    return {
        totalRevenue,
        totalEmails,
        totalUnsubs,
        totalSpam,
        totalBounces,
        totalOpens,
        totalClicks,
        rpe,
        unsubRate: safeDivide(totalUnsubs, totalEmails),
        spamRate: safeDivide(totalSpam, totalEmails),
        bounceRate: safeDivide(totalBounces, totalEmails),
        openRate,
        clickRate,
        ctor,
    };
}

function computePeriodContext(campaigns: ProcessedCampaign[], baseline: BaselineMetrics) {
    const dates = campaigns
        .map(c => c.sentDate)
        .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));

    if (!dates.length) {
        return null;
    }

    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const spanDays = Math.max(1, Math.floor((maxDate.getTime() - minDate.getTime()) / MS_PER_DAY) + 1);
    const bucketLabel = spanDays <= 45 ? "week" : "month";
    const bucketDays = bucketLabel === "week" ? 7 : 30;
    const bucketCount = Math.max(1, spanDays / bucketDays);
    const perBucketRevenue = baseline.totalRevenue / bucketCount;

    return {
        spanDays,
        bucketLabel,
        perBucketRevenue,
        totalRevenue: baseline.totalRevenue,
        totalEmails: baseline.totalEmails,
    };
}

function formatReasonList(reasons: string[]): string {
    if (!reasons.length) return "";
    if (reasons.length === 1) return reasons[0];
    if (reasons.length === 2) return `${reasons[0]} and ${reasons[1]}`;
    return `${reasons.slice(0, -1).join(", ")}, and ${reasons[reasons.length - 1]}`;
}

function evaluateCampaign(campaign: ProcessedCampaign, baseline: BaselineMetrics): CampaignDiagnostic {
    const emails = campaign.emailsSent || 0;
    const revenue = campaign.revenue || 0;
    const opens = campaign.uniqueOpens || 0;
    const clicks = campaign.uniqueClicks || 0;

    const rpe = safeDivide(revenue, emails);
    const openRate = safeDivide(opens, emails);
    const clickRate = safeDivide(clicks, emails);
    const ctor = opens > 0 ? safeDivide(clicks, opens) : 0;
    const spamRate = safeDivide(campaign.spamComplaintsCount || 0, emails);
    const unsubRate = safeDivide(campaign.unsubscribesCount || 0, emails);
    const bounceRate = safeDivide(campaign.bouncesCount || 0, emails);

    const openDelta = baseline.openRate > 0 ? ((openRate - baseline.openRate) / baseline.openRate) * 100 : 0;
    const clickDelta = baseline.clickRate > 0 ? ((clickRate - baseline.clickRate) / baseline.clickRate) * 100 : 0;
    const ctorDelta = baseline.ctor > 0 ? ((ctor - baseline.ctor) / baseline.ctor) * 100 : 0;

    const engagementReasons: string[] = [];
    if (openDelta <= OPEN_DROP_THRESHOLD) {
        engagementReasons.push(`open rates fell ${formatPercentValue(Math.abs(openDelta))}`);
    }
    if (clickDelta <= CLICK_DROP_THRESHOLD) {
        engagementReasons.push(`click rates fell ${formatPercentValue(Math.abs(clickDelta))}`);
    }
    if (ctor < CTOR_THRESHOLD) {
        engagementReasons.push(`CTOR dipped to ${formatPercent(ctor)}`);
    }

    const deliverabilityReasons: string[] = [];
    if (spamRate >= SPAM_CRITICAL) {
        deliverabilityReasons.push(`spam complaints hit ${formatPercent(spamRate)} (critical)`);
    } else if (spamRate >= SPAM_FLAG) {
        deliverabilityReasons.push(`spam complaints hit ${formatPercent(spamRate)}`);
    }
    if (bounceRate >= BOUNCE_CRITICAL) {
        deliverabilityReasons.push(`bounces hit ${formatPercent(bounceRate)} (critical)`);
    } else if (bounceRate >= BOUNCE_FLAG) {
        deliverabilityReasons.push(`bounces hit ${formatPercent(bounceRate)}`);
    }
    if (unsubRate >= UNSUB_FLAG) {
        deliverabilityReasons.push(`unsubscribes hit ${formatPercent(unsubRate)}`);
    }

    const lowEfficiency = baseline.rpe > 0 && rpe <= baseline.rpe * LOW_REVENUE_MULTIPLIER;

    return {
        id: String(campaign.id ?? ""),
        emails,
        revenue,
        rpe,
        openRate,
        clickRate,
        ctor,
        spamRate,
        unsubRate,
        bounceRate,
        openDeltaPercent: openDelta,
        clickDeltaPercent: clickDelta,
        ctorDeltaPercent: ctorDelta,
        lowEfficiency,
        engagementReasons,
        deliverabilityReasons,
        engagementFlag: engagementReasons.length > 0,
        deliverabilityFlag: deliverabilityReasons.length > 0,
        deliverabilityCritical: deliverabilityReasons.some(reason => reason.includes("critical")),
    };
}

function buildLengthKey(bin: LengthBinStat): string {
    const min = bin.range[0];
    const max = bin.range[1];
    return `${min}-${max ?? "plus"}`;
}

function findHighlightFromLength(
    bins: LengthBinStat[],
    baselineRpe: number,
    totalEmails: number,
    totalRevenue: number,
): HighlightDetail | null {
    const minEmails = Math.max(totalEmails * MIN_EMAILS_FOR_HIGHLIGHT_SHARE, MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE);
    const candidates = bins.filter(bin => bin.totalEmails >= minEmails && bin.totalRevenue > 0);
    if (!candidates.length) return null;

    const best = candidates.slice().sort((a, b) => (b.liftVsBaseline ?? 0) - (a.liftVsBaseline ?? 0))[0];
    const rpeValue = best.value || 0;
    const rpeLift = baselineRpe > 0 ? ((rpeValue - baselineRpe) / baselineRpe) * 100 : 0;
    const revenueShare = totalRevenue > 0 ? best.totalRevenue / totalRevenue : 0;

    return {
        scope: "length",
        key: buildLengthKey(best),
        label: best.label,
        rpeLift,
        rpeValue,
        totalEmails: best.totalEmails,
        totalRevenue: best.totalRevenue,
        revenueShare,
    };
}

function findHighlightFromCategories(
    categories: FeatureStat[],
    baselineRpe: number,
    totalEmails: number,
    totalRevenue: number,
): HighlightDetail | null {
    const minEmails = Math.max(totalEmails * MIN_EMAILS_FOR_HIGHLIGHT_SHARE, MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE);
    const candidates = categories.filter(cat => cat.totalEmails >= minEmails && cat.totalRevenue > 0);
    if (!candidates.length) return null;

    const best = candidates.slice().sort((a, b) => (b.liftVsBaseline ?? 0) - (a.liftVsBaseline ?? 0))[0];
    const rpeValue = best.value || 0;
    const rpeLift = baselineRpe > 0 ? ((rpeValue - baselineRpe) / baselineRpe) * 100 : 0;
    const revenueShare = totalRevenue > 0 ? best.totalRevenue / totalRevenue : 0;

    return {
        scope: "category",
        key: best.key,
        label: best.label,
        rpeLift,
        rpeValue,
        totalEmails: best.totalEmails,
        totalRevenue: best.totalRevenue,
        revenueShare,
    };
}

function enrichHighlightWithEngagement(
    highlight: HighlightDetail | null,
    analysisOpen: { categories: FeatureStat[]; lengthBins: LengthBinStat[]; baseline: { value: number } },
    analysisClick: { categories: FeatureStat[]; lengthBins: LengthBinStat[]; baseline: { value: number } },
): HighlightDetail | null {
    if (!highlight) return null;

    const baselineOpen = analysisOpen.baseline.value || 0;
    const baselineClick = analysisClick.baseline.value || 0;
    let openFeature: FeatureStat | LengthBinStat | undefined;
    let clickFeature: FeatureStat | LengthBinStat | undefined;

    if (highlight.scope === "category") {
        openFeature = analysisOpen.categories.find(cat => cat.key === highlight.key);
        clickFeature = analysisClick.categories.find(cat => cat.key === highlight.key);
    } else {
        openFeature = analysisOpen.lengthBins.find(bin => buildLengthKey(bin) === highlight.key);
        clickFeature = analysisClick.lengthBins.find(bin => buildLengthKey(bin) === highlight.key);
    }

    const enriched: HighlightDetail = { ...highlight };

    if (openFeature) {
        const openLift = baselineOpen > 0 ? ((openFeature.value - baselineOpen) / baselineOpen) * 100 : 0;
        enriched.openRateChange = openLift;
        enriched.openRateValue = openFeature.value;
    }

    if (clickFeature) {
        const clickLift = baselineClick > 0 ? ((clickFeature.value - baselineClick) / baselineClick) * 100 : 0;
        enriched.clickRateChange = clickLift;
        enriched.clickRateValue = clickFeature.value;
    }

    return enriched;
}

function findLaggingHighlight(
    candidates: HighlightDetail[],
): HighlightDetail | null {
    const lagging = candidates
        .filter(item => item.rpeLift <= LAGGING_LIFT_THRESHOLD)
        .sort((a, b) => a.rpeLift - b.rpeLift);
    return lagging[0] ?? null;
}

function selectWinsHighlight(
    categoryHighlight: HighlightDetail | null,
    lengthHighlight: HighlightDetail | null,
): HighlightDetail | null {
    const candidates = [categoryHighlight, lengthHighlight].filter((item): item is HighlightDetail => Boolean(item));
    if (!candidates.length) return null;

    const winsCandidates = candidates.filter(h => {
        const lift = h.rpeLift;
        const share = h.revenueShare;
        return lift >= (WINS_STRICT_MULTIPLIER - 1) * 100 || (lift >= (WINS_FLEX_MULTIPLIER - 1) * 100 && share >= WINS_SHARE_THRESHOLD);
    });

    if (winsCandidates.length) {
        return winsCandidates.sort((a, b) => b.rpeLift - a.rpeLift)[0];
    }

    return null;
}

function findGeneralHighlight(
    categoryHighlight: HighlightDetail | null,
    lengthHighlight: HighlightDetail | null,
): HighlightDetail | null {
    const candidates = [categoryHighlight, lengthHighlight].filter((item): item is HighlightDetail => Boolean(item));
    if (!candidates.length) return null;
    return candidates.sort((a, b) => b.rpeLift - a.rpeLift)[0];
}

function appendWatchlist(sentences: string[], watchlist: string[]) {
    if (!watchlist.length) return;
    const formatted = watchlist
        .map(item => (item.endsWith('.') ? item : `${item}.`))
        .join(' ');
    sentences.push(`Keep an eye on ${formatted}`);
}

function detectRevenueSignals(
    diagnostics: CampaignDiagnostic[],
    baseline: BaselineMetrics,
): SignalSummary {
    const lagging = diagnostics.filter(d => d.lowEfficiency && (d.engagementFlag || d.deliverabilityFlag));
    if (!lagging.length) return { watchReasons: [] };

    const affectedEmails = sum(lagging, d => d.emails);
    if (affectedEmails < MIN_EMAILS_FOR_WARNING) return { watchReasons: [] };

    const volumeShare = safeDivide(affectedEmails, baseline.totalEmails);

    const affectedRevenue = sum(lagging, d => d.revenue);
    const affectedRpe = safeDivide(affectedRevenue, affectedEmails);
    const dropPercent = baseline.rpe > 0 ? ((affectedRpe - baseline.rpe) / baseline.rpe) * 100 : 0;
    const revenueShare = safeDivide(affectedRevenue, baseline.totalRevenue);

    const reasonWeights = new Map<string, number>();
    for (const diag of lagging) {
        for (const reason of [...diag.engagementReasons, ...diag.deliverabilityReasons]) {
            reasonWeights.set(reason, (reasonWeights.get(reason) || 0) + diag.emails);
        }
    }

    const reasons = Array.from(reasonWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([reason]) => reason);

    if (volumeShare >= LOW_REVENUE_VOLUME_THRESHOLD && revenueShare >= LOW_REVENUE_REVENUE_THRESHOLD) {
        return {
            warning: {
                type: "revenue",
                volumeShare,
                affectedEmails,
                affectedRevenue,
                affectedRpe,
                baselineRpe: baseline.rpe,
                dropPercent,
                severity: "flag",
                reasons,
            },
            watchReasons: [],
        };
    }

    if (volumeShare >= REVENUE_WATCH_VOLUME_THRESHOLD) {
        const sentence = `${approxPercent(volumeShare)} of sends trailed baseline by ${formatPercentValue(Math.abs(dropPercent))}`;
        return { watchReasons: [sentence] };
    }

    return { watchReasons: [] };
}

function detectDeliverabilitySignals(
    diagnostics: CampaignDiagnostic[],
    baseline: BaselineMetrics,
): SignalSummary {
    const flagged = diagnostics.filter(d => d.deliverabilityFlag);
    if (!flagged.length) return { watchReasons: [] };

    const affectedEmails = sum(flagged, d => d.emails);
    if (affectedEmails < MIN_EMAILS_FOR_WARNING) return { watchReasons: [] };

    const volumeShare = safeDivide(affectedEmails, baseline.totalEmails);

    let dominantMetric: { label: "spam" | "unsubscribe" | "bounce"; rate: number; baseline: number } | null = null;
    for (const diag of flagged) {
        if (diag.spamRate >= SPAM_FLAG && (!dominantMetric || diag.spamRate > dominantMetric.rate)) {
            dominantMetric = { label: "spam", rate: diag.spamRate, baseline: baseline.spamRate };
        }
        if (diag.unsubRate >= UNSUB_FLAG && (!dominantMetric || diag.unsubRate > dominantMetric.rate)) {
            dominantMetric = { label: "unsubscribe", rate: diag.unsubRate, baseline: baseline.unsubRate };
        }
        if (diag.bounceRate >= BOUNCE_FLAG && (!dominantMetric || diag.bounceRate > dominantMetric.rate)) {
            dominantMetric = { label: "bounce", rate: diag.bounceRate, baseline: baseline.bounceRate };
        }
    }

    if (!dominantMetric) return { watchReasons: [] };

    const severity = flagged.some(d => d.deliverabilityCritical || d.spamRate >= SPAM_CRITICAL || d.bounceRate >= BOUNCE_CRITICAL)
        ? "critical"
        : "flag";

    const affectedRevenue = sum(flagged, d => d.revenue);
    const revenueShare = safeDivide(affectedRevenue, baseline.totalRevenue);

    const reasonWeights = new Map<string, number>();
    for (const diag of flagged) {
        for (const reason of diag.deliverabilityReasons) {
            reasonWeights.set(reason, (reasonWeights.get(reason) || 0) + diag.emails);
        }
    }
    const reasons = Array.from(reasonWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([reason]) => reason);

    if (severity === "critical" || (volumeShare >= LOW_REVENUE_VOLUME_THRESHOLD && revenueShare >= LOW_REVENUE_REVENUE_THRESHOLD)) {
        return {
            warning: {
                type: "deliverability",
                volumeShare,
                affectedEmails,
                affectedRevenue,
                baselineRpe: baseline.rpe,
                severity,
                metricLabel: dominantMetric.label,
                metricRate: dominantMetric.rate,
                baselineMetric: dominantMetric.baseline,
                reasons,
            },
            watchReasons: [],
        };
    }

    const sentence = `${capitalize(dominantMetric.label)} briefly reached ${formatPercent(dominantMetric.rate)} on ${approxPercent(volumeShare)} of sends`;
    return { watchReasons: [sentence] };
}

function buildRevenueWarningCopy(
    _rangeLabel: string,
    baseline: BaselineMetrics,
    context: PeriodContext | null,
    detail: WarningDetail,
    laggingHighlight: HighlightDetail | null,
    positiveHighlight: HighlightDetail | null,
): CampaignSubjectLineNoteCopy {
    const shareText = approxPercent(detail.volumeShare);
    const dropPercent = detail.dropPercent != null ? Math.abs(detail.dropPercent) : 0;
    const dropText = formatPercentValue(dropPercent);
    const baselineText = formatCurrency(baseline.rpe);
    const affectedRpeText = formatCurrency(detail.affectedRpe || 0);
    const summary = `About ${shareText} of campaigns this period came in ${dropText} under the period baseline (${baselineText} per email).`;

    const sentences: string[] = [];
    sentences.push(`Those sends averaged ${affectedRpeText} per email across ${detail.affectedEmails.toLocaleString()} recipients.`);

    if (context) {
        sentences.push(`Across the window you still generated roughly ${formatCurrency(context.perBucketRevenue)} per ${context.bucketLabel}.`);
    }

    if (detail.reasons.length) {
        sentences.push(`Main issues: ${formatReasonList(detail.reasons)}.`);
    }

    if (laggingHighlight) {
        sentences.push(`${laggingHighlight.label} subject lines leaned ${formatPercentValue(Math.abs(laggingHighlight.rpeLift))} below baseline on ${laggingHighlight.totalEmails.toLocaleString()} sends. Refresh that story before you repeat it.`);
    }

    if (positiveHighlight && positiveHighlight !== laggingHighlight) {
        sentences.push(`${positiveHighlight.label} still held ${formatPercentValue(positiveHighlight.rpeLift)} above baseline on ${positiveHighlight.totalEmails.toLocaleString()} sends. Reuse that playbook while you tune the weak spots.`);
    }

    const headlineReason = detail.reasons[0] ? capitalize(detail.reasons[0]) : "Revenue efficiency slipped";
    // Narrative headline (no prefixed label, no punctuation like ':' ';' or '—')
    const narrativeHeadline = `${approxPercent(detail.volumeShare)} of sends were ${dropText} below baseline Rev per Email (${baselineText})`;
    return {
        headline: narrativeHeadline.endsWith('.') ? narrativeHeadline : narrativeHeadline + '.',
        summary,
        paragraph: sentences.join(" "),
    };
}

function buildDeliverabilityWarningCopy(
    _rangeLabel: string,
    context: PeriodContext | null,
    detail: WarningDetail,
    positiveHighlight: HighlightDetail | null,
): CampaignSubjectLineNoteCopy {
    const metricName = detail.metricLabel ? detail.metricLabel.replace(/^./, ch => ch.toUpperCase()) : "Deliverability";
    const summary = `${metricName} issues touched ${approxPercent(detail.volumeShare)} of sends this period, peaking at ${formatPercent(detail.metricRate || 0)}.`;

    const sentences: string[] = [];
    if (detail.baselineMetric != null) {
        sentences.push(`This metric normally sits near ${formatPercent(detail.baselineMetric)}.`);
    }

    if (context) {
        sentences.push(`Even with the slowdown, campaigns generated roughly ${formatCurrency(context.perBucketRevenue)} per ${context.bucketLabel}.`);
    }

    if (detail.reasons.length) {
        sentences.push(`Key drivers: ${formatReasonList(detail.reasons)}.`);
    }

    sentences.push(`Pause or narrow sends until complaints drop. These sends hit ${detail.affectedEmails.toLocaleString()} inboxes.`);

    if (positiveHighlight) {
        sentences.push(`When volumes resume, lean on ${positiveHighlight.label.toLowerCase()} subject lines; they stayed above baseline through the period.`);
    }

    // Narrative headline (descriptive sentence, no prefixed label)
    const narrativeHeadline = `${metricName} reached ${formatPercent(detail.metricRate || 0)} impacting ${approxPercent(detail.volumeShare)} of sends this period`;
    return {
        headline: narrativeHeadline.endsWith('.') ? narrativeHeadline : narrativeHeadline + '.',
        summary,
        paragraph: sentences.join(" "),
    };
}

function describeHighlightSentence(highlight: HighlightDetail, baselineRpe: number): string {
    const liftText = highlight.rpeLift >= 0
        ? `${formatPercentValue(highlight.rpeLift)} more revenue per email`
        : `${formatPercentValue(Math.abs(highlight.rpeLift))} less revenue per email`;
    const intro = `${highlight.label} subject lines delivered ${liftText} on ${highlight.totalEmails.toLocaleString()} sends`;
    const tail: string[] = [];
    if (highlight.openRateValue != null && highlight.openRateChange != null) {
        tail.push(`opens at ${highlight.openRateValue.toFixed(1)}% (${formatPercentValue(highlight.openRateChange)} vs baseline)`);
    }
    const detail = tail.length ? `, with ${tail.join(" ")}` : ""; // single metric now
    const baselineText = formatCurrency(baselineRpe);
    return `${intro}${detail}. Baseline sits at ${baselineText} per email.`;
}

function buildWinsCopy(
    _rangeLabel: string,
    baseline: BaselineMetrics,
    context: PeriodContext | null,
    highlight: HighlightDetail,
    laggingHighlight: HighlightDetail | null,
    watchlist: string[],
): CampaignSubjectLineNoteCopy {
    const summary = `${highlight.label} lifted revenue per email by ${formatPercentValue(highlight.rpeLift)} on ${highlight.totalEmails.toLocaleString()} sends (${approxPercent(highlight.revenueShare)} of period revenue).`;

    const sentences: string[] = [];
    if (context) {
        sentences.push(`Campaigns across this window averaged about ${formatCurrency(context.perBucketRevenue)} per ${context.bucketLabel}.`);
    }

    sentences.push(describeHighlightSentence(highlight, baseline.rpe));

    if (laggingHighlight) {
        sentences.push(`${laggingHighlight.label} trailed by ${formatPercentValue(Math.abs(laggingHighlight.rpeLift))} on ${laggingHighlight.totalEmails.toLocaleString()} sends. Refine that story while you scale the winners.`);
    }

    if (highlight.rpeLift >= (IMPRESSIVE_RPE_MULTIPLIER - 1) * 100) {
        sentences.push("Double-check the segments and keep the same value prop when you broaden the next send.");
    } else {
        sentences.push("Carry these learnings into the next broad test with similar positioning.");
    }

    appendWatchlist(sentences, watchlist);

    // Narrative headline for a positive highlight
    const headlineSentence = `${highlight.label} subject lines lifted Rev per Email ${formatPercentValue(highlight.rpeLift)} on ${highlight.totalEmails.toLocaleString()} sends (${approxPercent(highlight.revenueShare)} of revenue).`;
    return {
        headline: headlineSentence,
        summary,
        paragraph: sentences.join(" "),
    };
}

function buildGeneralCopy(
    _rangeLabel: string,
    baseline: BaselineMetrics,
    context: PeriodContext | null,
    topRevenueShare: number | undefined,
    topRevenueCount: number | undefined,
    positiveHighlight: HighlightDetail | null,
    laggingHighlight: HighlightDetail | null,
    watchlist: string[],
): CampaignSubjectLineNoteCopy {
    const baselineText = formatCurrency(baseline.rpe);
    const shareText = topRevenueShare != null && topRevenueCount != null
        ? `${formatPercent(topRevenueShare / 100)} of revenue came from your top ${topRevenueCount === 1 ? "send" : `${topRevenueCount} sends`}`
        : undefined;

    const summaryParts = [shareText, `baseline revenue per email is ${baselineText}`].filter(Boolean);
    const summary = summaryParts.join("; ") || `Campaigns in this period averaged ${baselineText} per email.`;

    const sentences: string[] = [];
    if (context) {
        sentences.push(`Across the window you generated roughly ${formatCurrency(context.perBucketRevenue)} per ${context.bucketLabel}.`);
    }

    if (positiveHighlight) {
        sentences.push(describeHighlightSentence(positiveHighlight, baseline.rpe));
    }

    if (laggingHighlight) {
        sentences.push(`${laggingHighlight.label} subject lines lagged baseline by ${formatPercentValue(Math.abs(laggingHighlight.rpeLift))} on ${laggingHighlight.totalEmails.toLocaleString()} sends. Refresh the offer or framing before running them again.`);
    } else {
        sentences.push("Mix your top-performing themes with new tests so more of the list sees high-revenue sends.");
    }

    appendWatchlist(sentences, watchlist);

    let narrativeHeadline: string;
    if (positiveHighlight) {
        narrativeHeadline = `${positiveHighlight.label} subject lines delivered ${formatPercentValue(positiveHighlight.rpeLift)} Rev per Email lift on ${positiveHighlight.totalEmails.toLocaleString()} sends.`;
    } else if (shareText) {
        narrativeHeadline = `${shareText} with baseline Rev per Email ${baselineText}`;
    } else {
        narrativeHeadline = `Campaigns averaged ${baselineText} Rev per Email this period`;
    }
    if (!narrativeHeadline.endsWith('.')) narrativeHeadline += '.';
    return {
        headline: narrativeHeadline,
        summary,
        paragraph: sentences.join(" "),
    };
}

function buildInsufficientCopy(_rangeLabel: string): CampaignSubjectLineNoteCopy {
    return {
        headline: "More data needed to summarize subject line Rev per Email this period.",
        summary: "Not enough campaigns in this window to trust subject line revenue patterns.",
        paragraph: "Run a few broader sends or A/B tests, then revisit these insights once volume passes 5,000 recipients.",
    };
}

interface PreviousPeriodStats {
    totalRevenue: number;
    totalEmails: number;
    rpe: number;
    openRate: number;
    spamRate: number;
    unsubRate: number;
    bounceRate: number;
}

function computePreviousPeriodStats(previousCampaigns?: ProcessedCampaign[] | null): PreviousPeriodStats | null {
    if (!previousCampaigns || !previousCampaigns.length) return null;
    const prevBaseline = collectBaseline(previousCampaigns);
    return {
        totalRevenue: prevBaseline.totalRevenue,
        totalEmails: prevBaseline.totalEmails,
        rpe: prevBaseline.rpe,
        openRate: prevBaseline.openRate,
        spamRate: prevBaseline.spamRate,
        unsubRate: prevBaseline.unsubRate,
        bounceRate: prevBaseline.bounceRate,
    };
}

function formatDeltaThousands(current: number, previous: number): { amountLabel: string; direction: "more" | "less" | "same"; rawDiff: number } {
    const diff = current - previous;
    if (Math.abs(diff) < 1) {
        return { amountLabel: "$0", direction: "same", rawDiff: 0 };
    }
    const sign = diff >= 0 ? 1 : -1;
    const abs = Math.abs(diff);
    // Represent in thousands with k suffix; use one decimal only if >=100k and decimal adds meaning
    let thousands = abs / 1000;
    let label: string;
    if (thousands >= 100) {
        label = `$${Math.round(thousands)}k`;
    } else if (thousands >= 10) {
        label = `$${thousands.toFixed(0)}k`;
    } else {
        label = `$${thousands.toFixed(1)}k`;
    }
    return { amountLabel: label, direction: sign >= 0 ? (diff === 0 ? "same" : "more") : "less", rawDiff: diff };
}

function buildDeliverabilityStatusSummary(baseline: BaselineMetrics, previous: PreviousPeriodStats | null): string {
    // Thresholds from user request
    const open = baseline.openRate; // fraction
    const spam = baseline.spamRate;
    const unsub = baseline.unsubRate;
    const bounce = baseline.bounceRate;
    const statuses: string[] = [];

    function pct(v: number) { return formatPercent(v); }

    // Engagement (open rate)
    if (open < 0.30) {
        statuses.push(`Critical open rate (${pct(open)})`);
    } else if (open < 0.40) {
        statuses.push(`Low open rate (${pct(open)})`);
    }

    function pushMetric(label: string, rate: number, flag: number, critical: number) {
        if (rate >= critical) {
            statuses.push(`Critical ${label.toLowerCase()} (${pct(rate)})`);
        } else if (rate >= flag) {
            statuses.push(`Elevated ${label.toLowerCase()} (${pct(rate)})`);
        }
    }
    pushMetric("Spam", spam, 0.001, 0.003);
    pushMetric("Unsubscribes", unsub, 0.01, 0.02);
    pushMetric("Bounces", bounce, 0.02, 0.05);

    if (!statuses.length) return "No deliverability concerns.";
    if (statuses.length === 1) return statuses[0] + ".";
    return statuses.slice(0, -1).join(", ") + " and " + statuses[statuses.length - 1] + ".";
}

function buildRevenuePerformanceHeadline(currentRevenue: number, previous: PreviousPeriodStats | null): string {
    if (!previous) {
        return `Campaigns produced ${formatCurrency(currentRevenue)} in revenue this period.`;
    }
    if (previous.totalRevenue <= 0) {
        return `Campaigns generated ${formatCurrency(currentRevenue)} in revenue (no prior period revenue).`;
    }
    const { amountLabel, direction } = formatDeltaThousands(currentRevenue, previous.totalRevenue);
    if (direction === "same") return "Campaign revenue was roughly unchanged versus the previous period.";
    return `Campaigns generated ${amountLabel} ${direction} revenue this period than the previous one.`;
}

function selectRevenueWinnersAndLaggards(campaigns: ProcessedCampaign[]): { winners: ProcessedCampaign[]; laggards: ProcessedCampaign[]; dominantCategory?: string; underCategory?: string } {
    if (campaigns.length < 5) return { winners: [], laggards: [] };
    const totalRevenue = sum(campaigns, c => c.revenue || 0) || 0;
    if (!totalRevenue) return { winners: [], laggards: [] };
    const avg = totalRevenue / campaigns.length;
    const sorted = campaigns.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    const winners: ProcessedCampaign[] = [];
    let cumulative = 0;
    for (const c of sorted) {
        const rev = c.revenue || 0;
        if (rev >= 1.25 * avg) {
            winners.push(c);
            cumulative += rev;
        }
        if (cumulative / totalRevenue >= 0.30 || winners.length >= 3) break;
    }
    const reverse = sorted.slice().reverse();
    const laggards: ProcessedCampaign[] = [];
    for (const c of reverse) {
        const rev = c.revenue || 0;
        const emails = c.emailsSent || 0;
        if (rev <= 0.4 * avg && emails >= ((sorted[Math.floor(sorted.length / 2)].emailsSent) || 0) * 0.5) {
            laggards.push(c);
        }
        if (laggards.length >= 3) break;
    }
    // Simple category detection based on subject keywords (reuse existing highlight categories is complex; keep basic heuristic here without altering existing structures)
    function extractCategory(subject?: string | null): string | null {
        if (!subject) return null;
        const s = subject.toLowerCase();
        if (/(last chance|final|ending)/.test(s)) return "Urgency";
        if (/(sale|deal|discount|% off)/.test(s)) return "Offer";
        if (/(new|just launched|introducing)/.test(s)) return "Newness";
        if (/(low stock|running out|almost gone)/.test(s)) return "Scarcity";
        return null;
    }
    function dominant(items: ProcessedCampaign[]): string | undefined {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const c of items) {
            const cat = extractCategory(c.subject) || extractCategory(c.campaignName);
            if (cat) {
                counts[cat] = (counts[cat] || 0) + (c.revenue || 0);
                total += c.revenue || 0;
            }
        }
        let best: string | undefined;
        let bestShare = 0;
        for (const k of Object.keys(counts)) {
            const share = counts[k] / (total || 1);
            if (share > bestShare) { bestShare = share; best = k; }
        }
        if (best && bestShare >= 0.60) return best;
        return undefined;
    }
    const dominantCategory = dominant(winners);
    const underCategory = dominant(laggards);
    return { winners, laggards, dominantCategory, underCategory };
}

export function buildCampaignSubjectLineInsights(
    campaigns: ProcessedCampaign[],
    rangeLabel: string,
    options?: { maxTopCount?: number; previousCampaigns?: ProcessedCampaign[] },
): CampaignSubjectLineInsight | null {
    const totalCampaigns = campaigns.length;
    const baseline = collectBaseline(campaigns);
    const previousStats = computePreviousPeriodStats(options?.previousCampaigns);

    if (totalCampaigns < MIN_CAMPAIGNS_REQUIRED || baseline.totalEmails < MIN_EMAILS_REQUIRED) {
        return {
            template: "insufficient",
            totalCampaigns,
            totalEmails: baseline.totalEmails,
            note: buildInsufficientCopy(rangeLabel),
        };
    }

    const periodContext = computePeriodContext(campaigns, baseline);

    const analysisRpe = computeSubjectAnalysis(campaigns, "revenuePerEmail");
    const analysisOpen = computeSubjectAnalysis(campaigns, "openRate");
    const analysisClick = computeSubjectAnalysis(campaigns, "clickRate");

    const lengthHighlight = enrichHighlightWithEngagement(
        findHighlightFromLength(analysisRpe.lengthBins, baseline.rpe, baseline.totalEmails, baseline.totalRevenue),
        analysisOpen,
        analysisClick,
    );
    const categoryHighlight = enrichHighlightWithEngagement(
        findHighlightFromCategories(analysisRpe.categories, baseline.rpe, baseline.totalEmails, baseline.totalRevenue),
        analysisOpen,
        analysisClick,
    );

    const positiveWinsHighlight = selectWinsHighlight(categoryHighlight, lengthHighlight);
    const generalHighlight = findGeneralHighlight(categoryHighlight, lengthHighlight);

    const laggingLength = findLaggingHighlight(
        [lengthHighlight].filter((item): item is HighlightDetail => Boolean(item))
    );
    const laggingCategory = findLaggingHighlight(
        [categoryHighlight].filter((item): item is HighlightDetail => Boolean(item))
    );
    const laggingHighlight = [laggingCategory, laggingLength]
        .filter((item): item is HighlightDetail => Boolean(item))
        .sort((a, b) => a.rpeLift - b.rpeLift)[0] || null;

    const diagnostics = campaigns.map(c => evaluateCampaign(c, baseline));
    const revenueSignals = detectRevenueSignals(diagnostics, baseline);
    const deliverabilitySignals = detectDeliverabilitySignals(diagnostics, baseline);
    const watchlist = [...deliverabilitySignals.watchReasons, ...revenueSignals.watchReasons];

    const topN = Math.min(options?.maxTopCount ?? 3, totalCampaigns);
    const sortedByRevenue = campaigns.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    const topRevenueTotal = sum(sortedByRevenue.slice(0, topN), c => c.revenue || 0);
    const topRevenueShare = baseline.totalRevenue > 0 ? (topRevenueTotal / baseline.totalRevenue) * 100 : undefined;

    const positiveHighlight = positiveWinsHighlight ?? generalHighlight;

    // Build unified headline & summary additions
    const headline = buildRevenuePerformanceHeadline(baseline.totalRevenue, previousStats);
    const deliverabilitySummary = buildDeliverabilityStatusSummary(baseline, previousStats);

    // Winners / laggards lists intentionally removed per updated guidance (focus shift to concise narrative).

    // Reuse existing template logic for paragraph assembly but override headline & summary after
    let baseInsight: CampaignSubjectLineInsight;
    if (deliverabilitySignals.warning) {
        const note = buildDeliverabilityWarningCopy(rangeLabel, periodContext, deliverabilitySignals.warning, positiveHighlight);
        baseInsight = {
            template: "warning",
            totalCampaigns,
            totalEmails: baseline.totalEmails,
            totalRevenue: baseline.totalRevenue,
            topRevenueShare,
            topRevenueCount: topN,
            note,
        };
    } else if (revenueSignals.warning) {
        const note = buildRevenueWarningCopy(rangeLabel, baseline, periodContext, revenueSignals.warning, laggingHighlight, positiveHighlight);
        baseInsight = {
            template: "warning",
            totalCampaigns,
            totalEmails: baseline.totalEmails,
            totalRevenue: baseline.totalRevenue,
            topRevenueShare,
            topRevenueCount: topN,
            note,
        };
    } else if (positiveWinsHighlight) {
        const note = buildWinsCopy(rangeLabel, baseline, periodContext, positiveWinsHighlight, laggingHighlight, watchlist);
        baseInsight = {
            template: "wins",
            totalCampaigns,
            totalEmails: baseline.totalEmails,
            totalRevenue: baseline.totalRevenue,
            topRevenueShare,
            topRevenueCount: topN,
            bestLengthRange: positiveWinsHighlight.scope === "length" ? positiveWinsHighlight.label : undefined,
            bestLengthDelta: positiveWinsHighlight.scope === "length" ? positiveWinsHighlight.rpeLift : undefined,
            strongCategory: positiveWinsHighlight.scope === "category" ? positiveWinsHighlight.label : undefined,
            strongCategoryDelta: positiveWinsHighlight.scope === "category" ? positiveWinsHighlight.rpeLift : undefined,
            note,
        };
    } else {
        const note = buildGeneralCopy(rangeLabel, baseline, periodContext, topRevenueShare, topN, positiveHighlight, laggingHighlight, watchlist);
        baseInsight = {
            template: "general",
            totalCampaigns,
            totalEmails: baseline.totalEmails,
            totalRevenue: baseline.totalRevenue,
            topRevenueShare,
            topRevenueCount: topN,
            bestLengthRange: positiveHighlight?.scope === "length" ? positiveHighlight.label : undefined,
            bestLengthDelta: positiveHighlight?.scope === "length" ? positiveHighlight.rpeLift : undefined,
            strongCategory: positiveHighlight?.scope === "category" ? positiveHighlight.label : undefined,
            strongCategoryDelta: positiveHighlight?.scope === "category" ? positiveHighlight.rpeLift : undefined,
            weakCategory: laggingHighlight?.scope === "category" ? laggingHighlight.label : undefined,
            weakCategoryDelta: laggingHighlight?.scope === "category" ? laggingHighlight.rpeLift : undefined,
            weakLengthRange: laggingHighlight?.scope === "length" ? laggingHighlight.label : undefined,
            weakLengthDelta: laggingHighlight?.scope === "length" ? laggingHighlight.rpeLift : undefined,
            note,
        };
    }

    // Override headline & summary, prepend winners/laggards/theme sentences to paragraph (without removing existing content)
    baseInsight.note.headline = headline;
    const rpeChange = previousStats && previousStats.rpe > 0 ? ((baseline.rpe - previousStats.rpe) / previousStats.rpe) * 100 : 0;
    const rpeValue = formatCurrency(baseline.rpe);
    const rpePhrase = `Average revenue per email in this period was ${rpeValue}.`;
    baseInsight.note.summary = `${rpePhrase} ${deliverabilitySummary}`.trim();
    return baseInsight;
}
