export interface BenchmarkRange {
    good: { min?: number; max?: number };
    ok: { min?: number; max?: number };
    attention: { min?: number; max?: number };
    critical: { min?: number; max?: number };
}

export interface BenchmarkResult {
    status: 'good' | 'ok' | 'attention' | 'critical';
    label: string;
    color: string;
}

// Benchmark definitions for campaign metrics
export const campaignBenchmarks: Record<string, BenchmarkRange> = {
    revenuePerEmail: {
        good: { min: 0.15 },
        ok: { min: 0.08, max: 0.15 },
        attention: { min: 0.05, max: 0.08 },
        critical: { max: 0.05 }
    },
    openRate: {
        good: { min: 22 },
        ok: { min: 15, max: 22 },
        attention: { min: 10, max: 15 },
        critical: { max: 10 }
    },
    clickRate: {
        good: { min: 3 },
        ok: { min: 2, max: 3 },
        attention: { min: 1, max: 2 },
        critical: { max: 1 }
    },
    clickToOpenRate: {
        good: { min: 15 },
        ok: { min: 10, max: 15 },
        attention: { min: 7, max: 10 },
        critical: { max: 7 }
    },
    conversionRate: {
        good: { min: 2 },
        ok: { min: 1, max: 2 },
        attention: { min: 0.5, max: 1 },
        critical: { max: 0.5 }
    },
    unsubscribeRate: {
        good: { max: 0.2 },
        ok: { min: 0.2, max: 0.4 },
        attention: { min: 0.4, max: 0.6 },
        critical: { min: 0.6 }
    },
    spamRate: {
        good: { max: 0.02 },
        ok: { min: 0.02, max: 0.05 },
        attention: { min: 0.05, max: 0.1 },
        critical: { min: 0.1 }
    },
    bounceRate: {
        good: { max: 1 },
        ok: { min: 1, max: 2 },
        attention: { min: 2, max: 3 },
        critical: { min: 3 }
    }
};

// Helper function to check if a value falls within a range
function isInRange(value: number, range: { min?: number; max?: number }): boolean {
    const withinMin = range.min === undefined || value >= range.min;
    const withinMax = range.max === undefined || value < range.max;
    return withinMin && withinMax;
}

// Function to get benchmark status for a given metric
export function getBenchmarkStatus(metricKey: string, value: number): BenchmarkResult | null {
    const benchmark = campaignBenchmarks[metricKey];
    if (!benchmark) return null;

    if (isInRange(value, benchmark.good)) {
        return { status: 'good', label: 'Good', color: 'text-green-600 dark:text-green-400' };
    } else if (isInRange(value, benchmark.ok)) {
        return { status: 'ok', label: 'OK', color: 'text-blue-600 dark:text-blue-400' };
    } else if (isInRange(value, benchmark.attention)) {
        return { status: 'attention', label: 'Attention Needed', color: 'text-yellow-600 dark:text-yellow-400' };
    } else if (isInRange(value, benchmark.critical)) {
        return { status: 'critical', label: 'Critical', color: 'text-red-600 dark:text-red-400' };
    }

    return null;
}

// Helper function to parse formatted values back to numbers
export function parseMetricValue(formattedValue: string): number {
    // Remove currency symbols, commas, and percentage signs
    const cleaned = formattedValue.replace(/[$,%\s]/g, '');
    return parseFloat(cleaned) || 0;
}
