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
                const fetchCsv = async (type: string, accountScoped = false) => {
                    const max = 5; const delay = (i: number) => new Promise(r => setTimeout(r, 150 * (i + 1)));
                    for (let i = 0; i < max && !cancelled; i++) {
                        try {
                            const r = await fetch(`/api/snapshots/download-csv?type=${type}${accountScoped ? '' : ''}`, { cache: 'no-store' });
                            if (r.ok) { return await r.text(); }
                        } catch { }
                        await delay(i);
                    }
                    return null;
                };

                for (const id of ids) {
                    if (cancelled) break;
                    try {
                        // Attempt link (retry transient 5xx)
                        let linked = false;
                        for (let attempt = 0; attempt < 3 && !linked && !cancelled; attempt++) {
                            const res = await fetch('/api/auth/link-upload', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ uploadId: id })
                            });
                            if (res.status === 401) {
                                // Still not authenticated (should not happen here) – break early
                                break;
                            }
                            if (res.ok) { linked = true; break; }
                            await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
                        }
                        if (!linked) continue;
                        successful.push(id);

                        // Kick off server processing (best-effort)
                        fetch('/api/snapshots/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: id }) }).catch(() => { });

                        // Proactively hydrate client dataset so dashboard isn't empty
                        try {
                            const dm = DataManager.getInstance();
                            // Attempt to download the three CSVs directly (they should be present already)
                            const [campaignsTxt, flowsTxt, subscribersTxt] = await Promise.all([
                                fetchCsv('campaigns'),
                                fetchCsv('flows'),
                                fetchCsv('subscribers')
                            ]);
                            const files: Record<string, File | undefined> = {};
                            if (campaignsTxt) files.campaigns = new File([campaignsTxt], 'campaigns.csv', { type: 'text/csv' });
                            if (flowsTxt) files.flows = new File([flowsTxt], 'flows.csv', { type: 'text/csv' });
                            if (subscribersTxt) files.subscribers = new File([subscribersTxt], 'subscribers.csv', { type: 'text/csv' });
                            if (files.campaigns || files.flows || files.subscribers) {
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
