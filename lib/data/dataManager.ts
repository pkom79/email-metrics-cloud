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

    // Dynamic storage keys based on user
    private get storageKey() {
        const userId = DataManager.currentUserId || 'anonymous';
        return `em:dataset:${userId}:v1`;
    }

    private get idbKey() {
        const userId = DataManager.currentUserId || 'anonymous';
        return `dataset:${userId}:v1`;
    }

    static setUserId(userId: string | null) {
        if (DataManager.currentUserId !== userId) {
            DataManager.currentUserId = userId;
            // Clear current instance to force reload with new user data
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
    }

    constructor() {
        // Hydrate from storage on client if available
        if (typeof window !== 'undefined') {
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw) as {
                        campaigns?: any[];
                        flowEmails?: any[];
                        subscribers?: any[];
                    };
                    const revive = (d: any) => (d instanceof Date ? d : new Date(d));
                    this.campaigns = (parsed.campaigns || []).map((c: any) => ({ ...c, sentDate: revive(c.sentDate) }));
                    this.flowEmails = (parsed.flowEmails || []).map((f: any) => ({ ...f, sentDate: revive(f.sentDate) }));
                    this.subscribers = (parsed.subscribers || []);
                    this.isRealDataLoaded = this.campaigns.length > 0 || this.flowEmails.length > 0 || this.subscribers.length > 0;
                    try { window.dispatchEvent(new CustomEvent('em:dataset-hydrated')); } catch { /* ignore */ }
                }
            } catch {
                // ignore storage issues
            }
            // Fire-and-forget hydrate from IndexedDB (larger capacity)
            // If IDB has data and local arrays are empty, hydrate and mark loaded.
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
                        try { window.dispatchEvent(new CustomEvent('em:dataset-hydrated')); } catch { /* ignore */ }
                    }
                } catch { /* ignore */ }
            })();
        }
    }

    // Public method for consumers to ensure hydration from durable storage.
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
                try { window.dispatchEvent(new CustomEvent('em:dataset-hydrated')); } catch { }
                return this.isRealDataLoaded;
            }
        } catch { }
        return false;
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
            onProgress?.(this.loadProgress);
            if (this.isRealDataLoaded) this.persistToStorage();
            return { success: errors.length === 0, errors };
        } catch (e: any) {
            errors.push(e?.message || 'Unknown error');
            return { success: false, errors };
        }
    }

    resetToMockData(): void {
        this.campaigns = []; this.flowEmails = []; this.subscribers = []; this.isRealDataLoaded = false;
        this.loadProgress = { campaigns: { loaded: false, progress: 0 }, flows: { loaded: false, progress: 0 }, subscribers: { loaded: false, progress: 0 } };
    }

    getLoadProgress(): LoadProgress { return this.loadProgress; }
    hasRealData(): boolean { return this.isRealDataLoaded; }

    getCampaigns(): ProcessedCampaign[] { return this.campaigns; }
    getFlowEmails(): ProcessedFlowEmail[] { return this.flowEmails; }
    getSubscribers(): ProcessedSubscriber[] { return this.subscribers; }

    getUniqueFlowNames(): string[] { return this.flowTransformer.getUniqueFlowNames(this.flowEmails); }

    getLastEmailDate(): Date {
        try {
            // Get valid timestamps from campaigns
            const campaignDates = this.campaigns
                .map(c => c.sentDate instanceof Date ? c.sentDate.getTime() : NaN)
                .filter(t => !isNaN(t) && isFinite(t));

            // Get valid timestamps from flow emails
            const flowDates = this.flowEmails
                .map(f => f.sentDate instanceof Date ? f.sentDate.getTime() : NaN)
                .filter(t => !isNaN(t) && isFinite(t));

            const allDates = [...campaignDates, ...flowDates];

            if (allDates.length === 0) {
                console.warn('getLastEmailDate: No valid dates found, returning current date');
                return new Date();
            }

            const maxTime = Math.max(...allDates);

            // Validate the result
            if (isNaN(maxTime) || !isFinite(maxTime)) {
                console.warn('getLastEmailDate: Invalid max time calculated, returning current date');
                return new Date();
            }

            const result = new Date(maxTime);

            // Final validation
            if (isNaN(result.getTime())) {
                console.warn('getLastEmailDate: Invalid date result, returning current date');
                return new Date();
            }

            return result;
        } catch (error) {
            console.error('Error in getLastEmailDate:', error);
            return new Date(); // Safe fallback
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
        const startTime = Date.now();
        const maxExecutionTime = 10000; // 10 seconds max execution time

        try {
            const allEmails = [...campaigns, ...flows];
            if (allEmails.length === 0) return [];

            // Check execution time periodically
            if (Date.now() - startTime > maxExecutionTime) {
                console.warn('getMetricTimeSeries: Execution timeout, returning empty result');
                return [];
            }

            // Filter out emails with invalid dates before any processing
            const validEmails = allEmails.filter(email => {
                try {
                    // Enhanced validation
                    if (!email || !email.sentDate) {
                        console.warn('validEmails filter: Email missing sentDate:', email);
                        return false;
                    }

                    if (!(email.sentDate instanceof Date)) {
                        console.warn('validEmails filter: sentDate not a Date object:', typeof email.sentDate, email.sentDate);
                        return false;
                    }

                    const timestamp = email.sentDate.getTime();
                    if (isNaN(timestamp) || !isFinite(timestamp)) {
                        console.warn('validEmails filter: Invalid timestamp:', timestamp);
                        return false;
                    }

                    // Check for reasonable date range (email marketing didn't exist before 1990)
                    const year = email.sentDate.getFullYear();
                    if (year < 1990 || year > 2030) {
                        console.warn('validEmails filter: Date year out of range:', year);
                        return false;
                    }

                    return timestamp > 0;
                } catch (e) {
                    console.warn('validEmails filter: Exception during validation:', e, 'for email:', email);
                    return false;
                }
            });

            if (validEmails.length === 0) {
                console.warn('No valid emails found with proper dates');
                return [];
            }

            // Helpers for local-date-safe bucketing/labels with validation
            const cloneAtMidnight = (d: Date) => {
                if (!d || isNaN(d.getTime())) {
                    console.warn('Invalid date passed to cloneAtMidnight:', d);
                    return new Date(); // Return current date as fallback
                }
                const n = new Date(d);
                n.setHours(0, 0, 0, 0);
                return n;
            };
            const dateKeyLocal = (d: Date) => {
                if (!d || isNaN(d.getTime())) {
                    console.warn('Invalid date passed to dateKeyLocal:', d);
                    const fallback = new Date();
                    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
                }
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            };
            const mondayOfLocal = (dt: Date) => {
                if (!dt || isNaN(dt.getTime())) {
                    console.warn('Invalid date passed to mondayOfLocal:', dt);
                    return cloneAtMidnight(new Date()); // Return current Monday as fallback
                }
                const d = cloneAtMidnight(dt);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                d.setDate(diff);
                return d;
            };

            let endDate: Date;
            let startDate: Date;

            // Handle custom date ranges
            if (dateRange === 'custom' && customFrom && customTo) {
                // Parse dates as local dates to avoid timezone issues
                startDate = new Date(customFrom + 'T00:00:00'); // Force local time interpretation
                endDate = new Date(customTo + 'T23:59:59'); // Force local time interpretation
            } else if (dateRange === 'all') {
                // Safe timestamp extraction from valid emails only
                const timestamps = validEmails.map(e => e.sentDate.getTime()).filter(ts => isFinite(ts));
                if (timestamps.length === 0) {
                    console.warn('No valid timestamps found in emails');
                    return [];
                }
                const endTs = Math.max(...timestamps);
                endDate = new Date(endTs);
                endDate.setHours(23, 59, 59, 999);
                const oldestTs = Math.min(...timestamps);
                startDate = new Date(oldestTs);
                startDate.setHours(0, 0, 0, 0);
            } else {
                // Safe timestamp extraction from valid emails only
                const timestamps = validEmails.map(e => e.sentDate.getTime()).filter(ts => isFinite(ts));
                if (timestamps.length === 0) {
                    console.warn('No valid timestamps found in emails');
                    return [];
                }
                const endTs = Math.max(...timestamps);
                endDate = new Date(endTs);
                endDate.setHours(23, 59, 59, 999);
                startDate = new Date(endDate);
                const days = parseInt(dateRange.replace('d', ''));
                startDate.setDate(startDate.getDate() - days + 1); // inclusive window
                startDate.setHours(0, 0, 0, 0);
            }

            const filteredEmails = validEmails.filter(e => e.sentDate >= startDate && e.sentDate <= endDate);

            // Performance safeguard: limit the number of data points to prevent browser crashes
            const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            let maxDataPoints = 0;
            let adjustedGranularity = granularity;

            if (granularity === 'daily') {
                maxDataPoints = daysDiff;
                // If too many daily points, force weekly granularity
                if (maxDataPoints > 365) {
                    console.warn(`Performance protection: ${maxDataPoints} daily points requested, switching to weekly`);
                    adjustedGranularity = 'weekly';
                    maxDataPoints = Math.ceil(daysDiff / 7);
                }
            } else if (granularity === 'weekly') {
                maxDataPoints = Math.ceil(daysDiff / 7);
                // If too many weekly points, force monthly granularity
                if (maxDataPoints > 104) { // ~2 years
                    console.warn(`Performance protection: ${maxDataPoints} weekly points requested, switching to monthly`);
                    adjustedGranularity = 'monthly';
                    maxDataPoints = Math.ceil(daysDiff / 30);
                }
            } else {
                maxDataPoints = Math.ceil(daysDiff / 30);
            }

            // Ultimate safeguard: if still too many points, limit the dataset
            if (maxDataPoints > 200) {
                console.warn(`Performance protection: ${maxDataPoints} data points would cause performance issues, limiting to 200 most recent periods`);
                if (adjustedGranularity === 'monthly') {
                    // Limit to last 200 months (~16 years)
                    const limitedStartDate = new Date(endDate);
                    limitedStartDate.setMonth(limitedStartDate.getMonth() - 200);
                    startDate = limitedStartDate;
                } else if (adjustedGranularity === 'weekly') {
                    // Limit to last 200 weeks (~4 years)
                    const limitedStartDate = new Date(endDate);
                    limitedStartDate.setDate(limitedStartDate.getDate() - (200 * 7));
                    startDate = limitedStartDate;
                } else {
                    // Limit to last 200 days
                    const limitedStartDate = new Date(endDate);
                    limitedStartDate.setDate(limitedStartDate.getDate() - 200);
                    startDate = limitedStartDate;
                }

                // Re-filter emails with adjusted date range
                const reFilteredEmails = validEmails.filter(e => e.sentDate >= startDate && e.sentDate <= endDate);
                console.log(`Performance protection: Filtered emails from ${filteredEmails.length} to ${reFilteredEmails.length}`);
            }

            const finalFilteredEmails = validEmails.filter(e => e.sentDate >= startDate && e.sentDate <= endDate);

            // Additional performance safeguard: limit number of emails processed
            const maxEmailsToProcess = 50000; // Reasonable limit for browser performance
            let emailsToProcess = finalFilteredEmails;

            if (finalFilteredEmails.length > maxEmailsToProcess) {
                console.warn(`Performance protection: ${finalFilteredEmails.length} emails found, limiting to ${maxEmailsToProcess} most recent emails`);
                // Sort by date descending and take the most recent emails
                emailsToProcess = finalFilteredEmails
                    .sort((a, b) => b.sentDate.getTime() - a.sentDate.getTime())
                    .slice(0, maxEmailsToProcess);
            }

            console.log(`Processing ${emailsToProcess.length} emails with ${adjustedGranularity} granularity`);

            // Build buckets with adjusted granularity
            const buckets = new Map<string, { emails: typeof allEmails; label: string }>();
            const start = cloneAtMidnight(startDate); const end = cloneAtMidnight(endDate);

            console.log(`Building buckets with ${adjustedGranularity} granularity for ${Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days`);

            // Add safeguard counters to prevent infinite loops
            let bucketCount = 0;
            const maxBuckets = 250; // Hard limit on number of buckets

            if (adjustedGranularity === 'daily') {
                for (let d = new Date(start); d <= end && bucketCount < maxBuckets; d.setDate(d.getDate() + 1)) {
                    const key = dateKeyLocal(d); const label = this.safeToLocaleDateString(d, { month: 'short', day: 'numeric' });
                    if (!buckets.has(key)) {
                        buckets.set(key, { emails: [], label });
                        bucketCount++;
                    }

                    // Additional safeguard against infinite loops
                    if (bucketCount % 100 === 0) {
                        console.log(`Created ${bucketCount} daily buckets, current date: ${d.toISOString().split('T')[0]}`);
                    }
                }
            } else if (adjustedGranularity === 'weekly') {
                for (let d = mondayOfLocal(start); d <= end && bucketCount < maxBuckets; d.setDate(d.getDate() + 7)) {
                    const key = dateKeyLocal(d);
                    const weekEnd = new Date(d); weekEnd.setDate(weekEnd.getDate() + 6);
                    const cappedEnd = weekEnd > end ? end : weekEnd;
                    const label = this.safeToLocaleDateString(cappedEnd, { month: 'short', day: 'numeric' });
                    if (!buckets.has(key)) {
                        buckets.set(key, { emails: [], label });
                        bucketCount++;
                    }

                    // Additional safeguard against infinite loops
                    if (bucketCount % 50 === 0) {
                        console.log(`Created ${bucketCount} weekly buckets, current date: ${d.toISOString().split('T')[0]}`);
                    }
                }
            } else {
                // Enhanced monthly loop with better safeguards
                for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end && bucketCount < maxBuckets; bucketCount++) {
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const label = this.safeToLocaleDateString(d, { month: 'short', year: '2-digit' });

                    if (!buckets.has(key)) {
                        buckets.set(key, { emails: [], label });
                    }

                    // Additional safeguard logging
                    if (bucketCount % 20 === 0) {
                        console.log(`Created ${bucketCount} monthly buckets, current date: ${d.toISOString().split('T')[0]}`);
                    }

                    // Advance to next month with validation
                    const nextMonth = d.getMonth() + 1;
                    const nextYear = nextMonth > 11 ? d.getFullYear() + 1 : d.getFullYear();
                    const adjustedMonth = nextMonth > 11 ? 0 : nextMonth;

                    d = new Date(nextYear, adjustedMonth, 1);

                    // Validate the new date
                    if (isNaN(d.getTime()) || d.getFullYear() > 2030) {
                        console.warn('Monthly loop: Invalid date generated, breaking loop:', d);
                        break;
                    }
                }
            }

            console.log(`Created ${bucketCount} buckets total for ${adjustedGranularity} granularity`);

            if (bucketCount >= maxBuckets) {
                console.warn(`Bucket creation limited to ${maxBuckets} to prevent performance issues`);
            }

            emailsToProcess.forEach((email, index) => {
                try {
                    // Check execution time every 1000 emails
                    if (index % 1000 === 0 && Date.now() - startTime > maxExecutionTime) {
                        console.warn(`getMetricTimeSeries: Execution timeout at email ${index}, stopping processing`);
                        return;
                    }

                    // Additional validation before processing each email
                    if (!email.sentDate || !(email.sentDate instanceof Date) || isNaN(email.sentDate.getTime())) {
                        console.warn('Skipping email with invalid sentDate in forEach:', email);
                        return;
                    }

                    const date = new Date(email.sentDate);

                    // Validate the cloned date
                    if (isNaN(date.getTime())) {
                        console.warn('Skipping email with invalid cloned date:', date);
                        return;
                    }

                    let key: string; let label: string;
                    if (adjustedGranularity === 'daily') {
                        key = dateKeyLocal(date);
                        label = this.safeToLocaleDateString(date, { month: 'short', day: 'numeric' });
                    }
                    else if (adjustedGranularity === 'weekly') {
                        const monday = mondayOfLocal(date);
                        key = dateKeyLocal(monday);
                        const weekEnd = new Date(monday);
                        weekEnd.setDate(weekEnd.getDate() + 6);
                        const cappedEnd = weekEnd > end ? end : weekEnd;
                        label = this.safeToLocaleDateString(cappedEnd, { month: 'short', day: 'numeric' });
                    }
                    else {
                        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                        label = this.safeToLocaleDateString(new Date(date.getFullYear(), date.getMonth(), 1), { month: 'short', year: '2-digit' });
                    }
                    if (!buckets.has(key)) buckets.set(key, { emails: [], label });
                    buckets.get(key)!.emails.push(email);
                } catch (emailError) {
                    console.warn('Error processing email in forEach:', emailError, 'for email:', email);
                }
            });

            // Check execution time before final calculations
            if (Date.now() - startTime > maxExecutionTime) {
                console.warn('getMetricTimeSeries: Execution timeout before final calculations, returning partial result');
                return [];
            }

            const sortedKeys = Array.from(buckets.keys()).sort();
            const timeSeriesData: { value: number; date: string }[] = [];

            console.log(`Processing ${sortedKeys.length} time buckets for final calculations`);

            sortedKeys.forEach((key, index) => {
                // Check timeout periodically during calculations
                if (index % 50 === 0 && Date.now() - startTime > maxExecutionTime) {
                    console.warn(`getMetricTimeSeries: Execution timeout at bucket ${index}, returning partial result`);
                    return;
                }
                const bucket = buckets.get(key)!;
                const emailsInBucket = bucket.emails as typeof allEmails;
                let value = 0;
                if (['revenue', 'avgOrderValue', 'revenuePerEmail'].includes(metricKey)) {
                    if (metricKey === 'revenue') value = emailsInBucket.reduce((s, e) => s + e.revenue, 0);
                    else if (metricKey === 'avgOrderValue') {
                        const totalRevenue = emailsInBucket.reduce((s, e) => s + e.revenue, 0);
                        const totalOrders = emailsInBucket.reduce((s, e) => s + e.totalOrders, 0);
                        value = totalOrders > 0 ? totalRevenue / totalOrders : 0;
                    } else {
                        const totalRevenue = emailsInBucket.reduce((s, e) => s + e.revenue, 0);
                        const totalEmailsSent = emailsInBucket.reduce((s, e) => s + e.emailsSent, 0);
                        value = totalEmailsSent > 0 ? totalRevenue / totalEmailsSent : 0;
                    }
                } else if (['emailsSent', 'totalOrders'].includes(metricKey)) {
                    value = emailsInBucket.reduce((s, e) => s + (e as any)[metricKey] || 0, 0);
                } else {
                    const totalEmailsSent = emailsInBucket.reduce((s, e) => s + e.emailsSent, 0);
                    if (totalEmailsSent === 0) value = 0; else {
                        if (metricKey === 'openRate') { const totalOpens = emailsInBucket.reduce((s, e) => s + e.uniqueOpens, 0); value = (totalOpens / totalEmailsSent) * 100; }
                        else if (metricKey === 'clickRate') { const totalClicks = emailsInBucket.reduce((s, e) => s + e.uniqueClicks, 0); value = (totalClicks / totalEmailsSent) * 100; }
                        else if (metricKey === 'clickToOpenRate') { const totalOpens = emailsInBucket.reduce((s, e) => s + e.uniqueOpens, 0); const totalClicks = emailsInBucket.reduce((s, e) => s + e.uniqueClicks, 0); value = totalOpens > 0 ? (totalClicks / totalOpens) * 100 : 0; }
                        else if (metricKey === 'conversionRate') { const totalClicks = emailsInBucket.reduce((s, e) => s + e.uniqueClicks, 0); const totalOrders = emailsInBucket.reduce((s, e) => s + e.totalOrders, 0); value = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0; }
                        else if (metricKey === 'unsubscribeRate') { const totalUnsubs = emailsInBucket.reduce((s, e) => s + e.unsubscribesCount, 0); value = (totalUnsubs / totalEmailsSent) * 100; }
                        else if (metricKey === 'spamRate') { const totalSpam = emailsInBucket.reduce((s, e) => s + e.spamComplaintsCount, 0); value = (totalSpam / totalEmailsSent) * 100; }
                        else if (metricKey === 'bounceRate') { const totalBounces = emailsInBucket.reduce((s, e) => s + e.bouncesCount, 0); value = (totalBounces / totalEmailsSent) * 100; }
                        else value = 0;
                    }
                }

                timeSeriesData.push({ value, date: bucket.label });
            });

            const executionTime = Date.now() - startTime;
            console.log(`getMetricTimeSeries completed in ${executionTime}ms with ${timeSeriesData.length} data points`);

            return timeSeriesData;
        } catch (error) {
            const executionTime = Date.now() - startTime;
            console.error(`Error in getMetricTimeSeries after ${executionTime}ms:`, error);
            return [];
        }
    }

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
        options?: { flowName?: string }
    ): { currentValue: number; previousValue: number; changePercent: number; isPositive: boolean; currentPeriod?: { startDate: Date; endDate: Date }; previousPeriod?: { startDate: Date; endDate: Date } } {
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

        // Calculate previous period - go back exactly the same number of days
        const prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
        prevEndDate.setHours(23, 59, 59, 999);
        const prevStartDate = new Date(prevEndDate);
        prevStartDate.setDate(prevStartDate.getDate() - periodDays + 1);
        prevStartDate.setHours(0, 0, 0, 0);

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

        const previousMetrics = this.getAggregatedMetricsForPeriod(
            campaignsToUse,
            flowsToUse,
            prevStartDate,
            prevEndDate
        );

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

        // Calculate percentage change
        let changePercent = 0;
        if (previousValue !== 0) {
            changePercent = ((currentValue - previousValue) / previousValue) * 100;
        } else if (currentValue > 0) {
            changePercent = 100;
        }

        // Determine if change is positive (good) based on metric type
        const negativeMetrics = ['unsubscribeRate', 'spamRate', 'bounceRate'];
        const isPositive = negativeMetrics.includes(metricKey) ? changePercent <= 0 : changePercent >= 0;

        return {
            currentValue,
            previousValue,
            changePercent,
            isPositive,
            currentPeriod: { startDate, endDate },
            previousPeriod: { startDate: prevStartDate, endDate: prevEndDate }
        };
    }
}
