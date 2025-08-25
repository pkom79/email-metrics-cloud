"use client";
import { useEffect, useState } from 'react';
import { DataManager } from '../data/dataManager';

// Links any pending preauth uploads stored in localStorage after user authenticates.
// Improvements:
// 1. Retries linking & CSV hydration to avoid race with initial dashboard load.
// 2. Proactively hydrates DataManager with server CSVs (instead of relying on later fallback effect).
// 3. Emits both snapshot-created and dataset-hydrated events when data successfully loads.
// 4. Leaves any failed IDs in storage for a future attempt (page reload or next session).
export function usePendingUploadsLinker(enabled: boolean) {
    const [processed, setProcessed] = useState(false);
    useEffect(() => {
        if (!enabled || processed) return;
        let cancelled = false;
        (async () => {
            try {
                const raw = localStorage.getItem('pending-upload-ids');
                let ids: string[] = [];
                if (raw) {
                    try { ids = JSON.parse(raw) || []; } catch { ids = []; }
                } else {
                    const legacy = localStorage.getItem('pending-upload-id');
                    if (legacy) ids = [legacy];
                }
                if (!ids.length) { setProcessed(true); return; }

                const successful: string[] = [];

                // Helper: fetch a CSV with retries
                const fetchCsv = async (type: string) => {
                    const max = 10; const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
                    for (let i = 0; i < max && !cancelled; i++) {
                        try {
                            const r = await fetch(`/api/snapshots/download-csv?type=${type}`, { cache: 'no-store' });
                            if (r.ok) { return await r.text(); }
                        } catch { /* ignore */ }
                        await delay(250 + i * 150); // ~ (0.25s .. 1.6s) cumulative ~9s
                    }
                    return null;
                };

                for (const id of ids) {
                    if (cancelled) break;
                    try {
                        // Attempt link (retry transient 5xx)
                        let linked = false;
                        let snapshotId: string | undefined;
                        for (let attempt = 0; attempt < 4 && !linked && !cancelled; attempt++) {
                            const res = await fetch('/api/auth/link-upload', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ uploadId: id })
                            });
                            if (res.status === 401) break; // shouldn't occur here
                            if (res.ok) {
                                linked = true;
                                try { const j = await res.json(); snapshotId = j?.snapshotId; } catch { }
                                break;
                            }
                            await new Promise(r => setTimeout(r, 250 + attempt * 250));
                        }
                        if (!linked) continue;
                        successful.push(id);

                        // Kick off server processing (best-effort)
                        fetch('/api/snapshots/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: id }) }).catch(() => { });

                        // Proactively hydrate client dataset so dashboard isn't empty.
                        // Poll for CSV availability (snapshot commit + storage consistency) then load.
                        try {
                            const dm = DataManager.getInstance();
                            // Ensure a short wait if snapshotId exists (gives DB time to commit)
                            if (snapshotId) await new Promise(r => setTimeout(r, 250));
                            const [campaignsTxt, flowsTxt, subscribersTxt] = await Promise.all([fetchCsv('campaigns'), fetchCsv('flows'), fetchCsv('subscribers')]);
                            const files: Record<string, File | undefined> = {};
                            if (campaignsTxt) files.campaigns = new File([campaignsTxt], 'campaigns.csv', { type: 'text/csv' });
                            if (flowsTxt) files.flows = new File([flowsTxt], 'flows.csv', { type: 'text/csv' });
                            if (subscribersTxt) files.subscribers = new File([subscribersTxt], 'subscribers.csv', { type: 'text/csv' });
                            if ((files.campaigns || files.flows) && !cancelled) {
                                await dm.loadCSVFiles({ campaigns: files.campaigns as any, flows: files.flows as any, subscribers: files.subscribers as any });
                                try { window.dispatchEvent(new CustomEvent('em:dataset-hydrated')); } catch { }
                            }
                        } catch { /* non-fatal */ }
                    } catch { /* ignore id failure */ }
                }

                if (!cancelled) {
                    try {
                        const remaining = ids.filter(i => !successful.includes(i));
                        if (remaining.length) localStorage.setItem('pending-upload-ids', JSON.stringify(remaining)); else localStorage.removeItem('pending-upload-ids');
                        localStorage.removeItem('pending-upload-id');
                    } catch { }
                    try { window.dispatchEvent(new CustomEvent('em:snapshot-created')); } catch { }
                    setProcessed(true);
                }
            } catch { setProcessed(true); }
        })();
        return () => { cancelled = true; };
    }, [enabled, processed]);
    return processed;
}
