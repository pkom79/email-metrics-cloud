import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../lib/supabase/server';
import { ingestBucketName } from '../../../../lib/storage/ingest';
import { getServerUser } from '../../../../lib/supabase/auth';
import Papa from 'papaparse';
import { CampaignTransformer } from '../../../../lib/data/transformers/campaignTransformer';
import { FlowTransformer } from '../../../../lib/data/transformers/flowTransformer';

export const runtime = 'nodejs';

// Server-side snapshot processing: parses stored CSVs and writes aggregate + daily series
// Idempotent: existing totals/series for snapshot are replaced
export async function POST(request: Request) {
    try {
        const startedAt = Date.now();
        const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;
        const providedSecret = (request.headers.get('x-admin-job-secret') || '').trim();
        const adminBypass = !!ADMIN_SECRET && providedSecret === ADMIN_SECRET;

        // Require either a logged-in user or admin bypass via secret
        let user: any = null;
        if (!adminBypass) {
            user = await getServerUser();
            if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const supabase = createServiceClient();
        const { snapshotId: bodySnapshotId, uploadId: bodyUploadId } = await request.json().catch(() => ({}));
        if (!bodySnapshotId && !bodyUploadId) return NextResponse.json({ error: 'snapshotId or uploadId required' }, { status: 400 });

        // Resolve snapshot + upload
        let snapshotId: string | null = null; let uploadId: string | null = null; let accountId: string | null = null;
        if (bodySnapshotId) {
            const { data: snap, error: snapErr } = await supabase
                .from('snapshots')
                .select('id,upload_id,account_id')
                .eq('id', bodySnapshotId)
                .maybeSingle();
            if (snapErr) throw snapErr;
            if (!snap) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
            snapshotId = snap.id; uploadId = (snap as any).upload_id; accountId = (snap as any).account_id;
        } else if (bodyUploadId) {
            // Find snapshot by upload
            const { data: snap, error: snapErr } = await supabase
                .from('snapshots')
                .select('id,upload_id,account_id')
                .eq('upload_id', bodyUploadId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (snapErr) throw snapErr;
            if (!snap) return NextResponse.json({ error: 'Snapshot for upload not found' }, { status: 404 });
            snapshotId = snap.id; uploadId = (snap as any).upload_id; accountId = (snap as any).account_id;
        }
        if (!snapshotId || !uploadId) return NextResponse.json({ error: 'Snapshot linkage missing' }, { status: 400 });

        // Basic ownership check (service role bypasses RLS so manually assert owner)
        if (!adminBypass) {
            const { data: acct, error: acctErr } = await supabase
                .from('accounts')
                .select('owner_user_id')
                .eq('id', accountId!)
                .maybeSingle();
            if (acctErr) throw acctErr;
            if (!acct || (acct as any).owner_user_id !== user.id) {
                // Allow admin role
                const isAdmin = user.app_metadata?.role === 'admin';
                if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const bucket = ingestBucketName();
        // Mark snapshot as processing
        try { await supabase.from('snapshots').update({ status: 'processing', last_error: null }).eq('id', snapshotId!); } catch {}
        const requiredFiles = ['campaigns.csv', 'flows.csv', 'subscribers.csv'] as const;
        const texts: Record<string, string> = {};
        for (const fname of requiredFiles) {
            const { data: file, error: dlErr } = await supabase.storage.from(bucket).download(`${uploadId}/${fname}`);
            if (dlErr) throw dlErr;
            if (!file) return NextResponse.json({ error: `Missing ${fname}` }, { status: 400 });
            texts[fname] = await file.text();
        }

        // Parse campaigns & subscribers (header true), flows (custom like client)
        const parseCsv = <T extends Record<string, any>>(csv: string, header: boolean, flowMode = false): T[] => {
            if (flowMode) {
                const parsed = Papa.parse<any[]>(csv, { header: false, skipEmptyLines: true });
                const rows = parsed.data as any[][];
                if (rows.length <= 3) return [] as T[];
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(10, rows.length); i++) { if (rows[i][0] === 'Day') { headerRowIndex = i; break; } }
                const headers = headerRowIndex >= 0 ? rows[headerRowIndex] : rows[2];
                const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 3;
                const data: T[] = [];
                for (let i = startRow; i < rows.length; i++) {
                    const row = rows[i]; if (!row || row.length === 0) continue;
                    const obj: any = {}; headers.forEach((h: string, idx: number) => { if (h) obj[h] = row[idx]; });
                    data.push(obj as T);
                }
                return data;
            }
            const parsed = Papa.parse<T>(csv, { header, skipEmptyLines: true, dynamicTyping: true });
            return (parsed.data || []).filter(r => Object.keys(r || {}).length > 0) as T[];
        };

        const rawCampaigns = parseCsv<any>(texts['campaigns.csv'], true);
        const rawFlows = parseCsv<any>(texts['flows.csv'], false, true);
        // Subscribers not used for current metrics, skip heavy processing to reduce CPU
        // const rawSubscribers = parseCsv<any>(texts['subscribers.csv'], true);

        // Transform using existing transformers (subset metrics needed)
        const campaignTransformer = new CampaignTransformer();
        const flowTransformer = new FlowTransformer();
        const processedCampaigns = campaignTransformer.transform(rawCampaigns as any);
        const processedFlows = flowTransformer.transform(rawFlows as any);

        // Aggregate daily (reuse simple logic similar to DataManager _rebuildDailyAggregates)
        type Daily = { revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number; };
        const daily: Record<string, Daily> = {};
        const push = (d: Date, obj: Daily) => {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!daily[key]) daily[key] = { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0 };
            const rec = daily[key];
            rec.revenue += obj.revenue; rec.emailsSent += obj.emailsSent; rec.totalOrders += obj.totalOrders; rec.uniqueOpens += obj.uniqueOpens; rec.uniqueClicks += obj.uniqueClicks; rec.unsubscribesCount += obj.unsubscribesCount; rec.spamComplaintsCount += obj.spamComplaintsCount; rec.bouncesCount += obj.bouncesCount;
        };
        processedCampaigns.forEach(c => push(c.sentDate, c));
        processedFlows.forEach(f => push(f.sentDate, f));

        // Prepare totals for NEW data only (we may merge with previous snapshot below)
        const allEmails = [...processedCampaigns, ...processedFlows];
        const sum = (k: keyof Daily) => Object.values(daily).reduce((s, d) => s + (d as any)[k], 0);
        const totalRevenueNew = sum('revenue');
        const totalEmailsSentNew = sum('emailsSent');
        const totalOrdersNew = sum('totalOrders');
        const totalOpensNew = sum('uniqueOpens');
        const totalClicksNew = sum('uniqueClicks');
        const totalUnsubsNew = sum('unsubscribesCount');
        const totalSpamNew = sum('spamComplaintsCount');
        const totalBouncesNew = sum('bouncesCount');

        // Determine earliest new date (for historical carry-forward)
        const newDates = Object.keys(daily).sort();
        const earliestNewDate = newDates.length ? newDates[0] : null;

        // Optionally merge with the most recent previous snapshot for this account to preserve history
        let carrySeries: Array<{ metric_key: string; date: string; value: number }> = [];
    let priorTotals: Record<string, number> = {};
        let priorLastEmailDate: string | null = null;
        if (earliestNewDate) {
            const { data: prevSnapList, error: prevErr } = await supabase
                .from('snapshots')
                .select('id,last_email_date')
                .eq('account_id', accountId!)
                .neq('id', snapshotId)
                .order('created_at', { ascending: false })
                .limit(1);
            if (prevErr) throw prevErr;
            const prevSnap = (prevSnapList && prevSnapList[0]) || null;
            if (prevSnap?.id) {
                priorLastEmailDate = (prevSnap as any).last_email_date || null;
                // Carry forward series strictly before the earliest new date
                const { data: prevSeries, error: prevSeriesErr } = await supabase
                    .from('snapshot_series')
                    .select('metric_key,date,value')
                    .eq('snapshot_id', prevSnap.id)
                    .lt('date', earliestNewDate);
                if (prevSeriesErr) throw prevSeriesErr;
                carrySeries = (prevSeries || []).map((r: any) => ({ metric_key: r.metric_key as string, date: r.date as string, value: Number(r.value) }));

                // Derive prior base totals strictly from carried series to avoid double counting overlap
                const keys = ['totalRevenue','emailsSent','totalOrders','uniqueOpens','uniqueClicks','unsubscribesCount','spamComplaintsCount','bouncesCount'] as const;
                for (const k of keys) {
                    priorTotals[k] = carrySeries.filter(r => r.metric_key === k).reduce((s, r) => s + Number(r.value || 0), 0);
                }
            }
        }

        // Transaction-like: delete existing derived data then insert
        await supabase.from('snapshot_totals').delete().eq('snapshot_id', snapshotId);
        await supabase.from('snapshot_series').delete().eq('snapshot_id', snapshotId);

        // Build combined totals (previous + new)
    const combinedRevenue = (priorTotals['totalRevenue'] || 0) + totalRevenueNew;
    const combinedEmails = (priorTotals['emailsSent'] || 0) + totalEmailsSentNew;
    const combinedOrders = (priorTotals['totalOrders'] || 0) + totalOrdersNew;
    const combinedOpens = (priorTotals['uniqueOpens'] || 0) + totalOpensNew;
    const combinedClicks = (priorTotals['uniqueClicks'] || 0) + totalClicksNew;
    const combinedUnsubs = (priorTotals['unsubscribesCount'] || 0) + totalUnsubsNew;
    const combinedSpam = (priorTotals['spamComplaintsCount'] || 0) + totalSpamNew;
    const combinedBounces = (priorTotals['bouncesCount'] || 0) + totalBouncesNew;
        const combinedAvgOrderValue = combinedOrders > 0 ? combinedRevenue / combinedOrders : 0;
        const combinedRevenuePerEmail = combinedEmails > 0 ? combinedRevenue / combinedEmails : 0;
        const combinedOpenRate = combinedEmails > 0 ? (combinedOpens / combinedEmails) * 100 : 0;
        const combinedClickRate = combinedEmails > 0 ? (combinedClicks / combinedEmails) * 100 : 0;
        const combinedCTOR = combinedOpens > 0 ? (combinedClicks / combinedOpens) * 100 : 0;
        const combinedConversionRate = combinedClicks > 0 ? (combinedOrders / combinedClicks) * 100 : 0;
        const combinedUnsubRate = combinedEmails > 0 ? (combinedUnsubs / combinedEmails) * 100 : 0;
        const combinedSpamRate = combinedEmails > 0 ? (combinedSpam / combinedEmails) * 100 : 0;
        const combinedBounceRate = combinedEmails > 0 ? (combinedBounces / combinedEmails) * 100 : 0;

        const totalsInserts = [
            ['totalRevenue', combinedRevenue], ['emailsSent', combinedEmails], ['totalOrders', combinedOrders],
            ['openRate', combinedOpenRate], ['clickRate', combinedClickRate], ['clickToOpenRate', combinedCTOR],
            ['conversionRate', combinedConversionRate], ['unsubscribeRate', combinedUnsubRate], ['spamRate', combinedSpamRate],
            ['bounceRate', combinedBounceRate], ['avgOrderValue', combinedAvgOrderValue], ['revenuePerEmail', combinedRevenuePerEmail],
            // Store base counts as well for transparency
            ['uniqueOpens', combinedOpens], ['uniqueClicks', combinedClicks], ['unsubscribesCount', combinedUnsubs], ['spamComplaintsCount', combinedSpam], ['bouncesCount', combinedBounces]
        ].map(([metric_key, value]) => ({ snapshot_id: snapshotId, metric_key, value }));
        if (totalsInserts.length) await supabase.from('snapshot_totals').insert(totalsInserts as any);

        const seriesInserts: any[] = [];
        // Carry forward previous snapshot series (dates before earliest new date)
        for (const r of carrySeries) {
            seriesInserts.push({ snapshot_id: snapshotId, metric_key: r.metric_key, date: r.date, value: r.value });
        }
        Object.entries(daily).forEach(([date, d]) => {
            const mk = (k: string, v: number) => seriesInserts.push({ snapshot_id: snapshotId, metric_key: k, date, value: v });
            mk('totalRevenue', d.revenue);
            mk('emailsSent', d.emailsSent);
            mk('totalOrders', d.totalOrders);
            mk('openRate', d.emailsSent > 0 ? (d.uniqueOpens / d.emailsSent) * 100 : 0);
            mk('clickRate', d.emailsSent > 0 ? (d.uniqueClicks / d.emailsSent) * 100 : 0);
            mk('clickToOpenRate', d.uniqueOpens > 0 ? (d.uniqueClicks / d.uniqueOpens) * 100 : 0);
            mk('conversionRate', d.uniqueClicks > 0 ? (d.totalOrders / d.uniqueClicks) * 100 : 0);
            mk('unsubscribeRate', d.emailsSent > 0 ? (d.unsubscribesCount / d.emailsSent) * 100 : 0);
            mk('spamRate', d.emailsSent > 0 ? (d.spamComplaintsCount / d.emailsSent) * 100 : 0);
            mk('bounceRate', d.emailsSent > 0 ? (d.bouncesCount / d.emailsSent) * 100 : 0);
            mk('avgOrderValue', d.totalOrders > 0 ? d.revenue / d.totalOrders : 0);
            mk('revenuePerEmail', d.emailsSent > 0 ? d.revenue / d.emailsSent : 0);
        });
        if (seriesInserts.length) {
            // Chunk inserts to avoid row limits
            const chunkSize = 500;
            for (let i = 0; i < seriesInserts.length; i += chunkSize) {
                const chunk = seriesInserts.slice(i, i + chunkSize);
                await supabase.from('snapshot_series').insert(chunk as any);
            }
        }

        // Compute last email date (consider previous snapshot if newer)
        const lastEmailDateNew = allEmails.length ? new Date(Math.max(...allEmails.map(e => e.sentDate.getTime()))) : null;
        let finalLastEmailDate = lastEmailDateNew ? lastEmailDateNew.toISOString().slice(0, 10) : null;
        if (priorLastEmailDate) {
            if (!finalLastEmailDate || priorLastEmailDate > finalLastEmailDate) finalLastEmailDate = priorLastEmailDate;
        }
        if (!finalLastEmailDate) finalLastEmailDate = new Date().toISOString().slice(0, 10);
        await supabase.from('snapshots').update({ last_email_date: finalLastEmailDate, status: 'processed', last_error: null, updated_at: new Date().toISOString() as any }).eq('id', snapshotId);

        return NextResponse.json({ ok: true, processed: true, snapshotId, ms: Date.now() - startedAt });
    } catch (e: any) {
        try {
            const supabase = createServiceClient();
            const { snapshotId } = await (async () => { try { const j = await request.json(); return j || {}; } catch { return {}; } })();
            if (snapshotId) await supabase.from('snapshots').update({ status: 'failed', last_error: String(e?.message || e) }).eq('id', snapshotId);
        } catch {}
        return NextResponse.json({ error: e?.message || 'Processing failed' }, { status: 500 });
    }
}
