// Adaptive benchmarking removed. Minimal stub retained to avoid import errors.
export interface BenchmarkResult {
  metric: string;
  value: number;
  valueType: 'count' | 'rate' | 'currency' | 'ratio';
  tier: null;
  diff: null;
  diffType: null;
  baseline: null;
  lookbackDays: number;
  keptDays: number;
  hiddenReason?: string;
}

export function useBenchmark(): null { return null; }
export function getBenchmark(): null { return null; }
