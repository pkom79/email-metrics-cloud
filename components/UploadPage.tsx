"use client";
import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle, FileText, Zap, Send, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { DataManager } from '../lib/data/dataManager';
import { supabase } from '../lib/supabase/client';

export default function UploadPage() {
    const router = useRouter();
    const [hoveredZone, setHoveredZone] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    // Text animation state
    const words = ['Simple', 'Useful', 'Valuable', 'Truthful', 'Actionable'];
    const [currentWordIndex, setCurrentWordIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentWordIndex((prev) => (prev + 1) % words.length);
        }, 2000); // Change word every 2 seconds

        return () => clearInterval(interval);
    }, [words.length]);

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
            hoverText: 'text-purple-600 dark:text-purple-400',
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
            hoverText: 'text-emerald-600 dark:text-emerald-400',
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
            hoverText: 'text-indigo-600 dark:text-indigo-400',
        },
    ] as const;

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
            fileRefs.current[type] = file;
            setUploads((prev) => ({ ...prev, [type]: true }));
            setFileInfo((prev) => ({
                ...prev,
                [type]: { name: file.name, sizeMB: (file.size / 1024 / 1024).toFixed(2) }
            }));
        };
        input.click();
    };

    const processFiles = async () => {
        if (!fileRefs.current.campaigns || !fileRefs.current.flows || !fileRefs.current.subscribers) return;
        setIsProcessing(true);
        setErrors([]);
        try {
            const files = fileRefs.current as { subscribers: File; flows: File; campaigns: File };
            const maxMb = Number(process.env.NEXT_PUBLIC_MAX_SIGNED_UPLOAD_MB || process.env.NEXT_PUBLIC_SUPABASE_MAX_UPLOAD_MB) || 50;
            const oversized = Object.entries(files)
                .filter(([, f]) => f.size > maxMb * 1024 * 1024)
                .map(([k, f]) => `${k} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);

            if (oversized.length > 0) {
                // Skip server upload for oversized files; process locally for instant results
                const dm = DataManager.getInstance();
                const result = await dm.loadCSVFiles(files, () => { });
                if (!result.success) {
                    setErrors(result.errors);
                } else {
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
                const { data: { user } } = await supabase.auth.getUser();

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
                const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
                if (user) {
                    setErrors([`Upload successful but account linking failed: ${linkErr}. Files were uploaded but may not appear in your dashboard. Please contact support or try uploading again.`]);
                } else {
                    console.log('Upload linking error expected for unauthenticated user, will be handled during email confirmation');
                    linkingSucceeded = true;
                }
            }            // 5) also process locally for instant dashboard
            const dm = DataManager.getInstance();
            const result = await dm.loadCSVFiles(files, () => { });
            if (!result.success) {
                setErrors(result.errors);
            } else {
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
                    <h3 className={`text-xl font-semibold mb-3 transition-colors duration-200 text-gray-900 dark:text-gray-100 ${isHovered && !isProcessing ? (zone as any).hoverText : ''}`}>{zone.title}</h3>
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
                        <div className={`flex items-center text-sm font-medium transition-colors duration-200 text-gray-400 dark:text-gray-400 ${isHovered && !isProcessing ? (zone as any).hoverText : ''}`}>
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
                                See what drives sales and what wastes money. Upload your Klaviyo exports today and get free insights that show the truth about your campaigns, flows, and subscribers.
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
                    </div>
                </div>
            </div>
        </div>
    );
}
