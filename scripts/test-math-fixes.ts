
import { twoProportionZTest } from '../lib/analytics/stats';

// Mock the parseDateFlexible function manually since we can't easily import the internal non-exported function without modifying file
function parseDateFlexibleModel(raw: string): Date | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Try native parse first
  const dNative = new Date(s);
  // Check if native parse worked and string had TZ info
  if (!isNaN(dNative.getTime()) && s.match(/[a-z]{3}|T|Z|[+-]\d/i)) {
     return dNative;
  }

  // Fallback
  s = s.replace(/\b(UTC|GMT|EST|EDT|CST|CDT|PST|PDT)\b/i, '').trim();
  
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(:\d{2})?)?$/ .test(s)) {
    const [datePart, timePart] = s.split(/\s+/);
    const [mm, dd, yyyy] = datePart.split('/');
    const year = Number(yyyy.length === 2 ? (Number(yyyy) > 70 ? '19' + yyyy : '20' + yyyy) : yyyy);
    const month = Number(mm) - 1;
    const day = Number(dd);
    let hours = 0, mins = 0, secs = 0;
    if (timePart) {
      const tParts = timePart.split(':');
      hours = Number(tParts[0] || 0);
      mins = Number(tParts[1] || 0);
      secs = Number(tParts[2] || 0);
    }
    const d = new Date(Date.UTC(year, month, day, hours, mins, secs));
    if (!isNaN(d.getTime())) return d;
  }
  
  // Refined Fallback
  const d3 = new Date(s + ' UTC');
  if (!isNaN(d3.getTime())) return d3;

  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2;
  return null;
}

console.log('--- Testing Date Parsing Logic ---');

const cases = [
  { input: "10/27/2023 5:00 PM EST", desc: "US Date with EST (should parse as true instant if possible, or fallback)" },
  { input: "10/27/2023 5:00 PM", desc: "US Date without TZ (should parse as Wall Clock UTC)" },
  { input: "2023-11-14T15:30:00-05:00", desc: "ISO with Offset (should parse distinct from UTC)" },
  { input: "2023-11-14T15:30:00Z", desc: "ISO UTC" }
];

cases.forEach(c => {
  const d = parseDateFlexibleModel(c.input);
  if (d) {
    console.log(`[PASS] ${c.desc}: Input="${c.input}" -> ISO=${d.toISOString()} (UTC)`);
  } else {
    console.error(`[FAIL] ${c.desc}: Input="${c.input}" -> null`);
  }
});

console.log('\n--- Testing Statistical Logic ---');

// Case 1: Insignificant difference (small sample)
// A: 100 sent, 20 opens (20%)
// B: 100 sent, 22 opens (22%)
const res1 = twoProportionZTest({ success: 22, total: 100 }, { success: 20, total: 100 });
console.log(`Case 1 (Noise): 22/100 vs 20/100. p-value=${res1.p.toFixed(4)}. Significant (<0.05)? ${res1.p < 0.05}`);

// Case 2: Significant difference (large sample)
// A: 10000 sent, 2000 opens (20%)
// B: 10000 sent, 2200 opens (22%)
const res2 = twoProportionZTest({ success: 2200, total: 10000 }, { success: 2000, total: 10000 });
console.log(`Case 2 (Real): 2200/10000 vs 2000/10000. p-value=${res2.p.toFixed(4)}. Significant (<0.05)? ${res2.p < 0.05}`);

// Case 3: Significant difference (small sample but huge effect)
// A: 100 sent, 10 opens (10%)
// B: 100 sent, 50 opens (50%)
const res3 = twoProportionZTest({ success: 50, total: 100 }, { success: 10, total: 100 });
console.log(`Case 3 (Huge Gap): 50/100 vs 10/100. p-value=${res3.p.toFixed(4)}. Significant (<0.05)? ${res3.p < 0.05}`);

