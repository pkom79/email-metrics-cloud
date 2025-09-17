#!/usr/bin/env node
/**
 * Push last 2 days of flow analytics (or synthetic fallback) into Supabase as a new upload
 * targeting account acc_canary_1.
 *
 * Steps:
 * 1. Fetch JSON analytics: /api/klaviyo/flow-analytics?days=2
 * 2. Build flows.csv matching snapshot processor expectations
 * 3. Create placeholder campaigns.csv and subscribers.csv (header only)
 * 4. POST /api/upload/init to obtain signed upload URLs
 * 5. Upload the three CSV files using their signed URLs (Supabase signed upload API)
 * 6. Manually bind upload to target account + create snapshot (service role direct SQL via REST RPC not available here, so we call manual-link endpoint if present or use service key with Supabase client)
 * 7. Trigger processing via /api/snapshots/process (uploadId)
 * 8. Log snapshot ID
 *
 * Requirements (env):
 *  - ADMIN_JOB_SECRET
 *  - KLAVIYO_API_KEY (if not provided via query param, optional)
 *  - NEXT_PUBLIC_BASE_URL or NEXT_PUBLIC_APP_URL or fallback http://localhost:3000
 *  - SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL (for direct binding if route not available)
 *  - DATA_INGEST_BUCKET (defaults preauth-uploads; falls back to PREAUTH_BUCKET)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const adminSecret = process.env.ADMIN_JOB_SECRET;
    if (!adminSecret) {
        throw new Error('ADMIN_JOB_SECRET required');
    }
    const apiKey = process.env.KLAVIYO_API_KEY || '';

    console.log('[1] Fetching last 2 days flow analytics JSON...');
    const analyticsUrl = `${baseUrl}/api/klaviyo/flow-analytics?days=2&format=json${apiKey ? `&klaviyoApiKey=${encodeURIComponent(apiKey)}` : ''}`;
    const analyticsRes = await fetch(analyticsUrl, { headers: { 'x-admin-job-secret': adminSecret } });
    if (!analyticsRes.ok) {
        const txt = await analyticsRes.text();
        throw new Error(`Analytics fetch failed ${analyticsRes.status}: ${txt}`);
    }
    const analyticsJson = await analyticsRes.json();
    if (!analyticsJson || !Array.isArray(analyticsJson.rows)) {
        throw new Error('Unexpected analytics JSON format');
    }
    const rows = analyticsJson.rows;
    console.log(`  -> Received ${rows.length} rows (fallback=${analyticsJson.fallback})`);

    console.log('[2] Building flows.csv contents...');
    const header = [
        'Day', 'Flow ID', 'Flow Name', 'Flow Message ID', 'Flow Message Name', 'Flow Message Channel', 'Status', 'Delivered', 'Unique Opens', 'Open Rate', 'Unique Clicks', 'Click Rate', 'Placed Order', 'Placed Order Rate', 'Revenue', 'Revenue per Recipient', 'Unsub Rate', 'Complaint Rate', 'Bounce Rate', 'Bounced', 'Unsubscribes', 'Spam'
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
        const delivered = r.delivered || 0;
        const openRate = r.openRate || 0;
        const clickRate = r.clickRate || 0;
        const placedOrders = r.placedOrders || 0;
        const placedOrderRate = r.placedOrderRate || (delivered ? placedOrders / delivered : 0);
        const revenue = r.revenue || 0;
        const revPer = r.revenuePerRecipient || (delivered ? revenue / delivered : 0);
        const unsubRate = r.unsubscribeRate || 0; // decimal fraction
        const complaintRate = r.complaintRate || 0;
        const bounceRate = r.bounceRate || 0;
        const bounced = Math.round(delivered * bounceRate);
        const unsubs = Math.round(delivered * unsubRate);
        const spam = Math.round(delivered * complaintRate);
        const esc = (v) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        lines.push([
            r.day,
            r.flowId,
            esc(r.flowName),
            r.flowMessageId,
            esc(r.flowMessageName),
            'Email',
            r.status || 'live',
            delivered,
            r.uniqueOpens || 0,
            openRate.toFixed(4),
            r.uniqueClicks || 0,
            clickRate.toFixed(4),
            placedOrders,
            placedOrderRate.toFixed(4),
            revenue.toFixed(2),
            revPer.toFixed(2),
            unsubRate.toFixed(4),
            complaintRate.toFixed(4),
            bounceRate.toFixed(4),
            bounced,
            unsubs,
            spam
        ].join(','));
    }
    const flowsCsv = lines.join('\n');
    console.log(`  -> flows.csv size ${flowsCsv.length} bytes`);

    console.log('[3] Preparing placeholder campaigns.csv & subscribers.csv');
    const campaignsCsv = 'Campaign Name,Subject,List,Send Time,Send Weekday,Total Recipients,Unique Placed Order,Placed Order Rate,Revenue,Unique Opens,Open Rate,Total Opens,Unique Clicks,Click Rate,Total Clicks,Unsubscribes,Spam Complaints,Spam Complaints Rate,Successful Deliveries,Bounces,Bounce Rate,Campaign ID,Campaign Channel\n';
    const subscribersCsv = 'Email,Klaviyo ID,First Name,Last Name,City,State / Region,Country,Zip Code,Source,Email Marketing Consent,Profile Created On,Date Added\n';

    console.log('[4] Initializing upload session...');
    const initRes = await fetch(`${baseUrl}/api/upload/init`, { method: 'POST' });
    if (!initRes.ok) {
        const txt = await initRes.text();
        throw new Error(`upload/init failed ${initRes.status}: ${txt}`);
    }
    const initJson = await initRes.json();
    const { uploadId, urls } = initJson;
    if (!uploadId || !urls || !urls.flows) throw new Error('Malformed init response');
    console.log(`  -> uploadId ${uploadId}`);

    async function putSigned(urlObj, content, filename) {
        // Supabase signed upload expects POST multipart/form-data with token + file; but createSignedUploadUrl returns a URL pattern expecting PUT with x-upsert header? Adjust based on actual implementation.
        // In this codebase createSignedUploadUrl returns { path, token }; we must POST to /storage/v1/object/upload/sign/<token>. We'll replicate minimal form-data.
        const token = urlObj.token;
        if (!token) throw new Error(`Missing token for ${filename}`);
        const uploadEndpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${token}`;

        const form = new FormData();
        form.append('cacheControl', '3600');
        form.append('contentType', 'text/csv');
        form.append('objectName', urlObj.path);
        form.append('file', new Blob([content], { type: 'text/csv' }), filename);

        const resp = await fetch(uploadEndpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
            body: form
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Upload failed for ${filename}: ${resp.status} ${t}`);
        }
        console.log(`    Uploaded ${filename}`);
    }

    console.log('[5] Uploading CSV files...');
    await putSigned(urls.flows, flowsCsv, 'flows.csv');
    await putSigned(urls.campaigns, campaignsCsv, 'campaigns.csv');
    await putSigned(urls.subscribers, subscribersCsv, 'subscribers.csv');

    console.log('[6] Binding upload to account acc_canary_1');
    // Direct service-role update & snapshot insert
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) throw new Error('Missing SUPABASE env for binding');

    async function supabaseRpc(path, method, body) {
        const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { method, headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Supabase RPC failed ${path} ${res.status}: ${t}`);
        }
        return res.json().catch(() => ({}));
    }

    // Update uploads row (status -> bound, set account_id)
    await supabaseRpc('uploads?id=eq.' + uploadId, 'PATCH', [{ account_id: 'acc_canary_1', status: 'bound', updated_at: new Date().toISOString() }]);

    // Create snapshot row
    const snapshotInsert = await supabaseRpc('snapshots', 'POST', [{ account_id: 'acc_canary_1', upload_id: uploadId, label: 'Flows Import (2 days)', status: 'ready' }]);
    const snapshotId = snapshotInsert && snapshotInsert[0] && snapshotInsert[0].id;
    if (!snapshotId) throw new Error('Failed to create snapshot');
    console.log(`  -> snapshotId ${snapshotId}`);

    console.log('[7] Triggering processing...');
    const procRes = await fetch(`${baseUrl}/api/snapshots/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId }) });
    if (!procRes.ok) {
        const t = await procRes.text();
        throw new Error(`Processing trigger failed ${procRes.status}: ${t}`);
    }
    console.log('  -> processing triggered');

    console.log('[8] Done. Verify snapshot metrics in UI or database.');
    console.log(JSON.stringify({ uploadId, snapshotId }, null, 2));
}

main().catch(err => { console.error('Script failed:', err); process.exit(1); });
