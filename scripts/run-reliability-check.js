// Minimal localized computeReliability variant to validate window expansion/fallback behavior
function median(nums) { if (!nums.length) return 0; const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function computeReliabilityLocal(periods, options) {
    const { windowSize = 12, minPeriods = 4, scope = 'all' } = options;
    const series = periods.map(p => p.totalRevenue);
    const completeSeries = series; // all weeks in this synthetic test are complete
    if (completeSeries.length < minPeriods) return { reliability: null };

    let useWindow = completeSeries.slice(-windowSize);
    const desiredNonZero = Math.min(3, Math.max(1, Math.floor(windowSize / 4)));
    let nonZeroCount = useWindow.filter(n => n > 0).length;
    if (nonZeroCount < desiredNonZero && completeSeries.length > useWindow.length) {
        let startIdx = Math.max(0, completeSeries.length - windowSize) - 1;
        while (startIdx >= 0 && nonZeroCount < desiredNonZero) {
            if (completeSeries[startIdx] > 0) nonZeroCount++;
            startIdx--;
        }
        const newStart = Math.max(0, startIdx + 1);
        useWindow = completeSeries.slice(newStart);
    }

    const positiveValues = useWindow.filter(n => n > 0);
    let valuesForMedian = positiveValues.length ? positiveValues : useWindow;
    if (valuesForMedian.length && valuesForMedian.every(v => v === 0) && completeSeries.some(v => v > 0)) {
        const lastNonZeros = completeSeries.filter(v => v > 0);
        const fallback = lastNonZeros.slice(-Math.min(lastNonZeros.length, windowSize));
        if (fallback.length) valuesForMedian = fallback;
    }

    const med = median(valuesForMedian);
    const mad = median(useWindow.map(v => Math.abs(v - med)));
    const robustCv = med > 0 ? mad / med : Infinity;
    const k = 1.15;
    const raw = med > 0 ? Math.exp(-k * robustCv) : 0;
    const reliability = med > 0 ? Math.round(raw * 100) : 0;
    return { reliability, median: med, mad, useWindowLength: useWindow.length };
}

// Build synthetic weekly periods: 26 weeks, 25 zeros and one non-zero in the middle
const weeks = [];
const now = new Date();
for (let i = 0; i < 26; i++) {
    const wk = {
        weekStart: new Date(now.getTime() - (26 - i) * 7 * 24 * 3600 * 1000),
        label: `W${i}`,
        totalRevenue: 0,
        campaignRevenue: 0,
        flowRevenue: 0,
        daySet: new Set(),
        isCompleteWeek: true
    };
    weeks.push(wk);
}
// Put a single non-zero at index 5 (older)
weeks[5].totalRevenue = 10634.61997;
weeks[5].campaignRevenue = 10634.61997;

const result = computeReliabilityLocal(weeks, { scope: 'all', windowSize: 12, minPeriods: 4 });
console.log('Result:', result);
