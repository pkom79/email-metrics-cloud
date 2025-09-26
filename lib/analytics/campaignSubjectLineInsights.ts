import type { ProcessedCampaign } from "../data/dataTypes";
import { computeSubjectAnalysis, type FeatureStat, type LengthBinStat } from "./subjectAnalysis";

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

const MIN_CAMPAIGNS_REQUIRED = 5;
const MIN_CATEGORY_SAMPLES = 3;
const MIN_LENGTH_SAMPLES = 3;

function formatLengthRange(min: number, max: number | null): string {
    if (max == null) return `${min}+ characters`;
    if (min === max) return `${min} characters`;
    return `${min}-${max} characters`;
}

function pickBestLength(binsIn: LengthBinStat[]) {
    const bins = binsIn.filter(bin => bin.countCampaigns >= MIN_LENGTH_SAMPLES);
    if (!bins.length) return { best: null, worst: null };

    const sorted = bins.slice().sort((a, b) => (b.liftVsBaseline ?? 0) - (a.liftVsBaseline ?? 0));
    const best = sorted.find(bin => (bin.liftVsBaseline ?? 0) > 0.25) || sorted[0];

    const worst = bins
        .slice()
        .sort((a, b) => (a.liftVsBaseline ?? 0) - (b.liftVsBaseline ?? 0))
        .find(bin => (bin.liftVsBaseline ?? 0) < -0.5) || null;

    return { best, worst };
}

function pickCategories(categoriesIn: FeatureStat[]) {
    const categories = categoriesIn.filter(cat => cat.countCampaigns >= MIN_CATEGORY_SAMPLES);
    if (!categories.length) return { best: null, worst: null, alternative: null };

    const sortedDesc = categories.slice().sort((a, b) => (b.liftVsBaseline ?? 0) - (a.liftVsBaseline ?? 0));
    const sortedAsc = categories.slice().sort((a, b) => (a.liftVsBaseline ?? 0) - (b.liftVsBaseline ?? 0));

    const best = sortedDesc.find(cat => (cat.liftVsBaseline ?? 0) > 0.5) || sortedDesc[0];
    const worst = sortedAsc.find(cat => (cat.liftVsBaseline ?? 0) < -1) || null;

    let alternative: typeof best | null = null;
    if (best && worst && best.key === worst.key) {
        alternative = sortedDesc.find(cat => cat.key !== best.key) || null;
    } else {
        alternative = sortedDesc.find(cat => cat.key !== (worst?.key ?? "")) || null;
    }

    return { best, worst, alternative };
}

function percentShare(value: number): number {
    return Math.round(value * 10) / 10;
}

