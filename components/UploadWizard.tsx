"use client";
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase/client';

export default function UploadWizard() {
    const [campaigns, setCampaigns] = useState<File | null>(null);
    const [flows, setFlows] = useState<File | null>(null);
    const [subscribers, setSubscribers] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [progress, setProgress] = useState({ campaigns: 0, flows: 0, subscribers: 0 });
    const router = useRouter();

    async function initUpload(): Promise<{
        uploadId: string;
        bucket: string;
        urls: {
            subscribers: { path: string; token: string };
            flows: { path: string; token: string };
            campaigns: { path: string; token: string };
        };
    }> {
        const res = await fetch('/api/upload/init', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to init upload');
        const data = await res.json();
        // Backward compatibility if API returns only URLs
        // Expecting { uploadId, urls: { subscribersUrl, flowsUrl, campaignsUrl } } OR tokens
        if (data.urls?.subscribersUrl || data.urls?.flowsUrl || data.urls?.campaignsUrl) {
            throw new Error('Server not returning tokens yet');
        }
        const bucket = data.bucket || (process.env.NEXT_PUBLIC_PREAUTH_BUCKET || 'preauth-uploads');
        return { uploadId: data.uploadId, bucket, urls: data.urls };
    }

    const uploadFile = async (bucket: string, key: 'campaigns' | 'flows' | 'subscribers', file: File, path: string, token: string) => {
        // upload with signed token using anon client
        const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
        if (error) throw error;
        setProgress((p) => ({ ...p, [key]: 100 }));
    };

    const onUpload = async () => {
        try {
            setLoading(true);
            setErrors([]);
            if (!campaigns || !flows || !subscribers) throw new Error('Please select all three CSV files.');

            const { uploadId, bucket, urls } = await initUpload();

            await Promise.all([
                uploadFile(bucket, 'subscribers', subscribers, urls.subscribers.path, urls.subscribers.token),
                uploadFile(bucket, 'flows', flows, urls.flows.path, urls.flows.token),
                uploadFile(bucket, 'campaigns', campaigns, urls.campaigns.path, urls.campaigns.token)
            ]);

            const validate = await fetch('/api/upload/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId }) });
            const v = await validate.json();
            if (!validate.ok || !v.ok) {
                throw new Error(`Validation failed${v?.missing ? `: missing ${v.missing.join(', ')}` : ''}`);
            }

            // TODO: call snapshot processor; for now navigate to dashboard placeholder
            router.push('/dashboard');
        } catch (e: any) {
            setErrors([e?.message || 'Upload failed']);
        } finally {
            setLoading(false);
        }
    };

    const disabled = !campaigns || !flows || !subscribers || loading;

    return (
        <div className="border rounded p-4 space-y-3">
            <div className="space-y-1">
                <label className="block text-sm font-medium">Campaigns CSV</label>
                <input type="file" accept=".csv" onChange={e => setCampaigns(e.target.files?.[0] || null)} />
                {progress.campaigns > 0 && <div className="text-xs opacity-60">{Math.round(progress.campaigns)}%</div>}
            </div>
            <div className="space-y-1">
                <label className="block text-sm font-medium">Flows CSV</label>
                <input type="file" accept=".csv" onChange={e => setFlows(e.target.files?.[0] || null)} />
                {progress.flows > 0 && <div className="text-xs opacity-60">{Math.round(progress.flows)}%</div>}
            </div>
            <div className="space-y-1">
                <label className="block text-sm font-medium">Subscribers CSV</label>
                <input type="file" accept=".csv" onChange={e => setSubscribers(e.target.files?.[0] || null)} />
                {progress.subscribers > 0 && <div className="text-xs opacity-60">{Math.round(progress.subscribers)}%</div>}
            </div>
            {errors.length > 0 && (
                <div className="text-sm text-red-600">
                    {errors.map((e, i) => (<div key={i}>{e}</div>))}
                </div>
            )}
            <button className="px-3 py-2 rounded bg-zinc-900 text-white disabled:opacity-50" onClick={onUpload} disabled={disabled}>
                {loading ? 'Uploading...' : 'Upload & Analyze'}
            </button>
        </div>
    );
}
