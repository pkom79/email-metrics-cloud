import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const bucket = process.env.AUDIENCE_STAGING_BUCKET || 'audience-staging';
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId') || 'acc_canary_1';
    const uploadId = searchParams.get('uploadId');
    const sample = searchParams.get('sample'); // e.g., 'events'
    const limit = Number(searchParams.get('limit') || '5');
    const prefix = uploadId
      ? `audience-staging/${accountId}/${uploadId}`
      : `audience-staging/${accountId}`;

    // If sampling was requested and an uploadId is present, download the CSV and return sample rows
  if (uploadId && sample === 'events') {
      const objectPath = `${prefix}/subscribers.csv`;
      const { data, error } = await supabase.storage.from(bucket).download(objectPath);
      if (error || !data) {
        return NextResponse.json({ success: false, error: error?.message || 'Download failed', bucket, objectPath }, { status: 500 });
      }
      const text = await (data as Blob).text();
      // Minimal CSV parser that respects quotes
      const parseCsv = (csv: string): { headers: string[]; rows: string[][] } => {
        const lines = csv.split(/\r?\n/).filter(l => l.length);
        const parseLine = (line: string): string[] => {
          const out: string[] = [];
          let cur = '';
          let inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQ) {
              if (ch === '"') {
                if (line[i+1] === '"') { cur += '"'; i++; }
                else { inQ = false; }
              } else {
                cur += ch;
              }
            } else {
              if (ch === '"') inQ = true;
              else if (ch === ',') { out.push(cur); cur = ''; }
              else cur += ch;
            }
          }
          out.push(cur);
          return out;
        };
        const headers = parseLine(lines[0]);
        const rows = lines.slice(1).map(parseLine);
        return { headers, rows };
      };
      const { headers, rows } = parseCsv(text);
      const idx = (name: string) => headers.indexOf(name);
      const col = {
        email: idx('Email'),
        id: idx('Klaviyo ID'),
        firstActive: idx('First Active'),
        lastActive: idx('Last Active'),
        lastOpen: idx('Last Open'),
        lastClick: idx('Last Click'),
        consent: idx('Email Marketing Consent'),
        suppressions: idx('Email Suppressions'),
        suppressionsTs: idx('Email Suppressions Timestamp'),
      };
      const withEvents = rows.filter(r => {
        const fa = r[col.firstActive] || '';
        const lo = r[col.lastOpen] || '';
        const lc = r[col.lastClick] || '';
        return Boolean(fa || lo || lc);
      });
      const sampleRows = withEvents.slice(0, Math.max(1, Math.min(50, limit))).map(r => ({
        email: r[col.email],
        klaviyoId: r[col.id],
        firstActive: r[col.firstActive],
        lastOpen: r[col.lastOpen],
        lastClick: r[col.lastClick],
        consent: r[col.consent],
        lastActive: r[col.lastActive],
      }));
      // Suppression analysis: count rows with any value in suppression columns
      const suppressionNonEmpty = rows.filter(r => {
        const s = col.suppressions >= 0 ? (r[col.suppressions] || '') : '';
        return s.trim() !== '';
      }).length;
      const suppressionSample = rows
        .filter(r => {
          const s = col.suppressions >= 0 ? (r[col.suppressions] || '') : '';
          return s.trim() !== '';
        })
        .slice(0, Math.max(1, Math.min(20, limit)))
        .map(r => ({
          email: r[col.email],
          klaviyoId: r[col.id],
          suppressions: col.suppressions >= 0 ? r[col.suppressions] : undefined,
          suppressionsTimestamp: col.suppressionsTs >= 0 ? r[col.suppressionsTs] : undefined,
        }));
      return NextResponse.json({
        success: true,
        bucket,
        objectPath,
        totalRows: rows.length,
        rowsWithAnyEvent: withEvents.length,
        sample: sampleRows,
        suppressionNonEmpty,
        suppressionSample,
      });
    }

    const { data: list, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100 });
    if (error) {
      return NextResponse.json({ success: false, error: error.message, bucket, prefix }, { status: 500 });
    }
    return NextResponse.json({ success: true, bucket, prefix, items: list });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: String(err?.message || err) }, { status: 500 });
  }
}
