"use client";
import React, { useState, useRef, useEffect } from 'react';
import Image, { StaticImageData } from 'next/image';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle, FileText, Zap, Send, ArrowRight, AlertCircle, Loader2, Quote } from 'lucide-react';
import { DataManager } from '../lib/data/dataManager';
import { supabase } from '../lib/supabase/client';
import { getDiagEvents, isDiagEnabled } from '../lib/utils/diag';
import EmailPerformanceImage from '../app/homepage_images/Email Performance.png';
import FlowStepAnalysisImage from '../app/homepage_images/Flow Step Analysis.png';
import InactivityRevenueImage from '../app/homepage_images/Inactivity Revenue.png';
import SendVolumeImpactImage from '../app/homepage_images/Send Volume Impact.png';

export default function UploadPage() {
    const router = useRouter();
    const diagEnabled = isDiagEnabled();
    const [hoveredZone, setHoveredZone] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    // Diagnostics state (only used when diagEnabled)
    const [ingestStartTs, setIngestStartTs] = useState<number | null>(null);
    const [ingestProgress, setIngestProgress] = useState<any>(null);
    const [diagSnapshot, setDiagSnapshot] = useState<any>(null);
    const [diagEvents, setDiagEvents] = useState<Array<{ ts: number; source: string; message: string; data?: any }>>([]);

    // Text animation state
    const words = ['Simple', 'Useful', 'Valuable', 'Actionable'];
    const [currentWordIndex, setCurrentWordIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentWordIndex((prev) => (prev + 1) % words.length);
        }, 2000); // Change word every 2 seconds

        return () => clearInterval(interval);
    }, [words.length]);

    useEffect(() => {
        if (!diagEnabled) return;
        setDiagEvents(getDiagEvents());
        const id = setInterval(() => {
            setDiagEvents(getDiagEvents());
        }, 500);
        return () => clearInterval(id);
    }, [diagEnabled]);

    // Files selected
    const fileRefs = useRef<{ campaigns?: File; flows?: File; subscribers?: File }>({});
    const [uploads, setUploads] = useState({ subscribers: false, flows: false, campaigns: false });
    const [fileInfo, setFileInfo] = useState<Partial<Record<'subscribers' | 'flows' | 'campaigns', { name: string; sizeMB: string }>>>({});
    const allUploaded = uploads.subscribers && uploads.flows && uploads.campaigns;

    const uploadZones = [
        {
            id: 'subscribers',
            title: 'Subscribers Report',
            description: 'Import your subscriber list and segmentation data',
            icon: FileText,
            uploaded: uploads.subscribers,
            // Hover glow color (explicit, no gradient to avoid mismatches)
            gradient: 'from-purple-600 to-purple-600',
            glow1: 'bg-purple-600/10',
            glow2: 'bg-purple-600/20',
            // Solid icon background color
            iconBg: 'bg-purple-600',
            hoverBorder: 'hover:border-purple-500/60',
            hoverText: 'group-hover:text-purple-600 dark:group-hover:text-purple-400',
        },
        {
            id: 'flows',
            title: 'Email Flows Report',
            description: 'Automated email sequences and journey performance',
            icon: Zap,
            uploaded: uploads.flows,
            gradient: 'from-emerald-600 to-emerald-600',
            glow1: 'bg-emerald-600/10',
            glow2: 'bg-emerald-600/20',
            iconBg: 'bg-emerald-600',
            hoverBorder: 'hover:border-emerald-500/60',
            hoverText: 'group-hover:text-emerald-600 dark:group-hover:text-emerald-400',
        },
        {
            id: 'campaigns',
            title: 'Email Campaigns Report',
            description: 'One-time campaign metrics and engagement data',
            icon: Send,
            uploaded: uploads.campaigns,
            gradient: 'from-indigo-600 to-indigo-600',
            glow1: 'bg-indigo-600/10',
            glow2: 'bg-indigo-600/20',
            iconBg: 'bg-indigo-600',
            hoverBorder: 'hover:border-indigo-500/60',
            hoverText: 'group-hover:text-indigo-600 dark:group-hover:text-indigo-400',
        },
    ] as const;

    type FeatureScreen = {
        key: string;
        header: string;
        alt: string;
        src: StaticImageData;
    };

    const featureScreens: FeatureScreen[] = [
        {
            key: 'email-performance',
            header: 'See all your email marketing metrics in one chart',
            alt: 'Email performance chart comparing periods.',
            src: EmailPerformanceImage,
        },
        {
            key: 'flow-step-analysis',
            header: 'Track how each step in your flow performs',
            alt: 'Flow Step Analysis screenshot highlighting step-level trend.',
            src: FlowStepAnalysisImage,
        },
        {
            key: 'inactivity-revenue',
            header: 'See what segment to email next',
            alt: 'Inactivity revenue drain module showing dormant CLV buckets.',
            src: InactivityRevenueImage,
        },
        {
            key: 'send-volume-impact',
            header: 'Learn how often to send using data, not guesses',
            alt: 'Send Volume Impact chart correlating volume to revenue and deliverability.',
            src: SendVolumeImpactImage,
        },
    ];

    const handleFileSelect = async (type: 'subscribers' | 'flows' | 'campaigns') => {
        if (isProcessing) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            // reset any prior errors when a file is replaced
            setErrors([]);

            // Hard cap for local analysis to keep UX reliable on very large files
            const MAX_LOCAL_ANALYZE_MB = Number(process.env.NEXT_PUBLIC_MAX_LOCAL_ANALYZE_MB || 100);
            const fileSizeMB = file.size / 1024 / 1024;
            if (fileSizeMB > MAX_LOCAL_ANALYZE_MB) {
                setErrors([`File "${file.name}" is ${fileSizeMB.toFixed(2)} MB which exceeds the ${MAX_LOCAL_ANALYZE_MB} MB limit for in-browser analysis. Please split the export or reduce the date range and try again.`]);
                return;
            }
            fileRefs.current[type] = file;
            setUploads((prev) => ({ ...prev, [type]: true }));
            setFileInfo((prev) => ({
                ...prev,
                [type]: { name: file.name, sizeMB: (file.size / 1024 / 1024).toFixed(2) }
            }));
            if (diagEnabled) {
                try {
                    // Keep diagnostics panel up-to-date with selected files
                    const snapshot = {
                        filesMB: {
                            subscribers: fileRefs.current.subscribers ? (fileRefs.current.subscribers.size / 1024 / 1024).toFixed(2) : undefined,
                            flows: fileRefs.current.flows ? (fileRefs.current.flows.size / 1024 / 1024).toFixed(2) : undefined,
                            campaigns: fileRefs.current.campaigns ? (fileRefs.current.campaigns.size / 1024 / 1024).toFixed(2) : undefined,
                        }
                    };
                    setDiagSnapshot((prev: any) => ({ ...(prev || {}), ...snapshot }));
                } catch { /* noop */ }
            }
        };
        input.click();
    };

    const processFiles = async () => {
        if (!fileRefs.current.campaigns || !fileRefs.current.flows || !fileRefs.current.subscribers) return;
        setIsProcessing(true);
        setErrors([]);
        try {
            const files = fileRefs.current as { subscribers: File; flows: File; campaigns: File };
            if (diagEnabled) {
                setIngestStartTs(Date.now());
                setIngestProgress({ phase: 'precheck', t: Date.now() });
                try { console.time('[UploadDiag] ingest(total)'); } catch { /* ignore */ }
            }
            // Enforce a hard 100 MB cap (or env override) for local analysis
            const MAX_LOCAL_ANALYZE_MB = Number(process.env.NEXT_PUBLIC_MAX_LOCAL_ANALYZE_MB || 100);
            const tooLargeForLocal = Object.entries(files)
                .filter(([, f]) => (f.size / 1024 / 1024) > MAX_LOCAL_ANALYZE_MB)
                .map(([k, f]) => `${k} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
            if (tooLargeForLocal.length > 0) {
                if (diagEnabled) {
                    try { console.warn('[UploadDiag] blocked by size cap', { MAX_LOCAL_ANALYZE_MB, tooLargeForLocal }); } catch { /* ignore */ }
                }
                setErrors([`One or more files exceed the ${MAX_LOCAL_ANALYZE_MB} MB limit for in-browser analysis: ${tooLargeForLocal.join(', ')}. Please split the export or reduce the date range and try again.`]);
                return;
            }
            const maxMb = Number(process.env.NEXT_PUBLIC_MAX_SIGNED_UPLOAD_MB || process.env.NEXT_PUBLIC_SUPABASE_MAX_UPLOAD_MB) || 50;
            const oversized = Object.entries(files)
                .filter(([, f]) => f.size > maxMb * 1024 * 1024)
                .map(([k, f]) => `${k} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);

            if (oversized.length > 0) {
                // Skip server upload for oversized files; process locally for instant results
                const dm = DataManager.getInstance();
                const result = await dm.loadCSVFiles(files, (p) => {
                    if (!diagEnabled) return;
                    setIngestProgress({ ...p, t: Date.now(), phase: 'local-parse' });
                    try {
                        const cp = Math.round(p?.campaigns?.progress || 0);
                        const fp = Math.round(p?.flows?.progress || 0);
                        const sp = Math.round(p?.subscribers?.progress || 0);
                        if (cp % 25 === 0 || fp % 25 === 0 || sp % 25 === 0) {
                            console.log('[UploadDiag] progress (local only)', p);
                        }
                    } catch { /* ignore */ }
                });
                if (!result.success) {
                    setErrors(result.errors);
                } else {
                    if (diagEnabled) {
                        try {
                            const dm = DataManager.getInstance();
                            const elapsedMs = ingestStartTs ? (Date.now() - ingestStartTs) : null;
                            const snapshot = {
                                elapsedMs,
                                filesMB: {
                                    subscribers: (files.subscribers.size / 1024 / 1024).toFixed(2),
                                    flows: (files.flows.size / 1024 / 1024).toFixed(2),
                                    campaigns: (files.campaigns.size / 1024 / 1024).toFixed(2),
                                },
                                finalCounts: {
                                    campaigns: dm.getCampaigns().length,
                                    flows: dm.getFlowEmails().length,
                                    subscribers: dm.getSubscribers().length,
                                },
                                lastEmailDateISO: dm.getLastEmailDate()?.toISOString?.(),
                                progressFinal: ingestProgress,
                                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                                memoryMB: (typeof performance !== 'undefined' && (performance as any).memory)
                                    ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)
                                    : undefined,
                            };
                            setDiagSnapshot(snapshot);
                            sessionStorage.setItem('emc:lastIngestDiag', JSON.stringify(snapshot));
                            console.timeEnd?.('[UploadDiag] ingest(total)');
                            console.log('[UploadDiag] snapshot (local-only path)', snapshot);
                            console.table?.(snapshot.finalCounts);
                        } catch { /* ignore */ }
                    }
                    router.push('/dashboard');
                }
                return;
            }

            // 1) init signed uploads
            const initRes = await fetch('/api/upload/init', { method: 'POST' });
            if (!initRes.ok) throw new Error('Failed to initialize upload');
            const { uploadId, bucket, urls } = await initRes.json();

            // 2) upload files via signed tokens
            const up = async (key: 'subscribers' | 'flows' | 'campaigns', file: File) => {
                const { path, token } = urls[key];
                const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
                if (error) throw error;
            };
            await Promise.all([
                up('subscribers', files.subscribers),
                up('flows', files.flows),
                up('campaigns', files.campaigns)
            ]);

            // 3) validate presence
            const vRes = await fetch('/api/upload/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId }) });
            const v = await vRes.json();
            if (!vRes.ok || !v.ok) throw new Error(`Validation failed${v?.missing ? `: missing ${v.missing.join(', ')}` : ''}`);

            // 4) Link upload to account and create snapshot (only if user is authenticated)
            let linkingSucceeded = false;
            try {
                // Check if user is authenticated before attempting to link
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;

                if (user) {
                    console.log('User is authenticated, attempting to link upload to account...');
                    const linkRes = await fetch('/api/auth/link-upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uploadId, label: 'Dashboard Import' })
                    });

                    if (!linkRes.ok) {
                        const linkError = await linkRes.json();
                        console.error('Failed to link upload to account:', linkError);
                        setErrors([`Upload successful but account linking failed: ${linkError.error || 'Unknown error'}. Files were uploaded but may not appear in your dashboard. Please contact support or try uploading again.`]);
                    } else {
                        linkingSucceeded = true;
                        console.log('Successfully linked upload to account');
                    }
                } else {
                    console.log('User not authenticated, upload will be linked during email confirmation via cookie');
                    // Upload is stored with cookie for later linking during email confirmation
                    linkingSucceeded = true; // Consider this successful since it will be linked later
                }
            } catch (linkErr) {
                console.error('Error during upload linking:', linkErr);
                // Only show error if user was actually authenticated (otherwise it's expected)
                const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
                const user = session?.user;
                if (user) {
                    setErrors([`Upload successful but account linking failed: ${linkErr}. Files were uploaded but may not appear in your dashboard. Please contact support or try uploading again.`]);
                } else {
                    console.log('Upload linking error expected for unauthenticated user, will be handled during email confirmation');
                    linkingSucceeded = true;
                }
            }            // 5) also process locally for instant dashboard
            const dm = DataManager.getInstance();
            if (diagEnabled) { try { console.time('[UploadDiag] dm.loadCSVFiles'); } catch { /* ignore */ } }
            const result = await dm.loadCSVFiles(files, (p) => {
                if (!diagEnabled) return;
                setIngestProgress({ ...p, t: Date.now(), phase: 'local-parse' });
                try {
                    const cp = Math.round(p?.campaigns?.progress || 0);
                    const fp = Math.round(p?.flows?.progress || 0);
                    const sp = Math.round(p?.subscribers?.progress || 0);
                    if (cp % 25 === 0 || fp % 25 === 0 || sp % 25 === 0) {
                        console.log('[UploadDiag] progress', p);
                    }
                } catch { /* ignore */ }
            });
            if (diagEnabled) { try { console.timeEnd('[UploadDiag] dm.loadCSVFiles'); } catch { /* ignore */ } }
            if (!result.success) {
                setErrors(result.errors);
            } else {
                if (diagEnabled) {
                    try {
                        const elapsedMs = ingestStartTs ? (Date.now() - ingestStartTs) : null;
                        const snapshot = {
                            elapsedMs,
                            filesMB: {
                                subscribers: (files.subscribers.size / 1024 / 1024).toFixed(2),
                                flows: (files.flows.size / 1024 / 1024).toFixed(2),
                                campaigns: (files.campaigns.size / 1024 / 1024).toFixed(2),
                            },
                            finalCounts: {
                                campaigns: dm.getCampaigns().length,
                                flows: dm.getFlowEmails().length,
                                subscribers: dm.getSubscribers().length,
                            },
                            lastEmailDateISO: dm.getLastEmailDate()?.toISOString?.(),
                            progressFinal: ingestProgress,
                            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                            memoryMB: (typeof performance !== 'undefined' && (performance as any).memory)
                                ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)
                                : undefined,
                        };
                        setDiagSnapshot(snapshot);
                        sessionStorage.setItem('emc:lastIngestDiag', JSON.stringify(snapshot));
                        console.timeEnd?.('[UploadDiag] ingest(total)');
                        console.log('[UploadDiag] snapshot', snapshot);
                        console.table?.(snapshot.finalCounts);
                    } catch { /* ignore */ }
                }
                router.push('/dashboard');
            }
        } catch (e: any) {
            setErrors([e?.message || 'Unknown error occurred']);
        } finally {
            setIsProcessing(false);
        }
    };

    const UploadZone = ({ zone }: { zone: typeof uploadZones[number] }) => {
        const Icon = zone.icon;
        const isHovered = hoveredZone === zone.id;
        const meta = fileInfo[zone.id as 'subscribers' | 'flows' | 'campaigns'];
        return (
            <div
                onClick={() => handleFileSelect(zone.id)}
                onMouseEnter={() => setHoveredZone(zone.id)}
                onMouseLeave={() => setHoveredZone(null)}
                className={`
                    group relative overflow-hidden cursor-pointer transition-all duration-300 ease-out
                bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border rounded-2xl p-8
                ${uploads[zone.id as 'subscribers' | 'flows' | 'campaigns'] ? 'border-green-400/50 bg-green-50/80 dark:bg-green-950/20 dark:border-green-700/50' : `border-gray-200/50 dark:border-gray-700/50 ${(zone as any).hoverBorder}`}
                    hover:shadow-2xl hover:-translate-y-2 transform
                    ${isHovered && !isProcessing ? 'scale-105' : ''}
                    ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
                `}
            >
                <div className={`absolute inset-0 ${(zone as any).glow1} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className={`absolute inset-0 rounded-2xl ${(zone as any).glow2} opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-300`} />
                <div className="relative z-10">
                    <div className={`inline-flex items-center justify-center w-16 h-16 rounded-xl mb-6 transition-all duration-300 ${uploads[zone.id as 'subscribers' | 'flows' | 'campaigns'] ? 'bg-green-100 dark:bg-green-900/30' : `${(zone as any).iconBg} group-hover:scale-110`}`}>
                        {uploads[zone.id as 'subscribers' | 'flows' | 'campaigns'] ? <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" /> : <Icon className="w-8 h-8 text-white" />}
                    </div>
                    <h3 className={`text-xl font-semibold mb-3 transition-colors duration-200 text-gray-900 dark:text-gray-100 ${(zone as any).hoverText}`}>{zone.title}</h3>
                    <p className="text-sm leading-relaxed mb-4 text-gray-600 dark:text-gray-300">{zone.description}</p>
                    {uploads[zone.id as 'subscribers' | 'flows' | 'campaigns'] ? (
                        <div>
                            <div className="flex items-center text-sm font-medium text-green-600 dark:text-green-400 mb-2">
                                <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full mr-2 animate-pulse" />
                                File uploaded successfully
                            </div>
                            {meta && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                    {meta.name} ({meta.sizeMB} MB)
                                </p>
                            )}
                            <p className="text-xs mt-2 text-gray-400 dark:text-gray-500">Click to replace file</p>
                        </div>
                    ) : (
                        <div className={`flex items-center text-sm font-medium transition-colors duration-200 text-gray-400 dark:text-gray-400 ${(zone as any).hoverText}`}>
                            <Upload className="w-4 h-4 mr-2" />
                            Click to upload CSV file
                        </div>
                    )}
                    {/* Arrow removed per request */}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen relative overflow-hidden">
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-1/2 -right-1/2 w-96 h-96 bg-purple-500/10 dark:bg-purple-400/10 rounded-full blur-3xl animate-pulse" />
                <div className="absolute -bottom-1/2 -left-1/2 w-96 h-96 bg-blue-500/10 dark:bg-blue-400/10 rounded-full blur-3xl animate-pulse delay-1000" />
            </div>
            <div className="relative z-10 min-h-screen flex flex-col">
                <div className="px-8 pt-8 md:pt-10 pb-12">
                    <div className="max-w-6xl mx-auto w-full">
                        <div className="text-center mb-8">
                            <h1 className="text-4xl md:text-5xl font-bold mb-3 tracking-tight text-gray-900 dark:text-gray-100">
                                Klaviyo Metrics
                                <span className="block bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                                    Made{' '}
                                    <span
                                        key={currentWordIndex}
                                        className="inline-block transition-all duration-500 ease-in-out"
                                        style={{
                                            minWidth: '150px',
                                            textAlign: 'left'
                                        }}
                                    >
                                        {words[currentWordIndex]}
                                    </span>
                                </span>
                            </h1>
                            <p className="text-lg md:text-xl leading-relaxed max-w-3xl mx-auto text-gray-600 dark:text-gray-300">
                                See what drives sales and what wastes money. Upload your Klaviyo exports today and get free insights that show the truth about your campaigns, flows, and subscribers. Sign up now to unlock lifetime access for free.
                            </p>
                            <div className="mt-4 flex justify-center">
                                <a
                                    href="/report-export-guide"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-50 dark:bg-purple-900/30 px-5 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
                                    aria-label="Open the Report Export Guide in a new tab"
                                >
                                    Report Export Guide
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                        <path fillRule="evenodd" d="M5 4a1 1 0 011-1h9a1 1 0 011 1v9a1 1 0 11-2 0V6.414l-9.293 9.293a1 1 0 01-1.414-1.414L12.586 5H6a1 1 0 01-1-1z" clipRule="evenodd" />
                                    </svg>
                                </a>
                            </div>
                        </div>
                        {errors.length > 0 && (
                            <div className="mb-6 p-4 rounded-lg border bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-medium text-red-800 dark:text-red-300">Error processing files:</p>
                                        <ul className="mt-1 text-sm text-red-600 dark:text-red-400">
                                            {errors.map((error, index) => (
                                                <li key={index}>
                                                    • {error.replace(
                                                        'The object exceeded the maximum allowed size',
                                                        'File is larger than bucket limit. Increase Supabase bucket size limit or lower NEXT_PUBLIC_MAX_SIGNED_UPLOAD_MB.'
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="grid md:grid-cols-3 gap-8 mb-12">
                            {uploadZones.map((zone) => (<UploadZone key={zone.id} zone={zone as any} />))}
                        </div>
                        <div className="text-center">
                            <button
                                onClick={() => (allUploaded && !isProcessing ? processFiles() : null)}
                                disabled={!allUploaded || isProcessing}
                                className={`group relative px-12 py-4 rounded-full text-lg font-semibold transition-all duration-300 transform ${allUploaded && !isProcessing ? 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-lg hover:shadow-2xl hover:scale-105 hover:-translate-y-1' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}
                            >
                                <span className="relative z-10 flex items-center">
                                    {isProcessing ? (<><Loader2 className="mr-2 w-5 h-5 animate-spin" />Processing...</>) : (<>Analyze Your Data<ArrowRight className={`ml-2 w-5 h-5 transition-transform duration-300 ${allUploaded && !isProcessing ? 'group-hover:translate-x-1' : ''}`} /></>)}
                                </span>
                                {allUploaded && !isProcessing && (<><div className="absolute inset-0 -top-px rounded-full bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transform -translate-x-full group-hover:translate-x-0 transition-transform duration-1000" /> <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-600 to-purple-700 blur-xl opacity-0 group-hover:opacity-30 transition-opacity duration-300" /></>)}
                            </button>
                            {!allUploaded && !isProcessing && (<p className="text-gray-400 dark:text-gray-500 text-sm mt-4">Upload all three reports to enable analysis</p>)}
                        </div>
                        <div className="mt-12">
                            <figure className="relative overflow-hidden rounded-3xl border border-purple-500/30 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/80 via-white to-white dark:from-purple-900/40 dark:via-gray-900 dark:to-gray-900 p-8 shadow-[0_10px_40px_rgba(79,70,229,0.12)]">
                                <div className="flex flex-col gap-4">
                                    <Quote className="w-10 h-10 text-purple-600 dark:text-purple-300" />
                                    <blockquote className="text-left">
                                        <p className="text-lg md:text-xl text-gray-900 dark:text-gray-100 leading-relaxed">
                                            “Email Metrics was easier to use from the start and surfaced insights Klaviyo never puts in one place. One working session showed the $150,000 hiding in weak flows and disengaged segments, so we knew exactly what to rebuild.”
                                        </p>
                                    </blockquote>
                                </div>
                            </figure>
                        </div>
                        <div className="mt-10 space-y-10">
                            {featureScreens.map((feature, idx) => (
                                <div key={feature.key} className="space-y-4">
                                    <p className="text-xl md:text-2xl font-semibold text-center text-gray-900 dark:text-gray-100">
                                        {feature.header}
                                    </p>
                                    <div className="overflow-hidden rounded-3xl border border-gray-200/70 dark:border-gray-700/70 bg-white/90 dark:bg-gray-900/70 backdrop-blur-sm shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                                        <div className="px-6 py-6">
                                            <Image
                                                src={feature.src}
                                                alt={feature.alt}
                                                className="w-full h-auto object-cover rounded-2xl"
                                                placeholder="blur"
                                                priority={idx === 0}
                                                sizes="(min-width: 1024px) 900px, 100vw"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Diagnostics panel (visible only when diagEnabled) */}
                        {diagEnabled && (
                            <div className="mt-8">
                                <div className="p-4 rounded-lg border bg-purple-50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-800">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="font-semibold text-purple-800 dark:text-purple-200">Diagnostics</div>
                                            <div className="text-xs text-purple-700/80 dark:text-purple-300/80 mt-1">
                                                Live ingest progress and final snapshot for troubleshooting large uploads.
                                            </div>
                                        </div>
                                        <div className="text-xs text-purple-700/80 dark:text-purple-300/80">
                                            {ingestStartTs ? `Elapsed: ${Math.round((Date.now() - ingestStartTs) / 1000)}s` : 'Idle'}
                                        </div>
                                    </div>

                                    {/* File sizes */}
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                        {(['subscribers', 'flows', 'campaigns'] as const).map((k) => {
                                            const meta = fileInfo[k];
                                            return (
                                                <div key={k} className="rounded-md border border-purple-200/60 dark:border-purple-800/60 bg-white/70 dark:bg-gray-900/40 p-2">
                                                    <div className="text-purple-900 dark:text-purple-200 font-medium capitalize">{k}</div>
                                                    <div className="text-gray-600 dark:text-gray-400 mt-1">
                                                        {meta ? `${meta.name} (${meta.sizeMB} MB)` : 'No file selected'}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Progress bars */}
                                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {(['subscribers', 'flows', 'campaigns'] as const).map((k) => {
                                            const pct = Math.round(ingestProgress?.[k]?.progress || 0);
                                            return (
                                                <div key={k}>
                                                    <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                                                        <span className="capitalize">{k} progress</span><span>{pct}%</span>
                                                    </div>
                                                    <div className="h-2 bg-purple-100 dark:bg-purple-900/40 rounded">
                                                        <div
                                                            className="h-2 rounded bg-gradient-to-r from-purple-600 to-purple-700"
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Final counts (if available) */}
                                    {diagSnapshot && (
                                        <div className="mt-4 text-xs text-gray-700 dark:text-gray-300">
                                            <div className="font-medium mb-1">Final counts</div>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2">Campaigns: {diagSnapshot.finalCounts?.campaigns}</div>
                                                <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2">Flow emails: {diagSnapshot.finalCounts?.flows}</div>
                                                <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2">Subscribers: {diagSnapshot.finalCounts?.subscribers ?? 'n/a'}</div>
                                            </div>
                                            <div className="mt-2 text-gray-600 dark:text-gray-400">
                                                Last email date: {diagSnapshot.lastEmailDateISO || 'n/a'} · Elapsed: {Math.round((diagSnapshot.elapsedMs || 0) / 1000)}s
                                            </div>
                                        </div>
                                    )}

                                    {/* Event log */}
                                    {diagEvents.length > 0 && (
                                        <div className="mt-4 text-xs text-gray-700 dark:text-gray-300">
                                            <div className="font-medium mb-1">Event log</div>
                                            <div className="max-h-48 overflow-y-auto rounded border border-purple-200/70 dark:border-purple-800/50 bg-white/80 dark:bg-gray-900/40">
                                                <ul className="divide-y divide-purple-100/70 dark:divide-purple-900/40">
                                                    {diagEvents.slice(-40).reverse().map((evt, idx) => (
                                                        <li key={idx} className="px-2 py-2">
                                                            <div className="font-semibold text-purple-800 dark:text-purple-200">
                                                                {new Date(evt.ts).toLocaleTimeString()} · {evt.source}
                                                            </div>
                                                            <div>{evt.message}</div>
                                                            {evt.data && (
                                                                <pre className="mt-1 bg-black/5 dark:bg-white/5 p-1 rounded overflow-x-auto text-[10px] leading-4">{JSON.stringify(evt.data)}</pre>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
