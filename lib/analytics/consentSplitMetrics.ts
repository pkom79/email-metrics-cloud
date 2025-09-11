import { ProcessedSubscriber } from "../data/dataTypes";

export type ConsentSplitMetric =
  | "count"
  | "buyers"
  | "nonBuyers"
  | "repeatBuyers"
  | "ltvBuyers"
  | "ltvAll"
  | "totalRevenue"
  | "engaged30"
  | "engaged60"
  | "engaged90";

export interface ConsentGroupValue {
  key: "Subscribed" | "Not Subscribed";
  value: number; // primary value for the selected metric
  sampleSize: number; // group size after filtering
  percentOfGroup?: number; // optional: value as % of group (for certain metrics)
}

export interface ConsentSplitResult {
  metric: ConsentSplitMetric;
  groups: ConsentGroupValue[];
}

/**
 * Group subscribers by CSV consent text: exact "SUBSCRIBED" vs anything else.
 * NOTE: We do NOT rely on boolean emailConsent to honor exact text requirement.
 */
function groupKey(sub: ProcessedSubscriber): "Subscribed" | "Not Subscribed" {
  const raw = (sub.emailConsentRaw || "").toString().trim().toUpperCase();
  return raw === "SUBSCRIBED" ? "Subscribed" : "Not Subscribed";
}

function isEngagedWithin(sub: ProcessedSubscriber, anchor: Date, days: number): boolean {
  const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
  const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;
  const ms = 1000 * 60 * 60 * 24 * days;
  const winStart = new Date(anchor.getTime() - ms);
  if (lastOpen && lastOpen >= winStart && lastOpen <= anchor) return true;
  if (lastClick && lastClick >= winStart && lastClick <= anchor) return true;
  return false;
}

/**
 * Compute consent split metric values for two groups across a filtered list of subscribers.
 * The caller should pass subscribers already filtered by the global date range (e.g., by profileCreated).
 */
export function getConsentSplitMetrics(
  subscribers: ProcessedSubscriber[],
  metric: ConsentSplitMetric,
  anchor: Date
): ConsentSplitResult {
  const groups: Record<"Subscribed" | "Not Subscribed", ProcessedSubscriber[]> = {
    Subscribed: [],
    "Not Subscribed": []
  };
  for (const s of subscribers) groups[groupKey(s)].push(s);

  const calc = (arr: ProcessedSubscriber[]): { value: number; sample: number; pct?: number } => {
    const sample = arr.length;
    if (sample === 0) return { value: 0, sample: 0, pct: 0 };
    switch (metric) {
      case "count": {
        return { value: sample, sample };
      }
      case "buyers": {
        const n = arr.filter(s => s.isBuyer).length;
        return { value: n, sample, pct: sample > 0 ? (n / sample) * 100 : 0 };
      }
      case "nonBuyers": {
        const buyers = arr.filter(s => s.isBuyer).length;
        const n = sample - buyers;
        return { value: n, sample, pct: sample > 0 ? (n / sample) * 100 : 0 };
      }
      case "repeatBuyers": {
        const n = arr.filter(s => (s.totalOrders || 0) >= 2).length;
        return { value: n, sample, pct: sample > 0 ? (n / sample) * 100 : 0 };
      }
      case "ltvBuyers": {
        const buyers = arr.filter(s => s.isBuyer);
        const n = buyers.length;
        const avg = n > 0 ? buyers.reduce((sum, s) => sum + (s.totalClv || 0), 0) / n : 0;
        return { value: avg, sample };
      }
      case "ltvAll": {
        const avg = sample > 0 ? arr.reduce((sum, s) => sum + (s.totalClv || 0), 0) / sample : 0;
        return { value: avg, sample };
      }
      case "totalRevenue": {
        const sum = arr.reduce((acc, s) => acc + (s.totalClv || 0), 0);
        return { value: sum, sample };
      }
      case "engaged30":
      case "engaged60":
      case "engaged90": {
        const days = metric === "engaged30" ? 30 : metric === "engaged60" ? 60 : 90;
        const n = arr.filter(s => isEngagedWithin(s, anchor, days)).length;
        return { value: n, sample, pct: sample > 0 ? (n / sample) * 100 : 0 };
      }
      default:
        return { value: 0, sample };
    }
  };

  const sub = calc(groups.Subscribed);
  const notSub = calc(groups["Not Subscribed"]);

  return {
    metric,
    groups: [
      { key: "Subscribed", value: sub.value, sampleSize: sub.sample, percentOfGroup: sub.pct },
      { key: "Not Subscribed", value: notSub.value, sampleSize: notSub.sample, percentOfGroup: notSub.pct },
    ]
  };
}

export function formatConsentMetricValue(metric: ConsentSplitMetric, value: number): string {
  if (metric === "ltvBuyers" || metric === "ltvAll" || metric === "totalRevenue") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
  }
  return Math.round(value || 0).toLocaleString("en-US");
}
