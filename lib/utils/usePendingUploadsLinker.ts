"use client";
import { useEffect, useState } from 'react';

// Links any pending preauth uploads stored in localStorage after user authenticates.
// Emits custom events for dashboard refresh.
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
                for (const id of ids) {
                    try {
                        const res = await fetch('/api/auth/link-upload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ uploadId: id })
                        });
                        if (res.ok) {
                            successful.push(id);
                            // Optional: trigger processing endpoint (no-op if not implemented fully)
                            fetch('/api/snapshots/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: id }) }).catch(() => { });
                        }
                    } catch { /* ignore individual failures */ }
                }
                if (!cancelled) {
                    try {
                        const remaining = ids.filter(i => !successful.includes(i));
                        if (remaining.length) localStorage.setItem('pending-upload-ids', JSON.stringify(remaining)); else localStorage.removeItem('pending-upload-ids');
                        localStorage.removeItem('pending-upload-id'); // cleanup legacy
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
