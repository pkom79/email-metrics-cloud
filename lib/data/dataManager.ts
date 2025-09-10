"use client";
import {
    ProcessedCampaign,
    ProcessedFlowEmail,
    ProcessedSubscriber,
    DayOfWeekPerformanceData,
    HourOfDayPerformanceData,
    AggregatedMetrics,
    AudienceInsights,
    FlowSequenceInfo,
} from './dataTypes';
import { CSVParser } from './csvParser';
import { CampaignTransformer } from './transformers/campaignTransformer';
import { FlowTransformer } from './transformers/flowTransformer';
import { SubscriberTransformer } from './transformers/subscriberTransformer';
import { idbGet, idbSet } from '../utils/persist';

export interface LoadProgress {
    campaigns: { loaded: boolean; progress: number; error?: string };
    flows: { loaded: boolean; progress: number; error?: string };
    subscribers: { loaded: boolean; progress: number; error?: string };
}

export class DataManager {
    private static instance: DataManager;
    private static currentUserId: string | null = null;

    private campaigns: ProcessedCampaign[] = [];
    private flowEmails: ProcessedFlowEmail[] = [];
    private subscribers: ProcessedSubscriber[] = [];

    private isRealDataLoaded = false;
    private loadProgress: LoadProgress = {
        campaigns: { loaded: false, progress: 0 },
        flows: { loaded: false, progress: 0 },
        subscribers: { loaded: false, progress: 0 },
    };

    private csvParser = new CSVParser();
    private campaignTransformer = new CampaignTransformer();
    private flowTransformer = new FlowTransformer();
    private subscriberTransformer = new SubscriberTransformer();

    // Removed date audit state (adaptive benchmarking revert)

    // Dynamic storage keys based on user
    private get storageKey() {
        const userId = DataManager.currentUserId || 'anonymous';
        return `em:dataset:${userId}:v1`;
    }
    private get idbKey() {
        const userId = DataManager.currentUserId || 'anonymous';
        return `dataset:${userId}:v1`;
    }

    private _subsetSignature(campaigns: ProcessedCampaign[], flows: ProcessedFlowEmail[]): string {
        // If exact reference equality to full arrays, keep it short
        const fullC = campaigns === this.campaigns;
        const fullF = flows === this.flowEmails;
        if (fullC && fullF) return 'all';
        // Lightweight hash: count + first + last id/date to differentiate
        const hashArr = (arr: any[]) => {
            if (!arr.length) return '0';
            const first = arr[0]?.id || arr[0]?.name || arr[0]?.sentDate?.getTime();
            const last = arr[arr.length - 1]?.id || arr[arr.length - 1]?.name || arr[arr.length - 1]?.sentDate?.getTime();
            return `${arr.length}:${first}:${last}`;
        };
        return `c(${hashArr(campaigns)})_f(${hashArr(flows)})`;
    }

    private _buildBaseBucketsForSubset(campaigns: ProcessedCampaign[], flows: ProcessedFlowEmail[], granularity: 'daily' | 'weekly' | 'monthly', startDate: Date, endDate: Date) {
        // Build a per-day map of subset sums, then iterate across the full day range to zero-fill gaps
        const all = [...campaigns, ...flows].filter(e => e.sentDate instanceof Date && !isNaN(e.sentDate.getTime()) && e.sentDate >= startDate && e.sentDate <= endDate);
        const dailyMap: Map<string, { revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number; emailCount: number; date: Date }> = new Map();
        for (const e of all) {
            const d = new Date(e.sentDate); d.setHours(0, 0, 0, 0);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            let rec = dailyMap.get(key);
            if (!rec) { rec = { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0, date: d }; dailyMap.set(key, rec); }
            rec.revenue += e.revenue; rec.emailsSent += e.emailsSent; rec.totalOrders += e.totalOrders; rec.uniqueOpens += e.uniqueOpens; rec.uniqueClicks += e.uniqueClicks; rec.unsubscribesCount += e.unsubscribesCount; rec.spamComplaintsCount += e.spamComplaintsCount; rec.bouncesCount += e.bouncesCount; rec.emailCount += 1;
        }

        // Build continuous list of day keys between start and end
        const dayKeys: string[] = [];
        const cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
        const end = new Date(endDate); end.setHours(0, 0, 0, 0);
        let guard = 0;
        while (cursor <= end && guard < 8000) { // safety cap
            dayKeys.push(this._dayKey(cursor));
            cursor.setDate(cursor.getDate() + 1);
            guard++;
        }

        if (granularity === 'daily') {
            return dayKeys.map(k => {
                const d = new Date(k);
                const rec = dailyMap.get(k) || { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 } as any;
                return { key: k, label: this.safeToLocaleDateString(d, { month: 'short', day: 'numeric' }), sums: rec };
            });
        }

        if (granularity === 'weekly') {
            const weeks: { key: string; label: string; sums: any }[] = [];
            let currentWeekKey = '';
            let current: any = null;
            for (const k of dayKeys) {
                const d = new Date(k);
                const monday = this._mondayOf(d);
                const wKey = this._dayKey(monday);
                if (wKey !== currentWeekKey) {
                    if (current) weeks.push(current);
                    currentWeekKey = wKey;
                    const weekEnd = new Date(monday); weekEnd.setDate(weekEnd.getDate() + 6);
                    current = { key: wKey, label: this.safeToLocaleDateString(weekEnd, { month: 'short', day: 'numeric' }), sums: { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 } };
                }
                const rec = dailyMap.get(k);
                if (rec) {
                    const s = current.sums; s.revenue += rec.revenue; s.emailsSent += rec.emailsSent; s.totalOrders += rec.totalOrders; s.uniqueOpens += rec.uniqueOpens; s.uniqueClicks += rec.uniqueClicks; s.unsubscribesCount += rec.unsubscribesCount; s.spamComplaintsCount += rec.spamComplaintsCount; s.bouncesCount += rec.bouncesCount; s.emailCount += rec.emailCount;
                }
            }
            if (current) weeks.push(current);
            return weeks;
        }

        // monthly
        const months: { key: string; label: string; sums: any }[] = [];
        let currentMonthKey = '';
        let current: any = null;
        for (const k of dayKeys) {
            const d = new Date(k);
            const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (mKey !== currentMonthKey) {
                if (current) months.push(current);
                currentMonthKey = mKey;
                current = { key: mKey, label: this.safeToLocaleDateString(new Date(d.getFullYear(), d.getMonth(), 1), { month: 'short', year: '2-digit' }), sums: { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 } };
            }
            const rec = dailyMap.get(k);
            if (rec) {
                const s = current.sums; s.revenue += rec.revenue; s.emailsSent += rec.emailsSent; s.totalOrders += rec.totalOrders; s.uniqueOpens += rec.uniqueOpens; s.uniqueClicks += rec.uniqueClicks; s.unsubscribesCount += rec.unsubscribesCount; s.spamComplaintsCount += rec.spamComplaintsCount; s.bouncesCount += rec.bouncesCount; s.emailCount += rec.emailCount;
            }
        }
        if (current) months.push(current);
        return months;
    }

    private _deriveMetricFromSums(metric: string, sums: { revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number; emailCount: number }): number {
        switch (metric) {
            case 'revenue': return sums.revenue;
            case 'avgOrderValue': return sums.totalOrders > 0 ? sums.revenue / sums.totalOrders : 0;
            case 'revenuePerEmail': return sums.emailsSent > 0 ? sums.revenue / sums.emailsSent : 0;
            case 'emailsSent': return sums.emailsSent;
            case 'totalOrders': return sums.totalOrders;
            case 'openRate': return sums.emailsSent > 0 ? (sums.uniqueOpens / sums.emailsSent) * 100 : 0;
            case 'clickRate': return sums.emailsSent > 0 ? (sums.uniqueClicks / sums.emailsSent) * 100 : 0;
            case 'clickToOpenRate': return sums.uniqueOpens > 0 ? (sums.uniqueClicks / sums.uniqueOpens) * 100 : 0;
            case 'conversionRate': return sums.uniqueClicks > 0 ? (sums.totalOrders / sums.uniqueClicks) * 100 : 0;
            case 'unsubscribeRate': return sums.emailsSent > 0 ? (sums.unsubscribesCount / sums.emailsSent) * 100 : 0;
            case 'spamRate': return sums.emailsSent > 0 ? (sums.spamComplaintsCount / sums.emailsSent) * 100 : 0;
            case 'bounceRate': return sums.emailsSent > 0 ? (sums.bouncesCount / sums.emailsSent) * 100 : 0;
            default: return 0;
        }
    }

