import { supabaseAdmin, CSV_BUCKETS } from './supabaseAdmin';
import { buildSnapshotJSON } from './snapshotBuilder';

interface BuildOpts { snapshotId: string; accountId: string; uploadId: string; rangeStart?: string; rangeEnd?: string; granularity?: string; compareMode?: string; }

// Reuse existing builder then prune to required sections and embed filter metadata
export async function buildReducedSnapshot(opts: BuildOpts) {
  const full = await buildSnapshotJSON({ snapshotId: opts.snapshotId, accountId: opts.accountId, uploadId: opts.uploadId, rangeStart: opts.rangeStart, rangeEnd: opts.rangeEnd });
  const { audienceOverview, emailPerformance, flows, campaigns } = full;
  const reduced = {
    meta: {
      snapshotId: full.meta.snapshotId,
      generatedAt: new Date().toISOString(),
      accountId: full.meta.accountId,
      uploadId: full.meta.uploadId,
      dateRange: full.meta.dateRange,
      granularity: (opts.granularity || 'daily'),
      compareMode: opts.compareMode || 'prev-period',
      compareRange: computeCompareRange(full.meta.dateRange, opts.compareMode),
      sections: [
        ...(audienceOverview ? ['audienceOverview'] : []),
        ...(emailPerformance ? ['emailPerformance'] : []),
        ...(flows ? ['flows'] : []),
        ...(campaigns ? ['campaigns'] : []),
      ]
    },
    audienceOverview,
    emailPerformance,
    flows,
    campaigns
  };
  return reduced;
}

function computeCompareRange(dr: { start: string; end: string }, mode?: string) {
  try {
    if (!dr?.start || !dr?.end) return null;
    const start = new Date(dr.start + 'T00:00:00');
    const end = new Date(dr.end + 'T23:59:59');
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (mode === 'prev-year') {
      const prevStart = new Date(start); prevStart.setFullYear(prevStart.getFullYear() - 1);
      const prevEnd = new Date(prevStart); prevEnd.setDate(prevEnd.getDate() + days - 1);
      return { start: prevStart.toISOString().slice(0,10), end: prevEnd.toISOString().slice(0,10) };
    }
    // prev-period default
    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(0,0,0,0);
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1));
    return { start: prevStart.toISOString().slice(0,10), end: prevEnd.toISOString().slice(0,10) };
  } catch { return null; }
}
