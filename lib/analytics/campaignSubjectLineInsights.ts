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
    bestLengthRange?: string;
    bestLengthDelta?: number;
    weakLengthRange?: string;
    weakLengthDelta?: number;
    strongCategory?: string;
    strongCategoryDelta?: number;
    weakCategory?: string;
    weakCategoryDelta?: number;
    alternativeCategory?: string;
    alternativeCategoryDelta?: number;
    totalCampaigns: number;
    note: CampaignSubjectLineNoteCopy;
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
}

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

const MIN_CAMPAIGNS_REQUIRED = 5;
const MIN_EMAILS_REQUIRED = 5000;
const MIN_EMAILS_FOR_HIGHLIGHT_SHARE = 0.05;
const MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE = 10000;
const MIN_EMAILS_FOR_WARNING = 10000;
const LOW_REVENUE_MULTIPLIER = 0.7; // 30% below baseline RPE
const LOW_REVENUE_VOLUME_THRESHOLD = 0.2; // 20% of sends
const DELIVERABILITY_MULTIPLIER = 1.4; // 40% higher than baseline
const DELIVERABILITY_SPAM_ABSOLUTE = 0.005; // 0.5%
const DELIVERABILITY_UNSUB_ABSOLUTE = 0.015; // 1.5%
const DELIVERABILITY_BOUNCE_ABSOLUTE = 0.04; // 4%
const WINS_STRICT_MULTIPLIER = 2.0; // 2x baseline RPE
const WINS_FLEX_MULTIPLIER = 1.5; // 1.5x baseline when share >= threshold
const WINS_SHARE_THRESHOLD = 0.15; // 15% of revenue
const IMPRESSIVE_RPE_MULTIPLIER = 2.0;

const currencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});

function formatPercent(value: number): string {
    return percentFormatter.format(value);
}

function formatPercentChange(deltaPercent: number | undefined): string {
    if (deltaPercent == null || Number.isNaN(deltaPercent)) return "0%";
    const sign = deltaPercent >= 0 ? "+" : "";
    const abs = Math.abs(deltaPercent);
    const formatted = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(1);
    return `${sign}${formatted}%`;
}

function formatRate(rate: number): string {
    return formatPercent(rate);
}

function formatCurrency(value: number): string {
    return currencyFormatter.format(value || 0);
}

