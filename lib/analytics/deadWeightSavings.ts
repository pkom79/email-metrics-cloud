import { DataManager } from "../data/dataManager";

export interface DeadWeightSavingsSummary {
  currentSubscribers: number;
  deadWeightCount: number;
  projectedSubscribers: number;
  currentMonthlyPrice: number | null;
  projectedMonthlyPrice: number | null;
  monthlySavings: number | null;
  annualSavings: number | null;
}

// Klaviyo pricing tiers snapshot used in UI; custom pricing for >250k
const PRICING: { min: number; max: number; price: number }[] = [
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
  const tier = PRICING.find(t => count >= t.min && count <= t.max);
  return tier ? tier.price : null;
};

export function computeDeadWeightSavings(): DeadWeightSavingsSummary | null {
  const dm = DataManager.getInstance();
  const subscribers = dm.getSubscribers();
  if (!subscribers.length) return null;

  const anchor = dm.getLastEmailDate();
  const daysDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

  const seg1: string[] = [];
  const seg2: string[] = [];

  subscribers.forEach(sub => {
    const created = sub.profileCreated instanceof Date ? sub.profileCreated : null;
    const createdAge = created ? daysDiff(anchor, created) : 0;
    const lastOpen = sub.lastOpen instanceof Date ? sub.lastOpen : null;
    const lastClick = sub.lastClick instanceof Date ? sub.lastClick : null;

    const firstActiveUnset = !sub.firstActiveRaw;
    const lastActiveUnset = !sub.lastActive;
    if (firstActiveUnset && lastActiveUnset && createdAge >= 30) {
      seg1.push('1');
    }

    if (createdAge >= 90) {
      const openAge = lastOpen ? daysDiff(anchor, lastOpen) : Infinity;
      const clickAge = lastClick ? daysDiff(anchor, lastClick) : Infinity;
      if (openAge >= 90 && clickAge >= 90) seg2.push('1');
    }
  });

  const currentCount = subscribers.length;
  const deadWeightCount = new Set([...seg1, ...seg2]).size; // only counts, no emails
  const projectedCount = Math.max(0, currentCount - deadWeightCount);

  const currentMonthlyPrice = priceFor(currentCount);
  const projectedMonthlyPrice = priceFor(projectedCount);
  const monthlySavings = currentMonthlyPrice !== null && projectedMonthlyPrice !== null ? currentMonthlyPrice - projectedMonthlyPrice : null;
  const annualSavings = monthlySavings !== null ? monthlySavings * 12 : null;

  return { currentSubscribers: currentCount, deadWeightCount, projectedSubscribers: projectedCount, currentMonthlyPrice, projectedMonthlyPrice, monthlySavings, annualSavings };
}
