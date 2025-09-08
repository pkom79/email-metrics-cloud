// Shared helpers for axis domain, tick generation, and tick label formatting

export type ValueType = 'currency' | 'number' | 'percentage';

// Compute an axis max using raw data (no "nice" rounding).
export function computeAxisMax(values: number[], compareValues: number[] | null | undefined, type: ValueType): number {
  let raw = 0;
  for (const v of values) if (Number.isFinite(v) && v > raw) raw = v;
  if (compareValues) for (const v of compareValues) if (Number.isFinite(v) && v > raw) raw = v;
  if (!Number.isFinite(raw) || raw <= 0) raw = 1; // fallback to avoid divide-by-zero
  // Return raw max as requested (no nice rounding)
  return raw;
}

// Thirds tick values for the given axis max (0, 1/3, 2/3, max)
export function thirdTicks(axisMax: number, type: ValueType): number[] {
  return [0, axisMax / 3, (2 * axisMax) / 3, axisMax];
}

// Format an array of tick values into axis labels following rules:
// - Axis ticks only use compact formatting for currency (K/M/B/T) with $.
// - No decimals by default. If axisMax < 3 or labels would collide after rounding, increase decimals up to 2-3.
// - Percentages: fixed 0%, 33%, 67%, 100% labels.
export function formatTickLabels(values: number[], type: ValueType, axisMax: number): string[] {
  if (type === 'percentage') {
    // Percentages: dynamic thirds of actual max; remove stray decimals
    // Start decimals: 0, but if tiny range then increase (axisMax < 3 => 1, axisMax < 1 => 2)
    let decimals = 0;
    if (axisMax < 1) decimals = 2; else if (axisMax < 3) decimals = 1;
    const maxDecimals = 3;
    const makePct = (v: number, d: number) => {
      if (d === 0) return `${Math.round(v)}%`;
      const rounded = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
      return `${rounded.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
    };
    const labelsFor = (d: number) => values.map(v => makePct(v, d));
    let labels = labelsFor(decimals);
    // Ensure uniqueness after rounding; bump decimals if colliding
    let hasDup = true; let d = decimals;
    while (hasDup && d < maxDecimals) {
      const seen = new Set<string>(); hasDup = false;
      for (const s of labels) { if (seen.has(s)) { hasDup = true; break; } seen.add(s); }
      if (hasDup) { d += 1; labels = labelsFor(d); }
    }
    return labels;
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
    // numbers: compact to K/M/B/T for consistency
    if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(Math.min(2, d))}T`;
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(Math.min(2, d))}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(Math.min(2, d))}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(Math.min(2, d))}k`;
    // < 1000: use integer or small decimals if needed
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
