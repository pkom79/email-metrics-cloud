'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Share2, Copy, Link, Calendar, Eye, Trash2, ExternalLink } from 'lucide-react';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    snapshotId: string;
    snapshotLabel: string;
}

interface Share {
    id: string;
    title: string;
    description?: string;
    shareUrl: string;
    createdAt: string;
    expiresAt?: string;
    isActive: boolean;
    accessCount: number;
    lastAccessedAt?: string;
}

export default function ShareModal({ isOpen, onClose, snapshotId, snapshotLabel }: ShareModalProps) {
    const [shares, setShares] = useState<Share[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

    // Form state for creating new share
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [expiresIn, setExpiresIn] = useState<string>('');

    const loadShares = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const response = await fetch(`/api/snapshots/share?snapshotId=${snapshotId}`);
            if (!response.ok) {
                throw new Error('Failed to load shares');
            }

            const data = await response.json();
            setShares(data.shares || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [snapshotId]);

    useEffect(() => {
        if (isOpen) {
            loadShares();
            setTitle(`${snapshotLabel} - Dashboard`);
            setDescription('');
            setExpiresIn('');
        }
    }, [isOpen, snapshotId, snapshotLabel, loadShares]);

    const createShare = async () => {
        if (!title.trim()) {
            setError('Title is required');
            return;
        }

        try {
            setIsCreating(true);
            setError(null);

            const response = await fetch('/api/snapshots/share', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    snapshotId,
                    title: title.trim(),
                    description: description.trim() || null,
                    expiresIn: expiresIn || null,
                    createSnapshot: !snapshotId || snapshotId === 'temp-snapshot'
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create share');
            }

            const data = await response.json();

            // Reset form
            setTitle(`${snapshotLabel} - Dashboard`);
            setDescription('');
            setExpiresIn('');

            // Reload shares
            await loadShares();

            // Auto-copy the new share URL
            if (data.shareUrl) {
                await copyToClipboard(data.shareUrl);
            }

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsCreating(false);
        }
    };

    const deleteShare = async (shareId: string) => {
        try {
            const response = await fetch('/api/snapshots/share', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shareId, action: 'delete' })
            });

            if (!response.ok) {
                throw new Error('Failed to delete share');
            }

            await loadShares();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const copyToClipboard = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopiedUrl(url);
            setTimeout(() => setCopiedUrl(null), 2000);
        } catch (err) {
            console.error('Failed to copy to clipboard');
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const isExpired = (expiresAt?: string) => {
        return expiresAt && new Date(expiresAt) < new Date();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <Share2 className="w-6 h-6 text-purple-600" />
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Share Dashboard
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 max-h-[calc(90vh-80px)] overflow-y-auto">
                    {/* Create New Share */}
                    <div className="mb-8">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                            Create New Share Link
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Title *
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    placeholder="Dashboard title for recipients"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Description (optional)
                                </label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={2}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    placeholder="Optional description for recipients"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Expires
                                </label>
                                <select
                                    value={expiresIn}
                                    onChange={(e) => setExpiresIn(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                >
                                    <option value="">Never expires</option>
                                    <option value="1hour">1 hour</option>
                                    <option value="1day">1 day</option>
                                    <option value="7days">7 days</option>
                                    <option value="30days">30 days</option>
                                </select>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={createShare}
                                disabled={isCreating || !title.trim()}
                                className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isCreating ? 'Creating...' : 'Create Share Link'}
                            </button>
                        </div>
                    </div>

                    {/* Existing Shares */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                            Existing Share Links
                        </h3>

                        {isLoading ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                            </div>
                        ) : shares.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                <Link className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>No share links created yet</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {shares.map((share) => (
                                    <div
                                        key={share.id}
                                        className={`border rounded-lg p-4 ${isExpired(share.expiresAt) || !share.isActive
                                            ? 'border-gray-300 dark:border-gray-700 opacity-60'
                                            : 'border-gray-200 dark:border-gray-700'
                                            }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                                    {share.title}
                                                </h4>
                                                {share.description && (
                                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                        {share.description}
                                                    </p>
                                                )}

                                                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                                    <div className="flex items-center gap-1">
                                                        <Eye className="w-3 h-3" />
                                                        <span>{share.accessCount} views</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        <span>Created {formatDate(share.createdAt)}</span>
                                                    </div>
                                                    {share.expiresAt && (
                                                        <div className={`flex items-center gap-1 ${isExpired(share.expiresAt) ? 'text-red-500' : ''
                                                            }`}>
                                                            <span>
                                                                {isExpired(share.expiresAt) ? 'Expired' : 'Expires'} {formatDate(share.expiresAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 mt-3">
                                                    <input
                                                        type="text"
                                                        value={share.shareUrl}
                                                        readOnly
                                                        className="flex-1 text-sm px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-600 dark:text-gray-400"
                                                    />
                                                    <button
                                                        onClick={() => copyToClipboard(share.shareUrl)}
                                                        className={`px-3 py-1 rounded text-sm transition-colors ${copiedUrl === share.shareUrl
                                                            ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                                            }`}
                                                        disabled={isExpired(share.expiresAt) || !share.isActive}
                                                    >
                                                        {copiedUrl === share.shareUrl ? 'Copied!' : <Copy className="w-4 h-4" />}
                                                    </button>
                                                    <a
                                                        href={share.shareUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-3 py-1 bg-purple-100 text-purple-600 hover:bg-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded text-sm transition-colors"
                                                    >
                                                        <ExternalLink className="w-4 h-4" />
                                                    </a>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => deleteShare(share.id)}
                                                className="ml-4 p-2 text-gray-400 hover:text-red-500 transition-colors"
                                                title="Delete share"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
