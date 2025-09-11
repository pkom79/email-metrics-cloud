// LLM-friendly JSON export builder with a strict minimal schema.
// Uses DataManager processed data; outputs only the requested metrics and splits.

import { DataManager } from "../data/dataManager";
import { computeCampaignSendFrequency } from "../analytics/campaignSendFrequency";
import { computeSubjectAnalysis } from "../analytics/subjectAnalysis";
import type { AggregatedMetrics } from "../data/dataTypes";

export interface LlmExportJson {
  // ISO YYYY-MM range of full months included
  period: { fromMonth: string | null; toMonth: string | null; months: number };
  // Aggregated values for the full-month window
  metrics: {
    overall: ExportMetricValues;
    campaignsOnly: ExportMetricValues;
    flowsOnly: ExportMetricValues;
  };
  // Monthly Campaign vs Flow split for revenue and emails, plus period totals
  campaignFlowSplit: {
    revenue: {
      monthly: Array<{ month: string; campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number }>;
      period: { campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number };
    };
    emailsSent: {
      monthly: Array<{ month: string; campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number }>;
      period: { campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number };
    };
  };
  // Send Volume Impact: total correlation across selected time period buckets (not per-bucket breakdown)
  sendVolumeImpact?: {
    correlationBySegment: {
      campaigns: CorrelationSet;
      flows: CorrelationSet;
    };
  };
  // Campaign Performance by Send Frequency over the selected lookback period (not trimmed to full months)
  campaignSendFrequency?: {
    buckets: Array<{
      key: '1' | '2' | '3' | '4+';
      weeksCount: number;
      totalCampaigns: number; // number of campaigns in this bucket during lookback
      perWeek: { avgWeeklyRevenue: number; avgWeeklyOrders: number; avgWeeklyEmails: number };
      perCampaign: { avgCampaignRevenue: number; avgCampaignOrders: number; avgCampaignEmails: number };
      rates: {
        avgOrderValue: number; // AOV
        conversionRate: number;
        openRate: number;
        clickRate: number;
        clickToOpenRate: number;
        revenuePerEmail: number;
        unsubscribeRate: number;
        spamRate: number;
        bounceRate: number;
      };
    }>;
  };
  // Subject Line Analysis (All Segments): provide only lifts vs account-average for the selected time period
  subjectLineAnalysis?: {
    openRate: SubjectMetricLiftSet;
    clickToOpenRate: SubjectMetricLiftSet;
    clickRate: SubjectMetricLiftSet;
    revenuePerEmail: SubjectMetricLiftSet;
  };
}

type CorrelationValue = { r: number | null; n: number };
type CorrelationSet = {
  averageRevenue: CorrelationValue; // per-bucket revenue vs emails
  revenuePerEmail: CorrelationValue;
  unsubsPer1k: CorrelationValue;
  bouncesPer1k: CorrelationValue;
  spamPer1k: CorrelationValue;
};

export type ExportMetricValues = {
  totalRevenue: number;
  avgOrderValue: number;
  totalOrders: number;
  conversionRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  revenuePerEmail: number;
  emailsSent: number;
  unsubscribeRate: number;
  spamRate: number;
  bounceRate: number;
};

// Lifts set for one metric across requested feature groups
type SubjectMetricLiftSet = {
  lengthBins: { '0-30': number; '31-50': number; '51-70': number };
  keywordEmoji: {
    exclusive: number; sale: number; emojiPresent: number; limited: number; save: number; off: number; discount: number; percentOff: number;
  };
  punctuationCasing: {
    brackets: number; exclamation: number; percent: number; allCaps: number; questionMark: number; number: number;
  };
  urgency: { tonight: number; now: number; hours: number; midnight: number; final: number; today: number; ends: number; ending: number };
  personalization: { youYour: number };
  priceAnchoring: { currency: number; percentDiscount: number; dollarDiscount: number };
  imperativeStart: { startsWithVerb: number };
  reuseFatigue: { averageChange: number; subjectsCount: number };
};