    private _dayKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    private _mondayOf(d: Date) { const n = new Date(d); n.setHours(0, 0, 0, 0); const day = n.getDay(); const diff = n.getDate() - day + (day === 0 ? -6 : 1); n.setDate(diff); return n; }

    private _rebuildDailyAggregates() {
        this._dailyAgg.clear();
        const allEmails = [...this.campaigns, ...this.flowEmails];
        for (const e of allEmails) {
            if (!e.sentDate || !(e.sentDate instanceof Date) || isNaN(e.sentDate.getTime())) continue;
            const k = `${e.sentDate.getFullYear()}-${String(e.sentDate.getMonth() + 1).padStart(2, '0')}-${String(e.sentDate.getDate()).padStart(2, '0')}`;
            let rec = this._dailyAgg.get(k);
            if (!rec) {
                rec = { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 };
                this._dailyAgg.set(k, rec);
            }
            rec!.revenue += e.revenue;
            rec!.emailsSent += e.emailsSent;
            rec!.totalOrders += e.totalOrders;
            rec!.uniqueOpens += e.uniqueOpens;
            rec!.uniqueClicks += e.uniqueClicks;
            rec!.unsubscribesCount += e.unsubscribesCount;
            rec!.spamComplaintsCount += e.spamComplaintsCount;
            rec!.bouncesCount += e.bouncesCount;
            rec!.emailCount += 1;
        }
        this._dailyAggVersion = `${this.campaigns.length}:${this.flowEmails.length}`;
        this._timeSeriesCache.clear();
        this._seriesBaseCache.clear();
    }

    private _computeDateRangeForTimeSeries(dateRange: string, customFrom?: string, customTo?: string): { startDate: Date; endDate: Date } | null {
        try {
            if (dateRange === 'custom' && customFrom && customTo) {
                const startDate = new Date(customFrom + 'T00:00:00');
                const endDate = new Date(customTo + 'T23:59:59');
                return { startDate, endDate };
            }
            const allEmails = [...this.campaigns, ...this.flowEmails].filter(e => e.sentDate instanceof Date && !isNaN(e.sentDate.getTime()));
            if (!allEmails.length) return null;
            let startDate: Date; let endDate: Date;
            if (dateRange === 'all') {
                // Find min and max dates efficiently without using spread operator
                let maxTime = 0;
                let minTime = Infinity;
                for (const email of allEmails) {
                    const time = email.sentDate.getTime();
                    if (time > maxTime) maxTime = time;
                    if (time < minTime) minTime = time;
                }
                
                endDate = new Date(maxTime); endDate.setHours(23, 59, 59, 999);
                const originalStartDate = new Date(minTime); originalStartDate.setHours(0, 0, 0, 0);
                
                // Cap to maximum 730 days (2 years)
                const twoYearsAgo = new Date(endDate);
                twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
                twoYearsAgo.setHours(0, 0, 0, 0);
                
                startDate = originalStartDate < twoYearsAgo ? twoYearsAgo : originalStartDate;
            } else {
                // Find max date efficiently
                let maxTime = 0;
                for (const email of allEmails) {
                    const time = email.sentDate.getTime();
                    if (time > maxTime) maxTime = time;
                }
                
                endDate = new Date(maxTime); endDate.setHours(23, 59, 59, 999);
                const days = parseInt(dateRange.replace('d', ''));
                
                // Cap individual date ranges to maximum 730 days
                const cappedDays = Math.min(days, 730);
                startDate = new Date(endDate); startDate.setDate(startDate.getDate() - cappedDays + 1); startDate.setHours(0, 0, 0, 0);
            }
            return { startDate, endDate };
        } catch { return null; }
    }

    /**
     * Return zero-filled daily aggregate records between start and end (inclusive).
     * This leverages the internal daily aggregate map, rebuilding it if the underlying
     * campaign/flow counts changed. Used by the new benchmarking pipeline (daily look-back).
     */
    // Removed getDailyRecords (adaptive benchmarking revert)

    // ----------------------------------------------
    // Performance caches (added for faster time series)
    // ----------------------------------------------
    private _dailyAggVersion = '';
    private _dailyAgg: Map<string, {
        revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number; emailCount: number;
    }> = new Map();
    private _timeSeriesCache: Map<string, { built: number; data: { value: number; date: string }[] }> = new Map();
    private _seriesBaseCache: Map<string, {
        built: number; buckets: {
            key: string; label: string; sums: {
                revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number; emailCount: number;
            }
        }[]
    }> = new Map();

