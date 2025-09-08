// Shared helpers for axis domain, tick generation, and tick label formatting

export type ValueType = 'currency' | 'number' | 'percentage';

// Compute an axis max using raw data (no "nice" rounding).
export function computeAxisMax(values: number[], compareValues: number[] | null | undefined, type: ValueType): number {
  if (type === 'percentage') return 100;
  let raw = 0;
  for (const v of values) if (Number.isFinite(v) && v > raw) raw = v;
  if (compareValues) for (const v of compareValues) if (Number.isFinite(v) && v > raw) raw = v;
  if (!Number.isFinite(raw) || raw <= 0) raw = 1; // fallback to avoid divide-by-zero
  return raw;
}

// Thirds tick values for the given axis max (0, 1/3, 2/3, max)
export function thirdTicks(axisMax: number, type: ValueType): number[] {
  if (type === 'percentage') return [0, 100 / 3, 200 / 3, 100];
  return [0, axisMax / 3, (2 * axisMax) / 3, axisMax];
}

// Format an array of tick values into axis labels following rules:
// - Axis ticks only use compact formatting for currency (K/M/B/T) with $.
// - No decimals by default. If axisMax < 3 or labels would collide after rounding, increase decimals up to 2-3.
// - Percentages: fixed 0%, 33%, 67%, 100% labels.
export function formatTickLabels(values: number[], type: ValueType, axisMax: number): string[] {
  if (type === 'percentage') {
    // Map explicit thirds to integers
    return values.map((v) => {
      if (v <= 0.000001) return '0%';
      if (Math.abs(v - 100) < 0.000001) return '100%';
      // 33% and 67% for thirds
      if (Math.abs(v - 100 / 3) < 0.05) return '33%';
      if (Math.abs(v - 200 / 3) < 0.05) return '67%';
      return `${Math.round(v)}%`;
    });
  }

  // For currency and number, try increasing decimals until labels are unique or we hit cap
  const isCurrency = type === 'currency';
  const maxDecimals = 3;
  let decimals = axisMax < 3 ? 2 : 0; // start rule

  const makeLabel = (v: number, d: number): string => {
    if (isCurrency) {
      if (v >= 1_000_000_000_000) return `$${(v / 1_000_000_000_000).toFixed(Math.min(2, d))}T`;
      if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(Math.min(2, d))}B`;
      if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(Math.min(2, d))}M`;
      if (v >= 1_000) return `$${(v / 1_000).toFixed(Math.min(2, d))}k`;
      // < 1000: format as currency but control decimals
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
    }
    // numbers: integers with thousands separators unless decimals needed
    if (d === 0) return Math.round(v).toLocaleString('en-US');
    return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  const labelsFor = (d: number) => values.map(v => makeLabel(v, d));

  let labels = labelsFor(decimals);
  const seen = new Set<string>();
  let hasDup = false;
  for (const s of labels) {
    if (seen.has(s)) { hasDup = true; break; }
    seen.add(s);
  }
  while (hasDup && decimals < maxDecimals) {
    decimals += 1;
    labels = labelsFor(decimals);
    const seen2 = new Set<string>();
    hasDup = false;
    for (const s of labels) {
      if (seen2.has(s)) { hasDup = true; break; }
      seen2.add(s);
    }
  }
  return labels;
}