export async function buildLlmExportJson(params: {
  dateRange: string;
  granularity: "daily" | "weekly" | "monthly";
  compareMode: "prev-period" | "prev-year";
  customFrom?: string;
  customTo?: string;
}): Promise<LlmExportJson> {
  const dm = DataManager.getInstance();
  const { dateRange, customFrom, customTo, granularity } = params as any;

  // Resolve window then trim to full months
  const resolved = dm.getResolvedDateRange(dateRange, customFrom, customTo);
  const last = dm.getLastEmailDate();
  const rawStart = resolved?.startDate ?? new Date(last);
  const rawEnd = resolved?.endDate ?? new Date(last);
  const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const lastOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  let start = firstOfMonth(rawStart);
  if (rawStart.getDate() !== 1 || rawStart.getHours() !== 0) {
    // next month if not starting at first day
    start = new Date(rawStart.getFullYear(), rawStart.getMonth() + 1, 1, 0, 0, 0, 0);
  }
  let end = lastOfMonth(rawEnd);
  const isLastDay = rawEnd.getDate() === lastOfMonth(rawEnd).getDate();
  if (!isLastDay) {
    // previous month's last day
    end = new Date(rawEnd.getFullYear(), rawEnd.getMonth(), 0, 23, 59, 59, 999);
  }

  // If no full months in range
  if (start > end) {
    return {
      period: { fromMonth: null, toMonth: null, months: 0 },
      metrics: {
        overall: zeroMetrics(),
        campaignsOnly: zeroMetrics(),
        flowsOnly: zeroMetrics(),
      },
      campaignFlowSplit: {
        revenue: { monthly: [], period: { campaigns: 0, flows: 0, total: 0, campaignPct: 0, flowPct: 0 } },
        emailsSent: { monthly: [], period: { campaigns: 0, flows: 0, total: 0, campaignPct: 0, flowPct: 0 } },
      },
    };
  }

  const fromMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const toMonth = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;

  // Aggregates for full-month window
  const overallAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), dm.getFlowEmails(), start, end);
  const campAgg = dm.getAggregatedMetricsForPeriod(dm.getCampaigns(), [], start, end);
  const flowAgg = dm.getAggregatedMetricsForPeriod([], dm.getFlowEmails(), start, end);

  const pick = (a: AggregatedMetrics): ExportMetricValues => ({
    totalRevenue: a.totalRevenue,
    avgOrderValue: a.avgOrderValue,
    totalOrders: a.totalOrders,
    conversionRate: a.conversionRate,
    openRate: a.openRate,
    clickRate: a.clickRate,
    clickToOpenRate: a.clickToOpenRate,
    revenuePerEmail: a.revenuePerEmail,
    emailsSent: a.emailsSent,
    unsubscribeRate: a.unsubscribeRate,
    spamRate: a.spamRate,
    bounceRate: a.bounceRate,
  });

  // Monthly Campaign vs Flow split for revenue and emailsSent over the full-month window
  const mkSplit = (metric: 'revenue' | 'emailsSent') => {
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const fromDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2,'0')}-01`;
    const toDay = fmt(end);
    const camp = dm.getMetricTimeSeries(dm.getCampaigns(), [], metric, 'custom', 'monthly', fromDay, toDay) as Array<{ date: string; iso?: string; value: number }>;
    const flow = dm.getMetricTimeSeries([], dm.getFlowEmails(), metric, 'custom', 'monthly', fromDay, toDay) as Array<{ date: string; iso?: string; value: number }>;
    // Group strictly by YYYY-MM using the iso field returned by DataManager
    const monthly: Array<{ month: string; campaigns: number; flows: number; total: number; campaignPct: number; flowPct: number }> = [];
    const byMonth = new Map<string, { c: number; f: number }>();
    for (const p of camp) { const m = ((p.iso || p.date) || '').slice(0,7); if (m) { const r = byMonth.get(m) || { c: 0, f: 0 }; r.c += p.value || 0; byMonth.set(m, r); } }
    for (const p of flow) { const m = ((p.iso || p.date) || '').slice(0,7); if (m) { const r = byMonth.get(m) || { c: 0, f: 0 }; r.f += p.value || 0; byMonth.set(m, r); } }
    const monthsKeys: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) { monthsKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`); cursor.setMonth(cursor.getMonth() + 1); }
    for (const m of monthsKeys) {
      const rec = byMonth.get(m) || { c: 0, f: 0 };
      const total = rec.c + rec.f;
      const campaignPct = total > 0 ? (rec.c / total) * 100 : 0;
      const flowPct = total > 0 ? (rec.f / total) * 100 : 0;
      monthly.push({ month: m, campaigns: rec.c, flows: rec.f, total, campaignPct, flowPct });
    }
    const cAgg = metric === 'revenue' ? campAgg.totalRevenue : campAgg.emailsSent;
    const fAgg = metric === 'revenue' ? flowAgg.totalRevenue : flowAgg.emailsSent;
    const tAgg = cAgg + fAgg;
    const period = { campaigns: cAgg, flows: fAgg, total: tAgg, campaignPct: tAgg ? (cAgg / tAgg) * 100 : 0, flowPct: tAgg ? (fAgg / tAgg) * 100 : 0 };
    return { monthly, period };
  };

  // Build base JSON
  const json: LlmExportJson = {
    period: { fromMonth, toMonth, months },
    metrics: {
      overall: pick(overallAgg),
      campaignsOnly: pick(campAgg),
      flowsOnly: pick(flowAgg),
    },
    campaignFlowSplit: {
      revenue: mkSplit('revenue'),
      emailsSent: mkSplit('emailsSent'),
    },
  };

  // Send Volume Impact: correlations across selected period buckets by segment
  try {
    const buildCorr = (seg: 'campaigns' | 'flows'): CorrelationSet => {
      const c = seg === 'campaigns' ? dm.getCampaigns() : [];
      const f = seg === 'flows' ? dm.getFlowEmails() : [];
      const xs = dm.getMetricTimeSeries(c, f, 'emailsSent', dateRange, granularity, customFrom, customTo).map(p => p.value || 0);
      const series = {
        averageRevenue: dm.getMetricTimeSeries(c, f, 'revenue', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        revenuePerEmail: dm.getMetricTimeSeries(c, f, 'revenuePerEmail', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        unsubsPer1k: dm.getMetricTimeSeries(c, f, 'unsubscribeRate', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        bouncesPer1k: dm.getMetricTimeSeries(c, f, 'bounceRate', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
        spamPer1k: dm.getMetricTimeSeries(c, f, 'spamRate', dateRange, granularity, customFrom, customTo).map(p => p.value || 0),
      };
      const pearson = (xsArr: number[], ysArr: number[]): CorrelationValue => {
        const n = Math.min(xsArr.length, ysArr.length);
        const pairs: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
          const x = xsArr[i]; const y = ysArr[i];
          if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
        }
        if (pairs.length < 3) return { r: null, n: pairs.length };
        const xVals = pairs.map(p => p.x); const yVals = pairs.map(p => p.y);
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        const mx = mean(xVals); const my = mean(yVals);
        let num = 0, dxs = 0, dys = 0;
        for (let i = 0; i < pairs.length; i++) { const dx = xVals[i] - mx; const dy = yVals[i] - my; num += dx * dy; dxs += dx * dx; dys += dy * dy; }
        if (dxs === 0 || dys === 0) return { r: null, n: pairs.length };
        return { r: num / Math.sqrt(dxs * dys), n: pairs.length };
      };
      return {
        averageRevenue: pearson(xs, series.averageRevenue),
        revenuePerEmail: pearson(xs, series.revenuePerEmail),
        unsubsPer1k: pearson(xs, series.unsubsPer1k),
        bouncesPer1k: pearson(xs, series.bouncesPer1k),
        spamPer1k: pearson(xs, series.spamPer1k),
      };
    };
    json.sendVolumeImpact = {
      correlationBySegment: {
        campaigns: buildCorr('campaigns'),
        flows: buildCorr('flows'),
      },
    };
  } catch (e) {
    // Non-fatal
  }

  // Campaign Performance by Send Frequency (lookback period as selected, not full-month trimmed)
  try {
    const resolvedRange = dm.getResolvedDateRange(dateRange, customFrom, customTo);
    const s = resolvedRange?.startDate;
    const e = resolvedRange?.endDate;
    if (s && e) {
      const campaigns = dm.getCampaigns().filter(c => {
        const d = (c as any).sentDate as Date | undefined;
        return d instanceof Date && !isNaN(d.getTime()) && d >= s && d <= e;
      });
      const agg = computeCampaignSendFrequency(campaigns);
      json.campaignSendFrequency = {
        buckets: agg.map(b => ({
          key: b.key,
          weeksCount: b.weeksCount,
          totalCampaigns: b.totalCampaigns,
          perWeek: {
            avgWeeklyRevenue: b.avgWeeklyRevenue,
            avgWeeklyOrders: b.avgWeeklyOrders,
            avgWeeklyEmails: b.avgWeeklyEmails,
          },
          perCampaign: {
            avgCampaignRevenue: (b as any).avgCampaignRevenue,
            avgCampaignOrders: (b as any).avgCampaignOrders,
            avgCampaignEmails: (b as any).avgCampaignEmails,
          },
          rates: {
            avgOrderValue: b.aov,
            conversionRate: b.conversionRate,
            openRate: b.openRate,
            clickRate: b.clickRate,
            clickToOpenRate: b.clickToOpenRate,
            revenuePerEmail: b.revenuePerEmail,
            unsubscribeRate: b.unsubscribeRate,
            spamRate: b.spamRate,
            bounceRate: b.bounceRate,
          },
        }))
      };

      // Subject Line Analysis (All Segments) — compute per metric and map to requested keys
      const buildSubjectSet = (metric: 'openRate' | 'clickToOpenRate' | 'clickRate' | 'revenuePerEmail'): SubjectMetricLiftSet => {
        const res = computeSubjectAnalysis(campaigns as any, metric, 'ALL_SEGMENTS');
        const getLift = (arr: Array<{ key: string; liftVsBaseline: number }>, key: string): number => {
          const f = arr.find(x => x.key === key);
          return f ? f.liftVsBaseline : 0;
        };
        const lb = (k: '0-30' | '31-50' | '51-70'): number => {
          const f = (res.lengthBins || []).find(x => (x as any).key === k);
          return f ? (f as any).liftVsBaseline : 0;
        };
        const avgChange = (() => {
          const list = res.reuse || [];
          if (!list.length) return 0;
          const sum = list.reduce((s, r) => s + (r.change || 0), 0);
          return sum / list.length;
        })();
        return {
          lengthBins: { '0-30': lb('0-30'), '31-50': lb('31-50'), '51-70': lb('51-70') },
          keywordEmoji: {
            exclusive: getLift(res.keywordEmojis as any, 'kw:exclusive'),
            sale: getLift(res.keywordEmojis as any, 'kw:sale'),
            emojiPresent: getLift(res.keywordEmojis as any, 'emoji'),
            limited: getLift(res.keywordEmojis as any, 'kw:limited'),
            save: getLift(res.keywordEmojis as any, 'kw:save'),
            off: getLift(res.keywordEmojis as any, 'kw:off'),
            discount: getLift(res.keywordEmojis as any, 'kw:discount'),
            percentOff: getLift(res.keywordEmojis as any, 'kw:% off'),
          },
          punctuationCasing: {
            brackets: getLift(res.punctuationCasing as any, 'brackets'),
            exclamation: getLift(res.punctuationCasing as any, 'exclaim'),
            percent: getLift(res.punctuationCasing as any, 'percent'),
            allCaps: getLift(res.punctuationCasing as any, 'allcaps'),
            questionMark: getLift(res.punctuationCasing as any, 'qmark'),
            number: getLift(res.punctuationCasing as any, 'number'),
          },
          urgency: {
            tonight: getLift(res.deadlines as any, 'deadline:tonight'),
            now: getLift(res.deadlines as any, 'deadline:now'),
            hours: getLift(res.deadlines as any, 'deadline:hours'),
            midnight: getLift(res.deadlines as any, 'deadline:midnight'),
            final: getLift(res.deadlines as any, 'deadline:final'),
            today: getLift(res.deadlines as any, 'deadline:today'),
            ends: getLift(res.deadlines as any, 'deadline:ends'),
            ending: getLift(res.deadlines as any, 'deadline:ending'),
          },
          personalization: { youYour: getLift(res.personalization as any, 'p:you') },
          priceAnchoring: {
            currency: getLift(res.priceAnchoring as any, 'cur'),
            percentDiscount: getLift(res.priceAnchoring as any, 'pct'),
            dollarDiscount: getLift(res.priceAnchoring as any, 'price$'),
          },
          imperativeStart: { startsWithVerb: getLift(res.imperativeStart as any, 'imperative') },
          reuseFatigue: { averageChange: avgChange, subjectsCount: (res.reuse || []).length },
        };
      };
      json.subjectLineAnalysis = {
        openRate: buildSubjectSet('openRate'),
        clickToOpenRate: buildSubjectSet('clickToOpenRate'),
        clickRate: buildSubjectSet('clickRate'),
        revenuePerEmail: buildSubjectSet('revenuePerEmail'),
      };
    }
  } catch (e) {
    // Non-fatal
  }

  return json;
}

function zeroMetrics(): ExportMetricValues {
  return { totalRevenue: 0, avgOrderValue: 0, totalOrders: 0, conversionRate: 0, openRate: 0, clickRate: 0, clickToOpenRate: 0, revenuePerEmail: 0, emailsSent: 0, unsubscribeRate: 0, spamRate: 0, bounceRate: 0 };
}
