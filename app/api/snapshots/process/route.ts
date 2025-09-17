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
        const user = await getServerUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

        const bucket = ingestBucketName();
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

        // Prepare totals
        const allEmails = [...processedCampaigns, ...processedFlows];
        const sum = (k: keyof Daily) => Object.values(daily).reduce((s, d) => s + (d as any)[k], 0);
        const totalRevenue = sum('revenue');
        const totalEmailsSent = sum('emailsSent');
        const totalOrders = sum('totalOrders');
        const totalOpens = sum('uniqueOpens');
        const totalClicks = sum('uniqueClicks');
        const totalUnsubs = sum('unsubscribesCount');
        const totalSpam = sum('spamComplaintsCount');
        const totalBounces = sum('bouncesCount');
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const revenuePerEmail = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
        const openRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0;
        const clickRate = totalEmailsSent > 0 ? (totalClicks / totalEmailsSent) * 100 : 0;
        const clickToOpenRate = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0;
        const conversionRate = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
        const unsubscribeRate = totalEmailsSent > 0 ? (totalUnsubs / totalEmailsSent) * 100 : 0;
        const spamRate = totalEmailsSent > 0 ? (totalSpam / totalEmailsSent) * 100 : 0;
        const bounceRate = totalEmailsSent > 0 ? (totalBounces / totalEmailsSent) * 100 : 0;

        // Transaction-like: delete existing derived data then insert
        await supabase.from('snapshot_totals').delete().eq('snapshot_id', snapshotId);
        await supabase.from('snapshot_series').delete().eq('snapshot_id', snapshotId);

        const totalsInserts = [
            ['totalRevenue', totalRevenue], ['emailsSent', totalEmailsSent], ['totalOrders', totalOrders],
            ['openRate', openRate], ['clickRate', clickRate], ['clickToOpenRate', clickToOpenRate],
            ['conversionRate', conversionRate], ['unsubscribeRate', unsubscribeRate], ['spamRate', spamRate],
            ['bounceRate', bounceRate], ['avgOrderValue', avgOrderValue], ['revenuePerEmail', revenuePerEmail]
        ].map(([metric_key, value]) => ({ snapshot_id: snapshotId, metric_key, value }));
        if (totalsInserts.length) await supabase.from('snapshot_totals').insert(totalsInserts as any);

        const seriesInserts: any[] = [];
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

        // Compute last email date
        const lastEmailDate = allEmails.length ? new Date(Math.max(...allEmails.map(e => e.sentDate.getTime()))) : new Date();
        await supabase.from('snapshots').update({ last_email_date: lastEmailDate.toISOString().slice(0, 10) }).eq('id', snapshotId);

        return NextResponse.json({ ok: true, processed: true, snapshotId });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Processing failed' }, { status: 500 });
    }
}
