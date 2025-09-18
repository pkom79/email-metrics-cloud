import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '../../../lib/supabase/auth';
import { createServiceClient } from '../../../lib/supabase/server';
import { ingestBucketName } from '../../../lib/storage/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FileProbe = {
  type: 'campaigns' | 'flows' | 'subscribers';
  tried: { bucket: string; path: string; ok: boolean; size?: number }[];
  chosen?: { bucket: string; path: string; size: number };
  minDate?: string | null;
  maxDate?: string | null;
  tail?: string[];
};

function parseDateStrict(value: any): Date | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') { const ms = value > 1e12 ? value : (value > 1e10 ? value * 100 : value * 1000); const d = new Date(ms); return isNaN(d.getTime()) ? null : d; }
    let s = String(value).trim(); if (!s) return null;
    s = s.replace(/,/g, ' ').replace(/\bat\b/ig, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/\b(UTC|GMT|EST|EDT|CST|CDT|PST|PDT)\b/ig, '').trim();
    s = s.replace(/\([^)]+\)/g, '').trim();
    s = s.replace(/([+-]\d{2}:?\d{2})$/, '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + 'T00:00:00Z'); return isNaN(d.getTime()) ? null : d; }
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/);
    if (mdy) { const mm = +mdy[1], dd = +mdy[2], yy = +mdy[3]; const year = mdy[3].length === 2 ? (yy > 70 ? 1900 + yy : 2000 + yy) : yy; const d = new Date(Date.UTC(year, mm - 1, dd)); return isNaN(d.getTime()) ? null : d; }
    const d1 = new Date(s); if (!isNaN(d1.getTime())) return d1;
    const dz = new Date(s + 'Z'); if (!isNaN(dz.getTime())) return dz;
    return null;
  } catch { return null; }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function analyzeCsv(text: string, type: 'campaigns' | 'flows' | 'subscribers') {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { minDate: null as string | null, maxDate: null as string | null, tail: [] as string[] };
  const header = splitCsvLine(lines[0]);
  const lower = header.map(h => h.toLowerCase());
  const dateCandidates = type === 'flows' ? ['day'] : type === 'campaigns' ? [
    'message send date time', 'send time', 'send time (utc)', 'send date', 'sent at', 'send date (utc)', 'send date (gmt)', 'date'
  ] : ['profilecreated', 'created', 'date'];
  let idx = -1;
  for (let i = 0; i < lower.length; i++) {
    const cell = lower[i].replace(/^\"|\"$/g, '').trim();
    if (dateCandidates.includes(cell)) { idx = i; break; }
  }
  // Fallback: many flow exports have date as first column labelled variably; if we still didn't find, assume column 0
  if (idx === -1 && (type === 'flows' || type === 'campaigns')) idx = 0;
  let minT = Infinity; let maxT = -Infinity;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const raw = idx >= 0 ? cols[idx] : undefined;
    const d = parseDateStrict(raw);
    if (!d) continue;
    const t = d.getTime();
    if (t < minT) minT = t; if (t > maxT) maxT = t;
  }
  const minDate = isFinite(minT) ? new Date(minT).toISOString() : null;
  const maxDate = isFinite(maxT) ? new Date(maxT).toISOString() : null;
  const tail = lines.slice(Math.max(0, lines.length - 3));
  return { minDate, maxDate, tail };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createServiceClient();
    const { data: acct } = await supabase.from('accounts').select('id').eq('owner_user_id', user.id).maybeSingle();
    const accountId = (acct as any)?.id as string | undefined;
    if (!accountId) return NextResponse.json({ error: 'NoAccount' }, { status: 404 });

    const { data: snap } = await supabase
      .from('snapshots')
      .select('id, created_at, last_email_date, upload_id, label, status')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snap) return NextResponse.json({ error: 'NoSnapshot' }, { status: 404 });

    const ingest = ingestBucketName();
    const fileTypes: Array<'campaigns' | 'flows' | 'subscribers'> = ['campaigns', 'flows', 'subscribers'];
    const probes: Record<string, FileProbe> = {};

    for (const type of fileTypes) {
      const tried: FileProbe['tried'] = [];
      let chosen: FileProbe['chosen'];
      const candidates = [
        { bucket: ingest, path: `${snap.upload_id}/${type}.csv` },
        { bucket: 'uploads', path: `${accountId}/${snap.upload_id}/${type}.csv` },
        { bucket: 'csv-uploads', path: `${accountId}/${snap.upload_id}/${type}.csv` },
      ];
      for (const c of candidates) {
        const res = await supabase.storage.from(c.bucket).download(c.path);
        if (res.data) {
          const blob = res.data as Blob; const size = (blob as any).size || 0;
          tried.push({ bucket: c.bucket, path: c.path, ok: true, size });
          chosen = { bucket: c.bucket, path: c.path, size };
          // analyze text
          const text = await blob.text();
          const analysis = await analyzeCsv(text, type);
          probes[type] = { type, tried, chosen, minDate: analysis.minDate, maxDate: analysis.maxDate, tail: analysis.tail };
          break;
        } else {
          tried.push({ bucket: c.bucket, path: c.path, ok: false });
        }
      }
      if (!probes[type]) probes[type] = { type, tried } as any;
    }

    return NextResponse.json({
      ok: true,
      env: { vercel: !!process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV || null },
      accountId,
      snapshot: snap,
      ingestBucket: ingest,
      files: probes,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}
