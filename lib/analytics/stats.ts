// Statistical helpers for significance testing and multiple comparisons control

export type TwoProportionInput = { success: number; total: number };

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// Standard normal CDF approximation
function normCdf(z: number): number {
  // Abramowitz and Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const p = d * (0.319381530 * t - 0.356563782 * Math.pow(t, 2) + 1.781477937 * Math.pow(t, 3) - 1.821255978 * Math.pow(t, 4) + 1.330274429 * Math.pow(t, 5));
  return z >= 0 ? 1 - p : p;
}

/** Two-proportion z-test (two-sided). Returns p-value and whether approximation is valid (expected counts >=5). */
export function twoProportionZTest(a: TwoProportionInput, b: TwoProportionInput): { p: number; valid: boolean; z: number } {
  const p1 = a.total > 0 ? a.success / a.total : 0;
  const p2 = b.total > 0 ? b.success / b.total : 0;
  const pPool = (a.success + b.success) / Math.max(1, (a.total + b.total));
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / Math.max(1, a.total) + 1 / Math.max(1, b.total)));
  const expected = [a.total * pPool, a.total * (1 - pPool), b.total * pPool, b.total * (1 - pPool)];
  const valid = expected.every(x => x >= 5);
  if (se === 0) return { p: 1, valid, z: 0 };
  const z = (p1 - p2) / se;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { p: clamp01(p), valid, z };
}

// Fisher's exact test (two-sided) for 2x2 table
// Table:
// [ a  b ]  where a = success in group A, b = failure in group A
// [ c  d ]        c = success in group B, d = failure in group B
function logFactorial(n: number): number {
  // Stirling approximation for large n; exact for small n via loop
  if (n < 2) return 0;
  if (n < 100) { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }
  // Stirling's approximation
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function hypergeomLogProb(a: number, b: number, c: number, d: number): number {
  // Probability of observed table given fixed margins
  const n1 = a + b; // row1 total
  const n2 = c + d; // row2 total
  const m1 = a + c; // col1 total (success)
  const m2 = b + d; // col2 total (failure)
  const N = n1 + n2;
  // P = [C(m1, a) * C(m2, b)] / C(N, n1)
  return logChoose(m1, a) + logChoose(m2, b) - logChoose(N, n1);
}

export function fishersExactTwoSided(a: number, b: number, c: number, d: number): number {
  // Compute p-value by summing probabilities of all tables with probability <= observed
  const n1 = a + b;
  const n2 = c + d;
  const m1 = a + c;
  const minA = Math.max(0, n1 + m1 - (n1 + n2));
  const maxA = Math.min(n1, m1);
  const logObs = hypergeomLogProb(a, b, c, d);
  let sum = 0;
  for (let x = minA; x <= maxA; x++) {
    const y = n1 - x;
    const z = m1 - x;
    const w = n2 - z;
    const lp = hypergeomLogProb(x, y, z, w);
    if (lp <= logObs + 1e-12) {
      sum += Math.exp(lp);
    }
  }
  return clamp01(sum);
}

/** Benjamini–Hochberg FDR adjustment. Returns adjusted p-values in original order. */
export function benjaminiHochberg(pvals: number[]): number[] {
  const n = pvals.length;
  if (n === 0) return [];
  const indexed = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adj: number[] = new Array(n).fill(0);
  let prev = 1;
  for (let k = n; k >= 1; k--) {
    const { p, i } = indexed[k - 1];
    const val = Math.min(prev, (p * n) / k);
    adj[i] = val;
    prev = val;
  }
  return adj.map(clamp01);
}

/** Winsorize array values to given upper percentile (e.g., 0.99). */
export function winsorize(arr: number[], upperPct = 0.99): number[] {
  if (!arr.length) return [];
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(upperPct * (s.length - 1))));
  const cap = s[idx];
  return arr.map(v => (v > cap ? cap : v));
}

export function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  const w = pos - lo;
  return s[lo] * (1 - w) + s[hi] * w;
}

/** Bootstrap 95% CI for difference in means (two-sided). Optional transform applied to data before mean. */
export function bootstrapDiffCI(
  a: number[],
  b: number[],
  iterations = 1000,
  transform?: (x: number[]) => number[]
): { lo: number; hi: number; passed: boolean } {
  if (!a.length || !b.length) return { lo: 0, hi: 0, passed: false };
  const A = transform ? transform(a) : a;
  const B = transform ? transform(b) : b;
  const diffs: number[] = [];
  const randIdx = (n: number) => Math.floor(Math.random() * n);
  for (let i = 0; i < iterations; i++) {
    let sumA = 0, sumB = 0;
    for (let j = 0; j < A.length; j++) sumA += A[randIdx(A.length)];
    for (let j = 0; j < B.length; j++) sumB += B[randIdx(B.length)];
    diffs.push((sumA / A.length) - (sumB / B.length));
  }
  const lo = percentile(diffs, 0.025);
  const hi = percentile(diffs, 0.975);
  return { lo, hi, passed: !(lo <= 0 && hi >= 0) };
}
