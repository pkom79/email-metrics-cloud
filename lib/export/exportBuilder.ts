// LLM-friendly JSON export builder with a strict minimal schema.
// Uses DataManager processed data; outputs only the requested metrics and splits.

import { DataManager } from "../data/dataManager";
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
}

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

export async function buildLlmExportJson(params: {
  dateRange: string;
  granularity: "daily" | "weekly" | "monthly";
  compareMode: "prev-period" | "prev-year";
  customFrom?: string;
  customTo?: string;
}): Promise<LlmExportJson> {
  const dm = DataManager.getInstance();
  const { dateRange, customFrom, customTo } = params;

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

  return {
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
}

function zeroMetrics(): ExportMetricValues {
  return { totalRevenue: 0, avgOrderValue: 0, totalOrders: 0, conversionRate: 0, openRate: 0, clickRate: 0, clickToOpenRate: 0, revenuePerEmail: 0, emailsSent: 0, unsubscribeRate: 0, spamRate: 0, bounceRate: 0 };
}
