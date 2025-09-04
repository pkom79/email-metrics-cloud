// Centralized date parsing & auditing utilities for imported CSV data.
// Goal: mitigate silent mis-parsing (e.g. two‑digit years interpreted as 2001)
// and surface anomalies (very old years) that break benchmarking look‑backs.

export interface DateAuditSummary {
  min?: Date;
  max?: Date;
  yearCounts: Record<string, number>;
  total: number;
  suspicious: boolean; // true if we detected unusually old years (<2015) while also having recent years
  note?: string;
}

// Attempt to parse a date string coming from Klaviyo CSV exports.
// Returns null if parsing fails. Does NOT fall back to current date (callers can decide).
export function parseMetricDate(raw: any): Date | null {
  if (raw === undefined || raw === null) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  let str = String(raw).trim();
  if (!str) return null;

  // Epoch milliseconds / seconds
  if (/^\d{10,13}$/.test(str)) {
    const num = parseInt(str, 10);
    const d = new Date(str.length === 13 ? num : num * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  // Common CSV formats: YYYY-MM-DD, MM/DD/YYYY, M/D/YY, YYYY/MM/DD, Month D, YYYY
  // Normalize commas
  str = str.replace(/,/g, '');

  // M/D/YY or MM/DD/YY
  let m = str.match(/^([0-1]?\d)[/-]([0-3]?\d)[/-](\d{2})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    year = 2000 + year; // assume 2000s
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  m = str.match(/^(\d{4})[/-]([0-1]?\d)[/-]([0-3]?\d)$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (!isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY
  m = str.match(/^([0-1]?\d)[/-]([0-3]?\d)[/-](\d{4})$/);
  if (m) {
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback to native Date parser (last resort)
  const native = new Date(str);
  if (!isNaN(native.getTime())) return native;
  return null;
}

export function auditDates(dates: Date[]): DateAuditSummary {
  const out: DateAuditSummary = { yearCounts: {}, total: 0, suspicious: false };
  for (const d of dates) {
    if (!(d instanceof Date) || isNaN(d.getTime())) continue;
    out.total++;
    if (!out.min || d < out.min) out.min = d;
    if (!out.max || d > out.max) out.max = d;
    const y = d.getFullYear();
    out.yearCounts[y] = (out.yearCounts[y] || 0) + 1;
  }
  if (out.min && out.max) {
    const years = Object.keys(out.yearCounts).map(y => parseInt(y, 10));
    const recentYear = new Date().getFullYear();
    const hasRecent = years.some(y => y >= recentYear - 2);
    const hasVeryOld = years.some(y => y < 2015);
    if (hasRecent && hasVeryOld) {
      out.suspicious = true;
      out.note = 'Detected mix of very old (<2015) and recent years; possible parsing issue (e.g. two-digit years).';
    } else if (!hasRecent && hasVeryOld) {
      out.suspicious = true;
      out.note = 'All dates appear old (<2015); verify CSV year formatting.';
    }
  }
  return out;
}