function percentShare(value: number): number {
    return Math.round(value * 10) / 10;
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

    return {
        totalRevenue,
        totalEmails,
        totalUnsubs,
        totalSpam,
        totalBounces,
        rpe: safeDivide(totalRevenue, totalEmails),
        unsubRate: safeDivide(totalUnsubs, totalEmails),
        spamRate: safeDivide(totalSpam, totalEmails),
        bounceRate: safeDivide(totalBounces, totalEmails),
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

function detectRevenueWarning(
    campaigns: ProcessedCampaign[],
    baseline: ReturnType<typeof collectBaseline>,
): WarningDetail | null {
    if (!campaigns.length || baseline.totalEmails <= 0 || baseline.rpe <= 0) return null;

    const lowRevenueCampaigns = campaigns.filter(c => {
        const emails = c.emailsSent || 0;
        if (!emails) return false;
        const rpe = safeDivide(c.revenue || 0, emails);
        return rpe <= baseline.rpe * LOW_REVENUE_MULTIPLIER;
    });

    const affectedEmails = sum(lowRevenueCampaigns, c => c.emailsSent || 0);
    const volumeShare = safeDivide(affectedEmails, baseline.totalEmails);
    if (volumeShare < LOW_REVENUE_VOLUME_THRESHOLD || affectedEmails < MIN_EMAILS_FOR_WARNING) return null;

    const affectedRevenue = sum(lowRevenueCampaigns, c => c.revenue || 0);
    const affectedRpe = safeDivide(affectedRevenue, affectedEmails);
    const dropPercent = baseline.rpe > 0 ? ((affectedRpe - baseline.rpe) / baseline.rpe) * 100 : 0;

    return {
        type: "revenue",
        volumeShare,
        affectedEmails,
        affectedRevenue,
        affectedRpe,
        baselineRpe: baseline.rpe,
        dropPercent,
    };
}

function detectDeliverabilityWarning(
    campaigns: ProcessedCampaign[],
    baseline: ReturnType<typeof collectBaseline>,
): WarningDetail | null {
    if (!campaigns.length || baseline.totalEmails <= 0) return null;

    const flagged = campaigns.filter(c => {
        const emails = c.emailsSent || 0;
        if (emails <= 0) return false;
        const spamRate = safeDivide(c.spamComplaintsCount || 0, emails);
        const unsubRate = safeDivide(c.unsubscribesCount || 0, emails);
        const bounceRate = safeDivide(c.bouncesCount || 0, emails);

        const highSpam = spamRate >= Math.max(baseline.spamRate * DELIVERABILITY_MULTIPLIER, baseline.spamRate + 0.002) && spamRate >= DELIVERABILITY_SPAM_ABSOLUTE;
        const highUnsub = unsubRate >= Math.max(baseline.unsubRate * DELIVERABILITY_MULTIPLIER, baseline.unsubRate + 0.005) && unsubRate >= DELIVERABILITY_UNSUB_ABSOLUTE;
        const highBounce = bounceRate >= Math.max(baseline.bounceRate * DELIVERABILITY_MULTIPLIER, baseline.bounceRate + 0.01) && bounceRate >= DELIVERABILITY_BOUNCE_ABSOLUTE;

        return highSpam || highUnsub || highBounce;
    });

    const affectedEmails = sum(flagged, c => c.emailsSent || 0);
    if (affectedEmails < MIN_EMAILS_FOR_WARNING) return null;

    const affectedRevenue = sum(flagged, c => c.revenue || 0);
    const rates = flagged.map(c => ({
        spamRate: safeDivide(c.spamComplaintsCount || 0, c.emailsSent || 1),
        unsubRate: safeDivide(c.unsubscribesCount || 0, c.emailsSent || 1),
        bounceRate: safeDivide(c.bouncesCount || 0, c.emailsSent || 1),
    }));

    const worstSpam = Math.max(...rates.map(r => r.spamRate));
    const worstUnsub = Math.max(...rates.map(r => r.unsubRate));
    const worstBounce = Math.max(...rates.map(r => r.bounceRate));

    let metricLabel: string | undefined;
    let metricRate: number | undefined;
    let baselineMetric: number | undefined;

    if (worstSpam >= Math.max(baseline.spamRate * DELIVERABILITY_MULTIPLIER, DELIVERABILITY_SPAM_ABSOLUTE)) {
        metricLabel = "spam";
        metricRate = worstSpam;
        baselineMetric = baseline.spamRate;
    } else if (worstUnsub >= Math.max(baseline.unsubRate * DELIVERABILITY_MULTIPLIER, DELIVERABILITY_UNSUB_ABSOLUTE)) {
        metricLabel = "unsubscribe";
        metricRate = worstUnsub;
        baselineMetric = baseline.unsubRate;
    } else if (worstBounce >= Math.max(baseline.bounceRate * DELIVERABILITY_MULTIPLIER, DELIVERABILITY_BOUNCE_ABSOLUTE)) {
        metricLabel = "bounce";
        metricRate = worstBounce;
        baselineMetric = baseline.bounceRate;
    }

    if (!metricLabel || metricRate == null) return null;

    return {
        type: "deliverability",
        volumeShare: safeDivide(affectedEmails, baseline.totalEmails),
        affectedEmails,
        affectedRevenue,
        baselineRpe: baseline.rpe,
        metricLabel,
        metricRate,
        baselineMetric,
    };
}

function buildRevenueWarningCopy(rangeLabel: string, detail: WarningDetail): CampaignSubjectLineNoteCopy {
    const volumeSharePercent = formatPercent(detail.volumeShare);
    const dropPercent = detail.dropPercent ? Math.abs(detail.dropPercent) : 0;
    const summary = `Revenue per email was ${formatPercentChange(detail.dropPercent)} on ${volumeSharePercent} of recent sends.`;
    const perEmailGap = detail.baselineRpe - (detail.affectedRpe || 0);
    const paragraphParts = [
        `These campaigns averaged ${formatCurrency(detail.affectedRpe || 0)} per email versus your ${formatCurrency(detail.baselineRpe)} baseline, cutting ${formatCurrency(perEmailGap)} each time.`,
        `They reached ${detail.affectedEmails.toLocaleString()} recipients, so rework the offer or targeting before recycling them.`,
    ];

    return {
        headline: `Revenue & Reputation Warning (${rangeLabel})`,
        summary,
        paragraph: paragraphParts.join(" "),
    };
}

function buildDeliverabilityWarningCopy(rangeLabel: string, detail: WarningDetail): CampaignSubjectLineNoteCopy {
    const summary = `${detail.metricLabel?.replace(/^./, ch => ch.toUpperCase())} complaints spiked to ${formatRate(detail.metricRate || 0)}, breaching safe limits on ${formatPercent(detail.volumeShare)} of volume.`;
    const comparison = detail.baselineMetric != null && detail.baselineMetric > 0
        ? `Baseline ${detail.metricLabel} rate sits at ${formatRate(detail.baselineMetric)}.`
        : undefined;
    const paragraphParts = [
        comparison,
        `Hold high-volume resends until you adjust segmentation or creative—these sends hit ${detail.affectedEmails.toLocaleString()} inboxes and risk deliverability.`,
    ].filter(Boolean) as string[];

    return {
        headline: `Revenue & Reputation Warning (${rangeLabel})`,
        summary,
        paragraph: paragraphParts.join(" "),
    };
}

function buildWinsCopy(rangeLabel: string, highlight: HighlightDetail, baselineRpe: number): CampaignSubjectLineNoteCopy {
    const shareText = formatPercent(highlight.revenueShare);
    const summary = `${highlight.label} drove ${formatPercentChange(highlight.rpeLift)} revenue per email across ${highlight.totalEmails.toLocaleString()} recipients (${shareText} of revenue).`;

    const sentences: string[] = [];
    sentences.push(`These sends delivered ${formatCurrency(highlight.rpeValue)} per email versus ${formatCurrency(baselineRpe)} overall.`);

    if (highlight.openRateChange != null && highlight.openRateValue != null && highlight.totalEmails >= MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE) {
        sentences.push(`Opens reached ${highlight.openRateValue.toFixed(1)}% (${formatPercentChange(highlight.openRateChange)}) on meaningful volume.`);
    }
    if (highlight.clickRateChange != null && highlight.clickRateValue != null && highlight.totalEmails >= MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE) {
        sentences.push(`Clicks kept pace at ${highlight.clickRateValue.toFixed(1)}% (${formatPercentChange(highlight.clickRateChange)}).`);
    }
    if (highlight.rpeLift >= (IMPRESSIVE_RPE_MULTIPLIER - 1) * 100) {
        sentences.push("Scale this structure in your next broad send, keeping the same value story to protect the lift.");
    } else {
        sentences.push("Carry these learnings into the next broad test to maintain the revenue gain.");
    }

    return {
        headline: `Revenue Wins from Subject Lines (${rangeLabel})`,
        summary,
        paragraph: sentences.join(" "),
    };
}

function buildGeneralCopy(
    rangeLabel: string,
    baselineRpe: number,
    topRevenueShare: number | undefined,
    topRevenueCount: number | undefined,
    highlight: HighlightDetail | null,
): CampaignSubjectLineNoteCopy {
    const shareText = topRevenueShare != null && topRevenueCount != null
        ? `${percentShare(topRevenueShare)}% of revenue came from your top ${topRevenueCount === 1 ? "send" : `${topRevenueCount} sends`}`
        : null;
    const highlightText = highlight
        ? `${highlight.label} kept revenue per email ${formatPercentChange(highlight.rpeLift)} above your ${formatCurrency(baselineRpe)} baseline.`
        : "Keep testing subject line structure alongside your best-performing revenue drivers.";

    const summaryParts = [shareText, highlight ? highlightText : undefined].filter(Boolean);
    const summary = summaryParts.length ? summaryParts.join("; ") : `Baseline revenue per email sits at ${formatCurrency(baselineRpe)} for this range.`;

    const sentences: string[] = [];
    if (highlight) {
        sentences.push(`${highlight.totalEmails.toLocaleString()} recipients saw ${formatCurrency(highlight.rpeValue)} per email from ${highlight.label}.`);
        if (highlight.openRateValue != null && highlight.totalEmails >= MIN_EMAILS_FOR_HIGHLIGHT_ABSOLUTE) {
            sentences.push(`Opens hit ${highlight.openRateValue.toFixed(1)}% (${formatPercentChange(highlight.openRateChange)}) with clicks at ${highlight.clickRateValue?.toFixed(1) ?? "-"}%`);
        }
        sentences.push("Reuse the core angle in upcoming campaigns while you fine-tune segments and offers.");
    } else {
        sentences.push("Mix proven offers with fresh subject tests so more of the list sees high-RPE sends.");
    }

    return {
        headline: `Campaign & Subject Line Revenue Insights (${rangeLabel})`,
        summary,
        paragraph: sentences.join(" "),
    };
}

function buildInsufficientCopy(rangeLabel: string): CampaignSubjectLineNoteCopy {
    return {
        headline: `More Data Needed (${rangeLabel})`,
        summary: "Not enough campaigns in this window to trust subject line revenue patterns.",
        paragraph: "Run a few broader sends or A/B tests, then revisit these insights once volume passes 5,000 recipients.",
    };
}

export function buildCampaignSubjectLineInsights(
    campaigns: ProcessedCampaign[],
    rangeLabel: string,
    options?: { maxTopCount?: number },
): CampaignSubjectLineInsight | null {
    const totalCampaigns = campaigns.length;
    const baseline = collectBaseline(campaigns);

    if (totalCampaigns < MIN_CAMPAIGNS_REQUIRED || baseline.totalEmails < MIN_EMAILS_REQUIRED) {
        return {
            template: "insufficient",
            totalCampaigns,
            note: buildInsufficientCopy(rangeLabel),
        };
    }

    const topN = Math.min(options?.maxTopCount ?? 3, totalCampaigns);
    const sortedByRevenue = campaigns.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    const topRevenueTotal = sum(sortedByRevenue.slice(0, topN), c => c.revenue || 0);
    const topRevenueShare = baseline.totalRevenue > 0 ? (topRevenueTotal / baseline.totalRevenue) * 100 : undefined;

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

    const revenueWarning = detectRevenueWarning(campaigns, baseline);
    const deliverabilityWarning = detectDeliverabilityWarning(campaigns, baseline);

    const warningDetail = deliverabilityWarning || revenueWarning;
    if (warningDetail) {
        const note = warningDetail.type === "deliverability"
            ? buildDeliverabilityWarningCopy(rangeLabel, warningDetail)
            : buildRevenueWarningCopy(rangeLabel, warningDetail);
        return {
            template: "warning",
            totalCampaigns,
            totalRevenue: baseline.totalRevenue,
            topRevenueShare,
            topRevenueCount: topN,
            note,
        };
    }

    const winsHighlight = selectWinsHighlight(categoryHighlight, lengthHighlight);
    if (winsHighlight) {
        const note = buildWinsCopy(rangeLabel, winsHighlight, baseline.rpe);
        return {
            template: "wins",
            totalCampaigns,
            totalRevenue: baseline.totalRevenue,
            topRevenueShare,
            topRevenueCount: topN,
            bestLengthRange: winsHighlight.scope === "length" ? winsHighlight.label : undefined,
            bestLengthDelta: winsHighlight.scope === "length" ? winsHighlight.rpeLift : undefined,
            strongCategory: winsHighlight.scope === "category" ? winsHighlight.label : undefined,
            strongCategoryDelta: winsHighlight.scope === "category" ? winsHighlight.rpeLift : undefined,
            note,
        };
    }

    const generalHighlight = findGeneralHighlight(categoryHighlight, lengthHighlight);
    const note = buildGeneralCopy(rangeLabel, baseline.rpe, topRevenueShare, topN, generalHighlight);

    return {
        template: "general",
        totalCampaigns,
        totalRevenue: baseline.totalRevenue,
        topRevenueShare,
        topRevenueCount: topN,
        bestLengthRange: generalHighlight?.scope === "length" ? generalHighlight.label : undefined,
        bestLengthDelta: generalHighlight?.scope === "length" ? generalHighlight.rpeLift : undefined,
        strongCategory: generalHighlight?.scope === "category" ? generalHighlight.label : undefined,
        strongCategoryDelta: generalHighlight?.scope === "category" ? generalHighlight.rpeLift : undefined,
        note,
    };
}

