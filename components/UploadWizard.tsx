"use client";
import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { ingestBucketNamePublic } from '../lib/storage/ingest';
import { DataManager } from '../lib/data/dataManager';
import { isDiagEnabled, recordDiag } from '../lib/utils/diag';

function stripName(file?: File | null) {
    return file?.name || '';
}

function FileRow({
    label,
    file,
    onSelect,
}: {
    label: string;
    file: File | null;
    onSelect: (f: File | null) => void;
}) {
    return (
        <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">{label}</label>
            <div className="flex items-center gap-3">
                <label className="inline-flex items-center px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                    <input type="file" accept=".csv" className="hidden" onChange={(e) => onSelect(e.target.files?.[0] || null)} />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Choose File</span>
                </label>
                <div className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">
                    {file ? (
                        <div className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-x-auto whitespace-nowrap" title={stripName(file)}>
                            {stripName(file)}
                        </div>
                    ) : (
                        <span className="text-gray-400">no file selected</span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function UploadWizard() {
    const diagEnabled = useMemo(() => isDiagEnabled(), []);
    const [campaigns, setCampaigns] = useState<File | null>(null);
    const [flows, setFlows] = useState<File | null>(null);
    const [subscribers, setSubscribers] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [progress, setProgress] = useState({ campaigns: 0, flows: 0, subscribers: 0 });

    async function initUpload(): Promise<{
        uploadId: string;
        bucket: string;
        urls: {
            subscribers: { path: string; token: string };
            flows: { path: string; token: string };
            campaigns: { path: string; token: string };
        };
    }> {
        recordDiag('upload:init', 'Requesting signed upload URLs');
        const res = await fetch('/api/upload/init', { method: 'POST' });
        if (!res.ok) {
            const j = await res.json().catch(() => ({} as any));
            recordDiag('upload:init', 'Init failed', { status: res.status, body: j });
            throw new Error(j.error || 'Failed to initialize upload');
        }
        const data = await res.json();
        recordDiag('upload:init', 'Init success', { uploadId: data?.uploadId });
        if (!data?.urls?.subscribers?.token) {
            throw new Error('Upload init did not return signed tokens. Check server env and bucket.');
        }
        const bucket = data.bucket || ingestBucketNamePublic();
        return { uploadId: data.uploadId, bucket, urls: data.urls };
    }

    const uploadFile = async (bucket: string, key: 'campaigns' | 'flows' | 'subscribers', file: File, path: string, token: string) => {
        const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
        if (error) throw error;
        setProgress((p) => ({ ...p, [key]: 100 }));
    };

    const onUpload = async () => {
        try {
            setLoading(true);
            setErrors([]);
            setNotice(null);
            if (!campaigns || !flows || !subscribers) throw new Error('Please select all three CSV files.');

            const { uploadId, bucket, urls } = await initUpload();
            recordDiag('upload:files', 'Received signed URLs', { uploadId });

            await Promise.all([
                uploadFile(bucket, 'subscribers', subscribers, urls.subscribers.path, urls.subscribers.token),
                uploadFile(bucket, 'flows', flows, urls.flows.path, urls.flows.token),
                uploadFile(bucket, 'campaigns', campaigns, urls.campaigns.path, urls.campaigns.token),
            ]);
            recordDiag('upload:files', 'Uploaded CSV files', { uploadId });

            const validate = await fetch('/api/upload/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId }),
            });
            const v = await validate.json().catch(() => ({}));
            if (!validate.ok || !v?.ok) throw new Error(`Validation failed${v?.missing ? `: missing ${v.missing.join(', ')}` : ''}`);
            recordDiag('upload:validate', 'Validation response', { ok: v?.ok, missing: v?.missing });

            let snapshotId: string | undefined;

            const { data: { session } } = await supabase.auth.getSession();
            const authedUser = session?.user;
            if (diagEnabled) {
                recordDiag('upload:session', 'Current session checked', { userId: authedUser?.id, hasAccessToken: Boolean(session?.access_token) });
            }

            if (authedUser) {
                const linkRes = await fetch('/api/auth/link-upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ uploadId }),
                });
                const linkJson = await linkRes.json().catch(() => ({}));
                if (diagEnabled) {
                    recordDiag('upload:link', 'Link response received', { status: linkRes.status, body: linkJson });
                }

                if (!linkRes.ok || !linkJson?.ok) {
                    throw new Error(linkJson?.error || 'Failed to finalize upload');
                }
                snapshotId = linkJson?.snapshotId;
                setNotice('Upload complete! Processing your data now.');
            } else {
                recordDiag('upload:link', 'User not authenticated; storing pending upload', { uploadId });
                try {
                    const existingRaw = localStorage.getItem('pending-upload-ids');
                    const arr: string[] = existingRaw ? JSON.parse(existingRaw) : [];
                    if (!arr.includes(uploadId)) arr.push(uploadId);
                    localStorage.setItem('pending-upload-ids', JSON.stringify(arr));
                    document.cookie = `pending-upload-ids=${encodeURIComponent(JSON.stringify(arr))}; path=/; max-age=86400; SameSite=Lax`;
                } catch {
                    localStorage.setItem('pending-upload-id', uploadId);
                    document.cookie = `pending-upload-ids=${encodeURIComponent(uploadId)}; path=/; max-age=86400; SameSite=Lax`;
                }
                setNotice('Files uploaded! Create an account or sign in to finish linking.');
            }

            // Optimistically load data locally so charts populate immediately
            try {
                const dm = DataManager.getInstance();
                await dm.loadCSVFiles({ campaigns, flows, subscribers });
                if (snapshotId) {
                    const lastEmailDate = dm.getLastEmailDate().toISOString();
                    await fetch('/api/snapshots/update-last-date', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ snapshotId, lastEmailDate })
                    }).catch(() => { });
                }
                if (diagEnabled) {
                    recordDiag('upload:local-load', 'Local dataset loaded', {
                        campaigns: campaigns.size,
                        flows: flows.size,
                        subscribers: subscribers.size,
                        snapshotId
                    });
                }
            } catch { /* non-blocking */ }

            // Notify dashboard to refresh snapshots list and close modal
            try {
                window.dispatchEvent(new CustomEvent('em:snapshot-created', { detail: { snapshotId } }));
            } catch { /* ignore */ }

            // Done
            setLoading(false);
        } catch (e: any) {
            setNotice(null);
            setErrors([e?.message || 'Upload failed']);
            if (diagEnabled) {
                recordDiag('upload:error', 'Upload flow failed', { message: e?.message, stack: e?.stack });
            }
        } finally {
            setLoading(false);
        }
    };

    const disabled = !campaigns || !flows || !subscribers || loading;

    return (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="space-y-4">
                <FileRow label="Campaigns CSV" file={campaigns} onSelect={setCampaigns} />
                {progress.campaigns > 0 && (
                    <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded">
                        <div className="h-1 bg-purple-600 rounded" style={{ width: `${Math.round(progress.campaigns)}%` }} />
                    </div>
                )}

                <FileRow label="Flows CSV" file={flows} onSelect={setFlows} />
                {progress.flows > 0 && (
                    <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded">
                        <div className="h-1 bg-purple-600 rounded" style={{ width: `${Math.round(progress.flows)}%` }} />
                    </div>
                )}

                <FileRow label="Subscribers CSV" file={subscribers} onSelect={setSubscribers} />
                {progress.subscribers > 0 && (
                    <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded">
                        <div className="h-1 bg-purple-600 rounded" style={{ width: `${Math.round(progress.subscribers)}%` }} />
                    </div>
                )}

                {notice && (
                    <div className="p-3 rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20 text-sm text-emerald-800 dark:text-emerald-200">
                        {notice}
                    </div>
                )}

                {errors.length > 0 && (
                    <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
                        {errors.map((e, i) => (
                            <div key={i}>• {e}</div>
                        ))}
                    </div>
                )}

                <button
                    className={`w-full px-4 py-2 rounded-lg text-white ${disabled ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
                    onClick={onUpload}
                    disabled={disabled}
                >
                    {loading ? 'Uploading…' : 'Upload & Analyze'}
                </button>

                <div className="text-center">
                    <a
                        href="/report-export-guide"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                    >
                        Report Export Guide
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path fillRule="evenodd" d="M5 4a1 1 0 011-1h9a1 1 0 011 1v9a1 1 0 11-2 0V6.414l-9.293 9.293a1 1 0 01-1.414-1.414L12.586 5H6a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                    </a>
                </div>
            </div>
        </div>
    );
}