function formatDelta(delta?: number | null): string {
    if (delta == null) return "0.0";
    const rounded = Math.round(delta * 10) / 10;
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded.toFixed(1)} pts`;
}

function formatAbsoluteDelta(delta?: number | null): string {
    if (delta == null) return "0.0 pts";
    const rounded = Math.round(Math.abs(delta) * 10) / 10;
    return `${rounded.toFixed(1)} pts`;
}

function buildParagraph(sentences: string[]): string {
    return sentences.filter(Boolean).join(" ");
}

function buildGeneralCopy(params: {
    rangeLabel: string;
    topShare?: number;
    topCount?: number;
    bestLength?: { label: string; delta: number } | null;
    weakCategory?: { label: string; delta: number } | null;
    strongCategory?: { label: string; delta: number } | null;
}): CampaignSubjectLineNoteCopy {
    const { rangeLabel, topShare, topCount, bestLength, weakCategory, strongCategory } = params;
    const shareText = topShare != null && topCount
        ? `${percentShare(topShare)}% of campaign revenue came from your top ${topCount === 1 ? "email" : `${topCount} emails`}`
        : null;
    const summaryParts = [shareText, "subject engagement varied by length and theme."];
    const summary = `Campaign results show ${summaryParts.filter(Boolean).join(" while ")}`;

    const sentences: string[] = [];
    if (bestLength) {
        sentences.push(`Favor subject lines in the ${bestLength.label} range; they lifted open rates by ${formatDelta(bestLength.delta)}.`);
    }
    if (weakCategory) {
        sentences.push(`Dial back heavy use of ${weakCategory.label.toLowerCase()}, which trailed baseline by ${formatDelta(weakCategory.delta)}.`);
    }
    if (strongCategory) {
        sentences.push(`Keep leaning into ${strongCategory.label.toLowerCase()} angles—they remained above baseline.`);
    }
    if (!sentences.length) {
        sentences.push("Keep mixing campaign formats with fresh subject line tests to protect engagement.");
    }

    return {
        headline: `Campaign & Subject Line Insights (${rangeLabel})`,
        summary,
        paragraph: buildParagraph(sentences),
    };
}

function buildWarningCopy(params: {
    rangeLabel: string;
    weakCategory?: { label: string; delta: number } | null;
    longLength?: { label: string; delta: number } | null;
    alternativeCategory?: { label: string; delta: number } | null;
}): CampaignSubjectLineNoteCopy {
    const { rangeLabel, weakCategory, longLength, alternativeCategory } = params;
    const summaryPieces: string[] = [];
    if (weakCategory) {
        summaryPieces.push(`${weakCategory.label} framing underperformed by ${formatDelta(weakCategory.delta)}`);
    }
    if (longLength) {
        summaryPieces.push(`subjects above ${longLength.label} dragged engagement`);
    }

    const summary = summaryPieces.length
        ? `Engagement slipped when ${summaryPieces.join(" and ")}.`
        : "Subject line engagement has cooled in this window.";

    const sentences: string[] = [];
    if (longLength) {
        sentences.push(`Shorten upcoming subjects to stay below ${longLength.label}; longer lines lost ${formatAbsoluteDelta(longLength.delta)} versus your baseline.`);
    }
    if (weakCategory) {
        sentences.push(`Swap out ${weakCategory.label.toLowerCase()} messaging for fresher angles to revive opens.`);
    }
    if (alternativeCategory) {
        sentences.push(`Test more ${alternativeCategory.label.toLowerCase()} copy—those notes held ${formatDelta(alternativeCategory.delta)} over baseline.`);
    } else {
        sentences.push("Pair urgency with personalization or value-first copy to recover momentum.");
    }

    return {
        headline: `Subject Line Performance Warning (${rangeLabel})`,
        summary,
        paragraph: buildParagraph(sentences),
    };
}

function buildWinsCopy(params: {
    rangeLabel: string;
    strongCategory?: { label: string; delta: number } | null;
    bestLength?: { label: string; delta: number } | null;
}): CampaignSubjectLineNoteCopy {
    const { rangeLabel, strongCategory, bestLength } = params;
    const summary = `Subject lines featuring ${strongCategory?.label.toLowerCase() ?? "your leading themes"} held above-baseline open rates this period.`;

    const sentences: string[] = [];
    if (strongCategory) {
        sentences.push(`Scale more ${strongCategory.label.toLowerCase()} variations—they outpaced baseline by ${formatDelta(strongCategory.delta)}.`);
    }
    if (bestLength) {
        sentences.push(`Stay in the ${bestLength.label} window; it continued delivering ${formatDelta(bestLength.delta)} over baseline.`);
    }
    sentences.push("Feed these learnings into your next A/B subject line tests to compound gains.");

    return {
        headline: `Subject Line Wins (${rangeLabel})`,
        summary,
        paragraph: buildParagraph(sentences),
    };
}

export function buildCampaignSubjectLineInsights(
    campaigns: ProcessedCampaign[],
    rangeLabel: string,
    options?: { maxTopCount?: number }
): CampaignSubjectLineInsight | null {
    const totalCampaigns = campaigns.length;
    if (totalCampaigns < MIN_CAMPAIGNS_REQUIRED) {
        return {
            template: "insufficient",
            totalCampaigns,
            note: {
                headline: `Campaign & Subject Line Insights (${rangeLabel})`,
                summary: "Not enough campaigns in this window to surface reliable subject line patterns.",
                paragraph: "Ship a few more segmented tests, then revisit these insights to spot repeatable wins.",
            },
        };
    }

    const topN = options?.maxTopCount ?? 3;
    const totalRevenue = campaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
    const sortedByRevenue = campaigns.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    const topRevenueTotal = sortedByRevenue.slice(0, topN).reduce((sum, c) => sum + (c.revenue || 0), 0);
    const topRevenueShare = totalRevenue > 0 ? (topRevenueTotal / totalRevenue) * 100 : undefined;

    const analysis = computeSubjectAnalysis(campaigns, "openRate");
    const { best: bestLengthBin, worst: worstLengthBin } = pickBestLength(analysis.lengthBins);
    const { best: bestCategory, worst: worstCategory, alternative: altCategory } = pickCategories(analysis.categories);

    const bestLength = bestLengthBin
        ? { label: formatLengthRange(bestLengthBin.range[0], bestLengthBin.range[1] ?? null), delta: bestLengthBin.liftVsBaseline }
        : null;
    const worstLength = worstLengthBin
        ? { label: formatLengthRange(worstLengthBin.range[0], worstLengthBin.range[1] ?? null), delta: worstLengthBin.liftVsBaseline }
        : null;
    const strongCategory = bestCategory
        ? { label: bestCategory.label, delta: bestCategory.liftVsBaseline }
        : null;
    const weakCategory = worstCategory
        ? { label: worstCategory.label, delta: worstCategory.liftVsBaseline }
        : null;
    const alternativeCategory = altCategory
        ? { label: altCategory.label, delta: altCategory.liftVsBaseline }
        : null;

    const warningTriggered = (weakCategory?.delta ?? 0) <= -1 || (worstLength?.delta ?? 0) <= -0.8;
    const winsTriggered = !warningTriggered && (strongCategory?.delta ?? 0) >= 0.5;

    let template: CampaignSubjectLineTemplate = "general";
    if (warningTriggered) template = "warning";
    else if (winsTriggered) template = "wins";

    let note: CampaignSubjectLineNoteCopy;
    if (template === "warning") {
        note = buildWarningCopy({
            rangeLabel,
            weakCategory,
            longLength: worstLength,
            alternativeCategory,
        });
    } else if (template === "wins") {
        note = buildWinsCopy({
            rangeLabel,
            strongCategory,
            bestLength,
        });
    } else {
            note = buildGeneralCopy({
                rangeLabel,
                topShare: topRevenueShare,
                topCount: totalRevenue > 0 ? Math.min(topN, totalCampaigns) : undefined,
                bestLength,
                weakCategory,
                strongCategory,
            });
    }

    return {
        template,
        totalCampaigns,
        totalRevenue,
        topRevenueShare,
        topRevenueCount: Math.min(topN, totalCampaigns),
        bestLengthRange: bestLength?.label,
        bestLengthDelta: bestLength?.delta,
        weakLengthRange: worstLength?.label,
        weakLengthDelta: worstLength?.delta,
        strongCategory: strongCategory?.label,
        strongCategoryDelta: strongCategory?.delta,
        weakCategory: weakCategory?.label,
        weakCategoryDelta: weakCategory?.delta,
        alternativeCategory: alternativeCategory?.label,
        alternativeCategoryDelta: alternativeCategory?.delta,
        note,
    };
}