    constructor() {
        if (typeof window !== 'undefined') {
            // Lightweight coalescer for hydration events to avoid storms causing render loops
            // We attach a scheduling helper on the instance (first construction) that batches multiple
            // internal hydration triggers (localStorage + idb + ensureHydrated) into a single
            // 'em:dataset-hydrated' event in the same tick / animation frame.
            const scheduleHydrationEvent = (() => {
                let pending = false;
                return () => {
                    if (pending) return;
                    pending = true;
                    // Use rAF when available to bunch synchronous cascades; fallback to setTimeout
                    const fire = () => {
                        pending = false;
                        try { window.dispatchEvent(new CustomEvent('em:dataset-hydrated')); } catch { /* ignore */ }
                    };
                    try {
                        if (typeof requestAnimationFrame === 'function') {
                            requestAnimationFrame(() => fire());
                        } else {
                            setTimeout(fire, 0);
                        }
                    } catch { setTimeout(fire, 0); }
                };
            })();
            // Expose for other methods in this instance (closure safe)
            (this as any)._scheduleHydrationEvent = scheduleHydrationEvent;
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw) as { campaigns?: any[]; flowEmails?: any[]; subscribers?: any[] };
                    const revive = (d: any) => (d instanceof Date ? d : new Date(d));
                    this.campaigns = (parsed.campaigns || []).map((c: any) => ({ ...c, sentDate: revive(c.sentDate) }));
                    this.flowEmails = (parsed.flowEmails || []).map((f: any) => ({ ...f, sentDate: revive(f.sentDate) }));
                    this.subscribers = (parsed.subscribers || []);
                    this.isRealDataLoaded = this.campaigns.length > 0 || this.flowEmails.length > 0 || this.subscribers.length > 0;
                    // Use coalesced dispatch
                    scheduleHydrationEvent();
                }
            } catch { }
            (async () => {
                try {
                    if (this.campaigns.length || this.flowEmails.length || this.subscribers.length) return;
                    const fromIdb = await idbGet<any>(this.idbKey);
                    if (fromIdb) {
                        const revive = (d: any) => (d instanceof Date ? d : new Date(d));
                        this.campaigns = (fromIdb.campaigns || []).map((c: any) => ({ ...c, sentDate: revive(c.sentDate) }));
                        this.flowEmails = (fromIdb.flowEmails || []).map((f: any) => ({ ...f, sentDate: revive(f.sentDate) }));
                        this.subscribers = (fromIdb.subscribers || []);
                        this.isRealDataLoaded = this.campaigns.length > 0 || this.flowEmails.length > 0 || this.subscribers.length > 0;
                        scheduleHydrationEvent();
                    }
                } catch { }
            })();
        }
    }

    async ensureHydrated(): Promise<boolean> {
        if (this.campaigns.length || this.flowEmails.length || this.subscribers.length) return true;
        try {
            const fromIdb = await idbGet<any>(this.idbKey);
            if (fromIdb) {
                const revive = (d: any) => (d instanceof Date ? d : new Date(d));
                this.campaigns = (fromIdb.campaigns || []).map((c: any) => ({ ...c, sentDate: revive(c.sentDate) }));
                this.flowEmails = (fromIdb.flowEmails || []).map((f: any) => ({ ...f, sentDate: revive(f.sentDate) }));
                this.subscribers = (fromIdb.subscribers || []);
                this.isRealDataLoaded = this.campaigns.length > 0 || this.flowEmails.length > 0 || this.subscribers.length > 0;
                try { (this as any)._scheduleHydrationEvent?.(); } catch { }
                return this.isRealDataLoaded;
            }
        } catch { }
        return false;
    }

    static setUserId(userId: string | null) {
        if (DataManager.currentUserId !== userId) {
            DataManager.currentUserId = userId;
            if (DataManager.instance) {
                DataManager.instance.clearData();
            }
        }
    }

    static getInstance(): DataManager {
        if (!DataManager.instance) DataManager.instance = new DataManager();
        return DataManager.instance;
    }

    private clearData() {
        this.campaigns = [];
        this.flowEmails = [];
        this.subscribers = [];
        this.isRealDataLoaded = false;
        this.loadProgress = {
            campaigns: { loaded: false, progress: 0 },
            flows: { loaded: false, progress: 0 },
            subscribers: { loaded: false, progress: 0 },
        };
        this._dailyAgg.clear();
        this._timeSeriesCache.clear();
        this._seriesBaseCache.clear();
    }

    private persistToStorage(): void {
        if (typeof window === 'undefined') return;
        const serialize = (arr: any[]) => arr.map((o: any) => ({ ...o, sentDate: (o.sentDate instanceof Date ? o.sentDate : new Date(o.sentDate)).toISOString() }));
        const obj = {
            campaigns: serialize(this.campaigns),
            flowEmails: serialize(this.flowEmails),
            subscribers: this.subscribers,
        };
        // Try localStorage but don't block IDB if it fails
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(obj));
        } catch { /* quota or private mode */ }
        // IDB is our durable store
        (async () => { try { await idbSet(this.idbKey, obj); } catch { /* ignore */ } })();
        try { window.dispatchEvent(new CustomEvent('em:dataset-persisted')); } catch { /* ignore */ }
    }

    async loadCSVFiles(
        files: { campaigns?: File; flows?: File; subscribers?: File },
        onProgress?: (progress: LoadProgress) => void,
    ): Promise<{ success: boolean; errors: string[] }> {
        const errors: string[] = [];
        try {
            if (files.campaigns) {
                this.loadProgress.campaigns.progress = 0; onProgress?.(this.loadProgress);
                const res = await this.csvParser.parseCampaigns(files.campaigns, (p) => { this.loadProgress.campaigns.progress = p * 0.5; onProgress?.(this.loadProgress); });
                if (res.success && res.data) {
                    this.campaigns = this.campaignTransformer.transform(res.data);
                    // Diagnostics: summarize campaigns by month and date bounds after transform
                    try {
                        const enabled = (typeof process !== 'undefined' && process.env && (process.env.NEXT_PUBLIC_EM_DIAG === '1' || process.env.NEXT_PUBLIC_EM_DIAG === 'true')) ||
                                        (typeof window !== 'undefined' && (((window as any).__EM_DIAG__) || ((window as any).EM_DIAG) || (function(){ try { return typeof localStorage !== 'undefined' && (localStorage.getItem('EM_DIAG') === '1' || localStorage.getItem('EM_DIAG') === 'true'); } catch { return false; } })()));
                        if (enabled && this.campaigns?.length) {
                            let minT = Number.POSITIVE_INFINITY;
                            let maxT = 0;
                            const byMonth = new Map<string, number>();
                            for (const c of this.campaigns) {
                                const t = c.sentDate?.getTime?.() ?? new Date(c.sentDate as any).getTime();
                                if (!isNaN(t)) { if (t < minT) minT = t; if (t > maxT) maxT = t; }
                                const d = new Date(t);
                                const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                                byMonth.set(k, (byMonth.get(k) || 0) + 1);
                            }
                            const summary = Object.fromEntries([...byMonth.entries()].sort());
                            // eslint-disable-next-line no-console
                            console.info('[DataManager] Campaigns loaded: count=%d, range=%s..%s, byMonth=%o',
                                this.campaigns.length,
                                isFinite(minT)? new Date(minT).toISOString().slice(0,10) : 'n/a',
                                maxT? new Date(maxT).toISOString().slice(0,10) : 'n/a',
                                summary);
                        }
                    } catch { /* ignore diag errors */ }
                    this.loadProgress.campaigns.loaded = true; this.loadProgress.campaigns.progress = 100;
                } else { errors.push(`Campaigns: ${res.error || 'Unknown error'}`); this.loadProgress.campaigns.error = res.error; }
            }
            if (files.flows) {
                this.loadProgress.flows.progress = 0; onProgress?.(this.loadProgress);
                const res = await this.csvParser.parseFlows(files.flows, (p) => { this.loadProgress.flows.progress = p * 0.5; onProgress?.(this.loadProgress); });
                if (res.success && res.data) {
                    this.flowEmails = this.flowTransformer.transform(res.data);
                    this.loadProgress.flows.loaded = true; this.loadProgress.flows.progress = 100;
                } else { errors.push(`Flows: ${res.error || 'Unknown error'}`); this.loadProgress.flows.error = res.error; }
            }
            if (files.subscribers) {
                this.loadProgress.subscribers.progress = 0; onProgress?.(this.loadProgress);
                const res = await this.csvParser.parseSubscribers(files.subscribers, (p) => { this.loadProgress.subscribers.progress = p * 0.5; onProgress?.(this.loadProgress); });
                if (res.success && res.data) {
                    this.subscribers = this.subscriberTransformer.transform(res.data);
                    this.loadProgress.subscribers.loaded = true; this.loadProgress.subscribers.progress = 100;
                } else { errors.push(`Subscribers: ${res.error || 'Unknown error'}`); this.loadProgress.subscribers.error = res.error; }
            }
            this.isRealDataLoaded = this.campaigns.length > 0 || this.flowEmails.length > 0 || this.subscribers.length > 0;

            // Date audit removed
            onProgress?.(this.loadProgress);
            if (this.isRealDataLoaded) this.persistToStorage();
            return { success: errors.length === 0, errors };
        } catch (e: any) {
            errors.push(e?.message || 'Unknown error');
            return { success: false, errors };
        }
    }

    /**
     * Clear all data and reset to empty state
     */
    clearAllData(): void {
        this.campaigns = []; this.flowEmails = []; this.subscribers = []; this.isRealDataLoaded = false;
        this.loadProgress = { campaigns: { loaded: false, progress: 0 }, flows: { loaded: false, progress: 0 }, subscribers: { loaded: false, progress: 0 } };
    }

    getLoadProgress(): LoadProgress { return this.loadProgress; }
    hasRealData(): boolean { return this.isRealDataLoaded; }

    getCampaigns(): ProcessedCampaign[] { 
        return this.applyTwoYearLimit(this.campaigns);
    }
    
    getFlowEmails(): ProcessedFlowEmail[] { 
        return this.applyTwoYearLimit(this.flowEmails);
    }

    private applyTwoYearLimit<T extends { sentDate: Date }>(data: T[]): T[] {
        if (data.length === 0) return data;
        
        // Find the latest date efficiently without using spread operator
        let latestTime = 0;
        for (const item of data) {
            const time = item.sentDate.getTime();
            if (time > latestTime) {
                latestTime = time;
            }
        }
        
        // Calculate 730 days ago from the latest email
        const latestDate = new Date(latestTime);
        const twoYearsAgo = new Date(latestDate);
        twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
        
        return data.filter(item => item.sentDate >= twoYearsAgo);
    }
    getSubscribers(): ProcessedSubscriber[] { return this.subscribers; }

    getUniqueFlowNames(): string[] { return this.flowTransformer.getUniqueFlowNames(this.flowEmails); }

    getLastEmailDate(): Date {
        try {
            // Lazy cache invalidation based on counts reference (fast heuristic)
            const countsSignature = `${this.campaigns.length}:${this.flowEmails.length}`;
            // @ts-ignore - internal symbol
            if ((this as any)._lastEmailDateCache && (this as any)._lastEmailDateCache.sig === countsSignature) {
                return (this as any)._lastEmailDateCache.value;
            }
            const campaignDates = this.campaigns.map(c => c.sentDate instanceof Date ? c.sentDate.getTime() : NaN).filter(t => Number.isFinite(t));
            const flowDates = this.flowEmails.map(f => f.sentDate instanceof Date ? f.sentDate.getTime() : NaN).filter(t => Number.isFinite(t));
            const all = [...campaignDates, ...flowDates];
            if (!all.length) return new Date();
            const maxTime = Math.max(...all);
            if (!Number.isFinite(maxTime)) return new Date();
            const result = new Date(maxTime);
            if (isNaN(result.getTime())) return new Date();
            (this as any)._lastEmailDateCache = { sig: countsSignature, value: result };
            return result;
        } catch {
            return new Date();
        }
    }

    // Safe date formatting function to prevent DateTimeFormat errors
    private safeToLocaleDateString(date: Date, options: Intl.DateTimeFormatOptions): string {
        try {
            // Extra defensive validation
            if (!date || typeof date !== 'object' || !(date instanceof Date)) {
                console.warn('safeToLocaleDateString: Invalid date object type:', typeof date, date);
                return 'Invalid Date';
            }

            const timestamp = date.getTime();
            if (isNaN(timestamp) || !isFinite(timestamp)) {
                console.warn('safeToLocaleDateString: Invalid timestamp:', timestamp, 'for date:', date);
                return 'Invalid Date';
            }

            // Additional validation: check if date is reasonable (not too far in past/future)
            const year = date.getFullYear();
            if (year < 1900 || year > 2100) {
                console.warn('safeToLocaleDateString: Date year out of reasonable range:', year);
                return 'Invalid Date';
            }

            // Use manual formatting first to avoid DateTimeFormat issues
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = date.getMonth();
            const day = date.getDate();

            // Validate individual components
            if (month < 0 || month > 11 || day < 1 || day > 31 || year < 1900 || year > 2100) {
                console.warn('safeToLocaleDateString: Invalid date components:', { year, month, day });
                return 'Invalid Date';
            }

            // Return manual formatting directly instead of trying native DateTimeFormat
            if (options.year) {
                return `${monthNames[month]} ${String(year).slice(-2)}`;
            } else {
                return `${monthNames[month]} ${day}`;
            }
        } catch (error) {
            console.warn('safeToLocaleDateString error:', error, 'for date:', date);
            return 'Invalid Date';
        }
    }

    getMetricTimeSeries(
        campaigns: ProcessedCampaign[],
        flows: ProcessedFlowEmail[],
        metricKey: string,
        dateRange: string,
        granularity: 'daily' | 'weekly' | 'monthly',
        customFrom?: string,
        customTo?: string
    ): { value: number; date: string }[] {
        try {
            const range = this._computeDateRangeForTimeSeries(dateRange, customFrom, customTo);
            if (!range) return [];
            const { startDate, endDate } = range;

            // Dataset signature (for invalidation when base data changes)
            const dataSig = `${this.campaigns.length}:${this.flowEmails.length}`;
            if (this._dailyAggVersion !== dataSig) this._rebuildDailyAggregates();

            // Subset signature (accounts for caller-provided filtered arrays)
            const subsetSig = this._subsetSignature(campaigns, flows);
            const rangeKey = `${startDate.toISOString().slice(0, 10)}_${endDate.toISOString().slice(0, 10)}`;
            const tsCacheKey = `${dataSig}|${subsetSig}|${granularity}|${rangeKey}|${metricKey}`;
            const existing = this._timeSeriesCache.get(tsCacheKey);
            if (existing) return existing.data;

            let buckets: { key: string; label: string; sums: { revenue: number; emailsSent: number; totalOrders: number; uniqueOpens: number; uniqueClicks: number; unsubscribesCount: number; spamComplaintsCount: number; bouncesCount: number; emailCount: number } }[] = [];

            if (subsetSig === 'all') {
                // Build from global daily aggregates, then roll-up
                // Create ordered day list within range
                const dayKeys: string[] = [];
                const cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
                const end = new Date(endDate); end.setHours(0, 0, 0, 0);
                let guard = 0;
                while (cursor <= end && guard < 8000) { // safety cap
                    dayKeys.push(this._dayKey(cursor));
                    cursor.setDate(cursor.getDate() + 1);
                    guard++;
                }
                if (granularity === 'daily') {
                    buckets = dayKeys.map(k => {
                        const rec = this._dailyAgg.get(k) || { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 } as any;
                        const d = new Date(k);
                        return { key: k, label: this.safeToLocaleDateString(d, { month: 'short', day: 'numeric' }), sums: rec };
                    });
                } else if (granularity === 'weekly') {
                    // Group Monday-based weeks
                    let currentWeekKey = '';
                    let current: any = null;
                    for (const k of dayKeys) {
                        const d = new Date(k);
                        const monday = this._mondayOf(d);
                        const wKey = this._dayKey(monday);
                        if (wKey !== currentWeekKey) {
                            if (current) buckets.push(current);
                            currentWeekKey = wKey;
                            const weekEnd = new Date(monday); weekEnd.setDate(weekEnd.getDate() + 6);
                            current = { key: wKey, label: this.safeToLocaleDateString(weekEnd, { month: 'short', day: 'numeric' }), sums: { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 } };
                        }
                        const rec = this._dailyAgg.get(k);
                        if (rec) {
                            const s = current.sums; s.revenue += rec.revenue; s.emailsSent += rec.emailsSent; s.totalOrders += rec.totalOrders; s.uniqueOpens += rec.uniqueOpens; s.uniqueClicks += rec.uniqueClicks; s.unsubscribesCount += rec.unsubscribesCount; s.spamComplaintsCount += rec.spamComplaintsCount; s.bouncesCount += rec.bouncesCount; s.emailCount += rec.emailCount;
                        }
                    }
                    if (current) buckets.push(current);
                } else { // monthly
                    let currentMonthKey = '';
                    let current: any = null;
                    for (const k of dayKeys) {
                        const d = new Date(k);
                        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        if (mKey !== currentMonthKey) {
                            if (current) buckets.push(current);
                            currentMonthKey = mKey;
                            current = { key: mKey, label: this.safeToLocaleDateString(new Date(d.getFullYear(), d.getMonth(), 1), { month: 'short', year: '2-digit' }), sums: { revenue: 0, emailsSent: 0, totalOrders: 0, uniqueOpens: 0, uniqueClicks: 0, unsubscribesCount: 0, spamComplaintsCount: 0, bouncesCount: 0, emailCount: 0 } };
                        }
                        const rec = this._dailyAgg.get(k);
                        if (rec) {
                            const s = current.sums; s.revenue += rec.revenue; s.emailsSent += rec.emailsSent; s.totalOrders += rec.totalOrders; s.uniqueOpens += rec.uniqueOpens; s.uniqueClicks += rec.uniqueClicks; s.unsubscribesCount += rec.unsubscribesCount; s.spamComplaintsCount += rec.spamComplaintsCount; s.bouncesCount += rec.bouncesCount; s.emailCount += rec.emailCount;
                        }
                    }
                    if (current) buckets.push(current);
                }
            } else {
                // Subset-specific base bucket cache (independent of metric)
                const baseKey = `${dataSig}|${subsetSig}|${granularity}|${rangeKey}|base`;
                const baseCached = this._seriesBaseCache.get(baseKey);
                if (baseCached) {
                    buckets = baseCached.buckets as any;
                } else {
                    buckets = this._buildBaseBucketsForSubset(campaigns, flows, granularity, startDate, endDate) as any;
                    this._seriesBaseCache.set(baseKey, { built: Date.now(), buckets: buckets as any });
                }
            }

            const series = buckets.map(b => {
                // Derive an ISO date for range computations (avoid parsing label like "Aug 04" -> year 2001)
                let isoDate: string;
                if (granularity === 'daily') {
                    // bucket.key is YYYY-MM-DD
                    isoDate = b.key;
                } else if (granularity === 'weekly') {
                    // key is Monday; use week end (Monday +6) for ordering consistency
                    const parts = b.key.split('-');
                    const dObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                    dObj.setDate(dObj.getDate() + 6);
                    isoDate = dObj.toISOString().slice(0, 10);
                } else { // monthly
                    const [y, m] = b.key.split('-');
                    const dObj = new Date(Number(y), Number(m) - 1, 1);
                    isoDate = dObj.toISOString().slice(0, 10);
                }
                return { value: this._deriveMetricFromSums(metricKey, b.sums as any), date: b.label, iso: isoDate };
            });
            this._timeSeriesCache.set(tsCacheKey, { built: Date.now(), data: series });
            return series;
        } catch (err) {
            console.warn('getMetricTimeSeries fast path failed', err);
            return [];
        }
    }

    /**
     * Returns both primary and compare time series for the given inputs.
     * - Compare is hidden (null) when dateRange is 'all' or when the computed previous window has zero data.
     * - Buckets use the same granularity; alignment is by index for tooltip purposes.
     */
    getMetricTimeSeriesWithCompare(
        campaigns: ProcessedCampaign[],
        flows: ProcessedFlowEmail[],
        metricKey: string,
        dateRange: string,
        granularity: 'daily' | 'weekly' | 'monthly',
        compareMode: 'prev-period' | 'prev-year' = 'prev-period',
        customFrom?: string,
        customTo?: string
    ): { primary: { value: number; date: string }[]; compare: { value: number; date: string }[] | null } {
        try {
            const primary = this.getMetricTimeSeries(campaigns, flows, metricKey, dateRange, granularity, customFrom, customTo);
            // Do not compute compare for 'all'
            if (dateRange === 'all') return { primary, compare: null };

            // Resolve current window to derive previous window
            const range = this._computeDateRangeForTimeSeries(dateRange, customFrom, customTo);
            if (!range) return { primary, compare: null };
            const { startDate, endDate } = range;

            // Compute previous window
            let prevStart = new Date(startDate);
            let prevEnd = new Date(endDate);
            if (compareMode === 'prev-year') {
                prevStart.setFullYear(prevStart.getFullYear() - 1);
                prevEnd.setFullYear(prevEnd.getFullYear() - 1);
                // Handle leap day alignment
                if (startDate.getMonth() === 1 && startDate.getDate() === 29 && prevStart.getMonth() === 2) prevStart.setDate(0);
                if (endDate.getMonth() === 1 && endDate.getDate() === 29 && prevEnd.getMonth() === 2) prevEnd.setDate(0);
            } else {
                prevEnd = new Date(startDate.getTime() - 1);
                prevEnd.setHours(23, 59, 59, 999);
                prevStart = new Date(prevEnd);
                const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
                prevStart.setDate(prevStart.getDate() - days + 1);
                prevStart.setHours(0, 0, 0, 0);
            }

            const prevFromISO = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, '0')}-${String(prevStart.getDate()).padStart(2, '0')}`;
            const prevToISO = `${prevEnd.getFullYear()}-${String(prevEnd.getMonth() + 1).padStart(2, '0')}-${String(prevEnd.getDate()).padStart(2, '0')}`;

            let compare = this.getMetricTimeSeries(campaigns, flows, metricKey, 'custom', granularity, prevFromISO, prevToISO);
            // Normalize compare length to primary (zero-fill to align by index)
            if (compare.length < primary.length) {
                const deficit = primary.length - compare.length;
                const lastLabel = compare.length > 0 ? compare[compare.length - 1].date : '';
                for (let i = 0; i < deficit; i++) compare.push({ value: 0, date: lastLabel });
            } else if (compare.length > primary.length) {
                compare = compare.slice(compare.length - primary.length);
            }
            return { primary, compare };
        } catch (e) {
            console.warn('getMetricTimeSeriesWithCompare failed', e);
            return { primary: [], compare: null };
        }
    }

    // (Removed duplicate _rebuildDailyAggregates and _computeDateRangeForTimeSeries definitions; consolidated earlier in file.)

    getFlowStepTimeSeries(
        flowEmails: ProcessedFlowEmail[],
        flowName: string,
        sequencePosition: number,
        metricKey: string,
        dateRange: string,
        granularity: 'daily' | 'weekly' | 'monthly',
        customFrom?: string,
        customTo?: string
    ) {
        return this.getMetricTimeSeries([], flowEmails.filter(e => e.flowName === flowName && e.sequencePosition === sequencePosition), metricKey, dateRange, granularity, customFrom, customTo);
    }

    // Note: duplicate legacy implementations of _rebuildDailyAggregates and _computeDateRangeForTimeSeries removed.

    getFlowSequenceInfo(flowName: string): FlowSequenceInfo { return this.flowTransformer.getFlowSequenceInfo(flowName, this.flowEmails); }

    getCampaignPerformanceByDayOfWeek(campaigns: ProcessedCampaign[], metricKey: string): DayOfWeekPerformanceData[] {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayData = dayNames.map((day, index) => ({ day, dayIndex: index, value: 0, campaignCount: 0, totalRevenue: 0, totalEmailsSent: 0, totalOrders: 0, totalOpens: 0, totalClicks: 0, totalUnsubs: 0, totalSpam: 0, totalBounces: 0 }));
        campaigns.forEach(c => {
            const d = dayData[c.dayOfWeek];
            d.campaignCount++; d.totalRevenue += c.revenue; d.totalEmailsSent += c.emailsSent; d.totalOrders += c.totalOrders; d.totalOpens += c.uniqueOpens; d.totalClicks += c.uniqueClicks; d.totalUnsubs += c.unsubscribesCount; d.totalSpam += c.spamComplaintsCount; d.totalBounces += c.bouncesCount;
        });
        dayData.forEach(d => {
            if (d.campaignCount === 0) { d.value = 0; return; }
            switch (metricKey) {
                case 'revenue': d.value = d.totalRevenue; break;
                case 'avgOrderValue': d.value = d.totalOrders > 0 ? d.totalRevenue / d.totalOrders : 0; break;
                case 'revenuePerEmail': d.value = d.totalEmailsSent > 0 ? d.totalRevenue / d.totalEmailsSent : 0; break;
                case 'openRate': d.value = d.totalEmailsSent > 0 ? (d.totalOpens / d.totalEmailsSent) * 100 : 0; break;
                case 'clickRate': d.value = d.totalEmailsSent > 0 ? (d.totalClicks / d.totalEmailsSent) * 100 : 0; break;
                case 'clickToOpenRate': d.value = d.totalOpens > 0 ? (d.totalClicks / d.totalOpens) * 100 : 0; break;
                case 'emailsSent': d.value = d.totalEmailsSent; break;
                case 'totalOrders': d.value = d.totalOrders; break;
                case 'conversionRate': d.value = d.totalClicks > 0 ? (d.totalOrders / d.totalClicks) * 100 : 0; break;
                case 'unsubscribeRate': d.value = d.totalEmailsSent > 0 ? (d.totalUnsubs / d.totalEmailsSent) * 100 : 0; break;
                case 'spamRate': d.value = d.totalEmailsSent > 0 ? (d.totalSpam / d.totalEmailsSent) * 100 : 0; break;
                case 'bounceRate': d.value = d.totalEmailsSent > 0 ? (d.totalBounces / d.totalEmailsSent) * 100 : 0; break;
                default: d.value = 0;
            }
        });
        return dayData.map(({ day, dayIndex, value, campaignCount }) => ({ day, dayIndex, value, campaignCount }));
    }

    getCampaignPerformanceByHourOfDay(campaigns: ProcessedCampaign[], metricKey: string): HourOfDayPerformanceData[] {
        const hourData = Array.from({ length: 24 }, (_, hour) => ({ hour, hourLabel: this.formatHourLabel(hour), value: 0, campaignCount: 0, percentageOfTotal: 0, totalRevenue: 0, totalEmailsSent: 0, totalOrders: 0, totalOpens: 0, totalClicks: 0, totalUnsubs: 0, totalSpam: 0, totalBounces: 0 }));
        const totalCampaigns = campaigns.length;
        campaigns.forEach(c => { const h = hourData[c.hourOfDay]; h.campaignCount++; h.totalRevenue += c.revenue; h.totalEmailsSent += c.emailsSent; h.totalOrders += c.totalOrders; h.totalOpens += c.uniqueOpens; h.totalClicks += c.uniqueClicks; h.totalUnsubs += c.unsubscribesCount; h.totalSpam += c.spamComplaintsCount; h.totalBounces += c.bouncesCount; });
        const hoursWithData = hourData.filter(h => h.campaignCount > 0).map(h => {
            h.percentageOfTotal = totalCampaigns > 0 ? (h.campaignCount / totalCampaigns) * 100 : 0;
            switch (metricKey) {
                case 'revenue': h.value = h.totalRevenue; break;
                case 'avgOrderValue': h.value = h.totalOrders > 0 ? h.totalRevenue / h.totalOrders : 0; break;
                case 'revenuePerEmail': h.value = h.totalEmailsSent > 0 ? h.totalRevenue / h.totalEmailsSent : 0; break;
                case 'openRate': h.value = h.totalEmailsSent > 0 ? (h.totalOpens / h.totalEmailsSent) * 100 : 0; break;
                case 'clickRate': h.value = h.totalEmailsSent > 0 ? (h.totalClicks / h.totalEmailsSent) * 100 : 0; break;
                case 'clickToOpenRate': h.value = h.totalOpens > 0 ? (h.totalClicks / h.totalOpens) * 100 : 0; break;
                case 'emailsSent': h.value = h.totalEmailsSent; break;
                case 'totalOrders': h.value = h.totalOrders; break;
                case 'conversionRate': h.value = h.totalClicks > 0 ? (h.totalOrders / h.totalClicks) * 100 : 0; break;
                case 'unsubscribeRate': h.value = h.totalEmailsSent > 0 ? (h.totalUnsubs / h.totalEmailsSent) * 100 : 0; break;
                case 'spamRate': h.value = h.totalEmailsSent > 0 ? (h.totalSpam / h.totalEmailsSent) * 100 : 0; break;
                case 'bounceRate': h.value = h.totalEmailsSent > 0 ? (h.totalBounces / h.totalEmailsSent) * 100 : 0; break;
                default: h.value = 0;
            }
            return { hour: h.hour, hourLabel: h.hourLabel, value: h.value, campaignCount: h.campaignCount, percentageOfTotal: h.percentageOfTotal };
        });
        return hoursWithData.sort((a, b) => Math.abs(a.value - b.value) < 0.01 ? a.hour - b.hour : b.value - a.value);
    }

    private formatHourLabel(hour: number): string { if (hour === 0) return '12 AM'; if (hour < 12) return `${hour} AM`; if (hour === 12) return '12 PM'; return `${hour - 12} PM`; }

    getGranularityForDateRange(dateRange: string): 'daily' | 'weekly' | 'monthly' {
        try {
            console.log('getGranularityForDateRange called with:', dateRange);

            if (dateRange === 'all') {
                // Safely handle case where no data exists yet
                if (this.campaigns.length === 0 && this.flowEmails.length === 0) {
                    console.log('No data available, returning daily granularity');
                    return 'daily'; // Safe fallback
                }

                // Get valid timestamps with better error handling
                const campaignDates = this.campaigns
                    .map(c => {
                        try {
                            const time = c.sentDate instanceof Date ? c.sentDate.getTime() : NaN;
                            return !isNaN(time) && isFinite(time) ? time : null;
                        } catch {
                            return null;
                        }
                    })
                    .filter((t): t is number => t !== null);

                const flowDates = this.flowEmails
                    .map(f => {
                        try {
                            const time = f.sentDate instanceof Date ? f.sentDate.getTime() : NaN;
                            return !isNaN(time) && isFinite(time) ? time : null;
                        } catch {
                            return null;
                        }
                    })
                    .filter((t): t is number => t !== null);

                const allDates = [...campaignDates, ...flowDates];
                console.log('Valid dates found:', allDates.length);

                if (allDates.length === 0) {
                    console.log('No valid dates found, returning daily granularity');
                    return 'daily'; // Safe fallback
                }

                const oldestTime = Math.min(...allDates);
                const newestTime = Math.max(...allDates);

                // Validate timestamps
                if (!isFinite(oldestTime) || !isFinite(newestTime) || isNaN(oldestTime) || isNaN(newestTime)) {
                    console.warn('Invalid timestamps calculated, returning daily granularity');
                    return 'daily';
                }

                const daysDiff = Math.floor((newestTime - oldestTime) / (1000 * 60 * 60 * 24));
                console.log('Days difference calculated:', daysDiff);

                if (daysDiff <= 60) return 'daily';
                if (daysDiff <= 365) return 'weekly';
                return 'monthly';
            }

            const days = parseInt(dateRange.replace('d', ''));
            if (isNaN(days) || days <= 0) {
                console.warn('Invalid day range, returning daily granularity');
                return 'daily'; // Safe fallback
            }

            if (days <= 60) return 'daily';
            if (days <= 365) return 'weekly';
            return 'monthly';
        } catch (error) {
            console.error('Error in getGranularityForDateRange:', error, 'for dateRange:', dateRange);
            return 'daily'; // Safe fallback
        }
    }

    getAggregatedMetricsForPeriod(
        campaigns: ProcessedCampaign[],
        flows: ProcessedFlowEmail[],
        startDate: Date,
        endDate: Date,
    ): AggregatedMetrics {
        const filteredCampaigns = campaigns.filter(c => c.sentDate >= startDate && c.sentDate <= endDate);
        const filteredFlows = flows.filter(f => f.sentDate >= startDate && f.sentDate <= endDate);
        const allEmails = [...filteredCampaigns, ...filteredFlows];
        if (allEmails.length === 0) return { totalRevenue: 0, emailsSent: 0, totalOrders: 0, openRate: 0, clickRate: 0, conversionRate: 0, unsubscribeRate: 0, spamRate: 0, bounceRate: 0, avgOrderValue: 0, revenuePerEmail: 0, clickToOpenRate: 0, emailCount: 0 };
        const totalRevenue = allEmails.reduce((s, e) => s + e.revenue, 0);
        const emailsSent = allEmails.reduce((s, e) => s + e.emailsSent, 0);
        const totalOrders = allEmails.reduce((s, e) => s + e.totalOrders, 0);
        const totalOpens = allEmails.reduce((s, e) => s + e.uniqueOpens, 0);
        const totalClicks = allEmails.reduce((s, e) => s + e.uniqueClicks, 0);
        const totalUnsubs = allEmails.reduce((s, e) => s + e.unsubscribesCount, 0);
        const totalSpam = allEmails.reduce((s, e) => s + e.spamComplaintsCount, 0);
        const totalBounces = allEmails.reduce((s, e) => s + e.bouncesCount, 0);
        return {
            totalRevenue,
            emailsSent,
            totalOrders,
            openRate: emailsSent > 0 ? (totalOpens / emailsSent) * 100 : 0,
            clickRate: emailsSent > 0 ? (totalClicks / emailsSent) * 100 : 0,
            conversionRate: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
            unsubscribeRate: emailsSent > 0 ? (totalUnsubs / emailsSent) * 100 : 0,
            spamRate: emailsSent > 0 ? (totalSpam / emailsSent) * 100 : 0,
            bounceRate: emailsSent > 0 ? (totalBounces / emailsSent) * 100 : 0,
            avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
            revenuePerEmail: emailsSent > 0 ? totalRevenue / emailsSent : 0,
            clickToOpenRate: totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0,
            emailCount: allEmails.length,
        };
    }

    /**
     * Public helper to resolve the exact start/end Date objects used by charts/time-series
     * for a given dateRange input (including custom). This mirrors the private
     * _computeDateRangeForTimeSeries logic so that external modules (e.g., exporters)
     * can align bucket boundaries and comparisons exactly with the UI.
     */
    getResolvedDateRange(
        dateRange: string,
        customFrom?: string,
        customTo?: string
    ): { startDate: Date; endDate: Date } | null {
        try {
            // Delegate to the same internal logic used by time series.
            // eslint-disable-next-line
            // @ts-ignore - accessing private method within the class implementation scope is allowed
            return this._computeDateRangeForTimeSeries(dateRange, customFrom, customTo);
        } catch {
            return null;
        }
    }

    getAudienceInsights(): AudienceInsights { return this.subscriberTransformer.getAudienceInsights(this.subscribers); }

    getSummaryStats() {
        return {
            campaigns: this.campaigns.length > 0 ? { ...this.campaignSummary(this.campaigns) } : null,
            subscribers: this.subscribers.length > 0 ? { ...this.subscriberSummary(this.subscribers) } : null,
            flows: { totalFlows: this.getUniqueFlowNames().length, totalEmails: this.getFlowEmails().length },
        };
    }

    private campaignSummary(campaigns: ProcessedCampaign[]) {
        const dates = campaigns.map(c => c.sentDate.getTime());
        const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);
        const totalEmailsSent = campaigns.reduce((s, c) => s + c.emailsSent, 0);
        const weightedOpenRate = totalEmailsSent > 0 ? campaigns.reduce((s, c) => s + (c.openRate * c.emailsSent), 0) / totalEmailsSent : 0;
        const weightedClickRate = totalEmailsSent > 0 ? campaigns.reduce((s, c) => s + (c.clickRate * c.emailsSent), 0) / totalEmailsSent : 0;
        const weightedConversionRate = totalEmailsSent > 0 ? campaigns.reduce((s, c) => s + (c.conversionRate * c.emailsSent), 0) / totalEmailsSent : 0;
        return { totalCampaigns: campaigns.length, dateRange: { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) }, totalRevenue, totalEmailsSent, avgOpenRate: weightedOpenRate, avgClickRate: weightedClickRate, avgConversionRate: weightedConversionRate };
    }

    private subscriberSummary(subscribers: ProcessedSubscriber[]) {
        const buyers = subscribers.filter(s => s.isBuyer);
        const totalRevenue = subscribers.reduce((s, su) => s + su.totalClv, 0);
        const avgLifetimeDays = subscribers.reduce((s, su) => s + su.lifetimeInDays, 0) / subscribers.length;
        const consentCount = subscribers.filter(su => su.emailConsent).length;
        return { totalSubscribers: subscribers.length, totalBuyers: buyers.length, buyerPercentage: (buyers.length / subscribers.length) * 100, avgLifetimeDays, totalRevenue, avgRevenuePerSubscriber: totalRevenue / subscribers.length, avgRevenuePerBuyer: buyers.length > 0 ? totalRevenue / buyers.length : 0, consentRate: (consentCount / subscribers.length) * 100 };
    }

    calculatePeriodOverPeriodChange(
        metricKey: string,
        dateRange: string,
        dataType: 'all' | 'campaigns' | 'flows' = 'all',
        options?: { flowName?: string; compareMode?: 'prev-period' | 'prev-year' }
    ): { currentValue: number; previousValue: number | null; changePercent: number; isPositive: boolean; currentPeriod?: { startDate: Date; endDate: Date }; previousPeriod?: { startDate: Date; endDate: Date } } {
        // Threshold constants (Option C implementation)
        const MIN_EMAILS_SENT = 20;
        const MIN_REVENUE = 50; // USD
        const MIN_ORDERS = 3;
        let endDate: Date;
        let startDate: Date;
        let periodDays: number;

        // Handle custom date ranges
        if (dateRange.includes('custom:')) {
            const parts = dateRange.split(':');
            startDate = new Date(parts[1]);
            endDate = new Date(parts[2]);
            endDate.setHours(23, 59, 59, 999); // Include full end day
            startDate.setHours(0, 0, 0, 0);
            periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        } else if (dateRange === 'all') {
            return { currentValue: 0, previousValue: 0, changePercent: 0, isPositive: true, currentPeriod: undefined, previousPeriod: undefined };
        } else {
            // Standard preset ranges
            endDate = this.getLastEmailDate();
            endDate.setHours(23, 59, 59, 999);
            periodDays = parseInt(dateRange.replace('d', ''));
            startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - periodDays + 1);
            startDate.setHours(0, 0, 0, 0);
        }

        // Comparison mode (default prev-period)
        const compareMode = options?.compareMode || 'prev-period';
        let prevStartDate: Date; let prevEndDate: Date;
        if (compareMode === 'prev-year') {
            prevStartDate = new Date(startDate);
            prevEndDate = new Date(endDate);
            prevStartDate.setFullYear(prevStartDate.getFullYear() - 1);
            prevEndDate.setFullYear(prevEndDate.getFullYear() - 1);
            if (startDate.getMonth() === 1 && startDate.getDate() === 29 && prevStartDate.getMonth() === 2) prevStartDate.setDate(0);
            if (endDate.getMonth() === 1 && endDate.getDate() === 29 && prevEndDate.getMonth() === 2) prevEndDate.setDate(0);
        } else {
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
            prevEndDate.setHours(23, 59, 59, 999);
            prevStartDate = new Date(prevEndDate);
            prevStartDate.setDate(prevStartDate.getDate() - periodDays + 1);
            prevStartDate.setHours(0, 0, 0, 0);
        }

        // Get data based on type
        let campaignsToUse = this.campaigns;
        let flowsToUse = this.flowEmails;

        if (dataType === 'campaigns') {
            flowsToUse = [];
        } else if (dataType === 'flows') {
            campaignsToUse = [];
        }

        // Optional filter by flow name when analyzing flows
        if (options?.flowName && options.flowName !== 'all') {
            flowsToUse = flowsToUse.filter(f => f.flowName === options.flowName);
        }

        // Get metrics for both periods
        const currentMetrics = this.getAggregatedMetricsForPeriod(
            campaignsToUse,
            flowsToUse,
            startDate,
            endDate
        );

        // Determine if the previous window is fully covered by available data in the subset
        let earliestTime = Infinity; let latestTime = -Infinity;
        const scan = (arr: { sentDate: Date }[]) => {
            for (const e of arr) {
                if (!e.sentDate || !(e.sentDate instanceof Date)) continue;
                const t = e.sentDate.getTime();
                if (!isFinite(t)) continue;
                if (t < earliestTime) earliestTime = t;
                if (t > latestTime) latestTime = t;
            }
        };
        scan(campaignsToUse as any);
        scan(flowsToUse as any);
        const prevWindowCovered = isFinite(earliestTime) && isFinite(latestTime)
            ? (earliestTime <= prevStartDate.getTime() && latestTime >= prevEndDate.getTime())
            : false;

        const previousMetrics = prevWindowCovered ? this.getAggregatedMetricsForPeriod(
            campaignsToUse,
            flowsToUse,
            prevStartDate,
            prevEndDate
        ) : { totalRevenue: 0, emailsSent: 0, totalOrders: 0, openRate: 0, clickRate: 0, conversionRate: 0, unsubscribeRate: 0, spamRate: 0, bounceRate: 0, avgOrderValue: 0, revenuePerEmail: 0, clickToOpenRate: 0, emailCount: 0 };

        // Baseline volume assessment (dense-day requirement removed)
        const baselineEmails = previousMetrics.emailsSent;
        const baselineRevenue = previousMetrics.totalRevenue;
        const baselineOrders = previousMetrics.totalOrders;
        const baselineHasAnyActivity = (baselineEmails + baselineRevenue + baselineOrders) > 0;
        const baselineMeetsVolume = baselineEmails >= MIN_EMAILS_SENT || baselineRevenue >= MIN_REVENUE || baselineOrders >= MIN_ORDERS;
        const lowBaseline = baselineHasAnyActivity && !baselineMeetsVolume;

        // Extract the specific metric value
        let currentValue = 0;
        let previousValue = 0;

        switch (metricKey) {
            case 'totalRevenue':
                currentValue = currentMetrics.totalRevenue;
                previousValue = previousMetrics.totalRevenue;
                break;
            case 'averageOrderValue':
            case 'avgOrderValue':
                currentValue = currentMetrics.avgOrderValue;
                previousValue = previousMetrics.avgOrderValue;
                break;
            case 'revenuePerEmail':
                currentValue = currentMetrics.revenuePerEmail;
                previousValue = previousMetrics.revenuePerEmail;
                break;
            case 'openRate':
                currentValue = currentMetrics.openRate;
                previousValue = previousMetrics.openRate;
                break;
            case 'clickRate':
                currentValue = currentMetrics.clickRate;
                previousValue = previousMetrics.clickRate;
                break;
            case 'clickToOpenRate':
                currentValue = currentMetrics.clickToOpenRate;
                previousValue = previousMetrics.clickToOpenRate;
                break;
            case 'emailsSent':
                currentValue = currentMetrics.emailsSent;
                previousValue = previousMetrics.emailsSent;
                break;
            case 'totalOrders':
                currentValue = currentMetrics.totalOrders;
                previousValue = previousMetrics.totalOrders;
                break;
            case 'conversionRate':
                currentValue = currentMetrics.conversionRate;
                previousValue = previousMetrics.conversionRate;
                break;
            case 'unsubscribeRate':
                currentValue = currentMetrics.unsubscribeRate;
                previousValue = previousMetrics.unsubscribeRate;
                break;
            case 'spamRate':
                currentValue = currentMetrics.spamRate;
                previousValue = previousMetrics.spamRate;
                break;
            case 'bounceRate':
                currentValue = currentMetrics.bounceRate;
                previousValue = previousMetrics.bounceRate;
                break;
        }

        // If absolutely no baseline activity, keep previous as null (insufficient)
    if (!baselineHasAnyActivity || !prevWindowCovered) {
            return {
                currentValue,
                previousValue: null,
                changePercent: 0,
                isPositive: true,
                currentPeriod: { startDate, endDate },
        previousPeriod: undefined
            };
        }

        // Calculate percentage change only with complete baseline
        let changePercent = 0;
        if (previousValue !== 0) {
            changePercent = ((currentValue - previousValue) / previousValue) * 100;
        } else if (currentValue > 0) {
            // When baseline value is zero (even with volume in other metrics), keep neutral change to avoid spikes
            changePercent = 0;
        }

        // Determine if change is positive (good) based on metric type
        const negativeMetrics = ['unsubscribeRate', 'spamRate', 'bounceRate'];
        const isPositive = negativeMetrics.includes(metricKey) ? changePercent <= 0 : changePercent >= 0;

        const noBaselineMetric = previousValue === 0;
        return {
            currentValue,
            previousValue: noBaselineMetric ? null : previousValue,
            changePercent: noBaselineMetric ? 0 : changePercent,
            isPositive,
            currentPeriod: { startDate, endDate },
            previousPeriod: noBaselineMetric ? undefined : { startDate: prevStartDate, endDate: prevEndDate },
            // Added metadata for future UI/tooltips (non-breaking extra fields ok)
            // @ts-ignore - extended metadata (call sites ignore unknown fields gracefully)
            baselineInfo: {
                emails: baselineEmails,
                revenue: baselineRevenue,
                orders: baselineOrders,
                low: lowBaseline,
                meetsVolume: baselineMeetsVolume
            }
        };
    }

    /**
     * Check whether a comparison window (prev-period or prev-year) is fully available
     * for the combined dataset (campaigns + flows). Used to enable/disable global controls.
     */
    isCompareWindowAvailable(
        dateRange: string,
        mode: 'prev-period' | 'prev-year',
        customFrom?: string,
        customTo?: string
    ): boolean {
        try {
            // All-time intentionally disables comparison
            if (dateRange === 'all') return false;

            // Resolve current period window
            let startDate: Date; let endDate: Date; let periodDays = 0;
            if (dateRange === 'custom') {
                if (!customFrom || !customTo) return false;
                startDate = new Date(customFrom + 'T00:00:00');
                endDate = new Date(customTo + 'T23:59:59');
                periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
            } else if (dateRange.includes('custom:')) {
                const parts = dateRange.split(':');
                startDate = new Date(parts[1]);
                endDate = new Date(parts[2]); endDate.setHours(23, 59, 59, 999);
                startDate.setHours(0, 0, 0, 0);
                periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
            } else {
                const days = parseInt(dateRange.replace('d', ''));
                if (!Number.isFinite(days) || days <= 0) return false;
                endDate = this.getLastEmailDate(); endDate.setHours(23, 59, 59, 999);
                startDate = new Date(endDate); startDate.setDate(startDate.getDate() - days + 1); startDate.setHours(0, 0, 0, 0);
                periodDays = days;
            }

            let prevStart = new Date(startDate); let prevEnd = new Date(endDate);
            if (mode === 'prev-year') { prevStart.setFullYear(prevStart.getFullYear() - 1); prevEnd.setFullYear(prevEnd.getFullYear() - 1); }
            else { prevEnd = new Date(startDate.getTime() - 1); prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - periodDays + 1); prevStart.setHours(0, 0, 0, 0); prevEnd.setHours(23, 59, 59, 999); }

            // Scan combined dataset for coverage
            let earliest = Infinity; let latest = -Infinity;
            const scan = (arr: { sentDate: Date }[]) => {
                for (const e of arr) {
                    if (!e.sentDate || !(e.sentDate instanceof Date)) continue;
                    const t = e.sentDate.getTime();
                    if (!isFinite(t)) continue;
                    if (t < earliest) earliest = t;
                    if (t > latest) latest = t;
                }
            };
            scan(this.campaigns as any);
            scan(this.flowEmails as any);
            if (!isFinite(earliest) || !isFinite(latest)) return false;
            return earliest <= prevStart.getTime() && latest >= prevEnd.getTime();
        } catch {
            return false;
        }
    }

    /**
     * Build a weekly time series for a given metric across ALL emails (campaigns + flows).
     * Weeks are Monday-based. Returns an ordered list of weekStart dates (Date at 00:00) with metric values.
     * For rate metrics, if denominator is zero the value will be 0 (consistent with other helpers) rather than null.
     * This is exposed publicly to support dynamic benchmarking logic.
     */
    // Removed getWeeklyMetricSeries (adaptive benchmarking revert)
}
