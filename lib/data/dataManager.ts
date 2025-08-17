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

export interface LoadProgress {
    campaigns: { loaded: boolean; progress: number; error?: string };
    flows: { loaded: boolean; progress: number; error?: string };
    subscribers: { loaded: boolean; progress: number; error?: string };
}

export class DataManager {
    private static instance: DataManager;

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

    static getInstance(): DataManager {
        if (!DataManager.instance) DataManager.instance = new DataManager();
        return DataManager.instance;
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
        const allDates: number[] = [...this.campaigns.map(c => c.sentDate.getTime()), ...this.flowEmails.map(f => f.sentDate.getTime())];
        if (allDates.length === 0) return new Date();
        return new Date(Math.max(...allDates));
    }

    getMetricTimeSeries(
        campaigns: ProcessedCampaign[],
        flows: ProcessedFlowEmail[],
        metricKey: string,
        dateRange: string,
        granularity: 'daily' | 'weekly' | 'monthly',
    ): { value: number; date: string }[] {
        const allEmails = [...campaigns, ...flows];
        if (allEmails.length === 0) return [];

        let endTs = Math.max(...allEmails.map(e => e.sentDate.getTime()));
        const endDate = new Date(isFinite(endTs) ? endTs : Date.now());
        let startDate = new Date(endDate);
        if (dateRange === 'all') {
            const oldestTs = Math.min(...allEmails.map(e => e.sentDate.getTime()));
            startDate = new Date(isFinite(oldestTs) ? oldestTs : endDate.getTime());
        } else {
            const days = parseInt(dateRange.replace('d', ''));
            startDate.setDate(startDate.getDate() - days);
        }

        const filteredEmails = allEmails.filter(e => e.sentDate >= startDate && e.sentDate <= endDate);

        const buckets = new Map<string, typeof allEmails>();
        const start = new Date(startDate); const end = new Date(endDate); start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0);
        if (granularity === 'daily') {
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const key = d.toISOString().split('T')[0]; if (!buckets.has(key)) buckets.set(key, []);
            }
        } else if (granularity === 'weekly') {
            const mondayOf = (dt: Date) => { const d = new Date(dt); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff); d.setHours(0, 0, 0, 0); return d; };
            for (let d = mondayOf(start); d <= end; d.setDate(d.getDate() + 7)) { const key = d.toISOString().split('T')[0]; if (!buckets.has(key)) buckets.set(key, []); }
        } else {
            for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; if (!buckets.has(key)) buckets.set(key, []);
            }
        }

        filteredEmails.forEach(email => {
            let bucketKey: string;
            const date = new Date(email.sentDate);
            switch (granularity) {
                case 'daily': bucketKey = date.toISOString().split('T')[0]; break;
                case 'weekly': {
                    const monday = new Date(date); const day = monday.getDay(); const diff = monday.getDate() - day + (day === 0 ? -6 : 1); monday.setDate(diff); bucketKey = monday.toISOString().split('T')[0]; break;
                }
                case 'monthly': bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; break;
            }
            if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
            buckets.get(bucketKey)!.push(email);
        });

        const sortedKeys = Array.from(buckets.keys()).sort();
        const timeSeriesData: { value: number; date: string }[] = [];

        sortedKeys.forEach(key => {
            const emailsInBucket = buckets.get(key)!;
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

            let displayDate = '';
            if (granularity === 'daily' || granularity === 'weekly') displayDate = new Date(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            else { const [year, month] = key.split('-'); displayDate = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); }
            timeSeriesData.push({ value, date: displayDate });
        });

        return timeSeriesData;
    }

    getFlowStepTimeSeries(
        flowEmails: ProcessedFlowEmail[],
        flowName: string,
        sequencePosition: number,
        metricKey: string,
        dateRange: string,
        granularity: 'daily' | 'weekly' | 'monthly',
    ) { return this.getMetricTimeSeries([], flowEmails.filter(e => e.flowName === flowName && e.sequencePosition === sequencePosition), metricKey, dateRange, granularity); }

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
        if (dateRange === 'all') {
            const oldestCampaignTs = this.campaigns.length ? Math.min(...this.campaigns.map(c => c.sentDate.getTime())) : Date.now();
            const oldestFlowTs = this.flowEmails.length ? Math.min(...this.flowEmails.map(f => f.sentDate.getTime())) : Date.now();
            const oldestDate = new Date(Math.min(oldestCampaignTs, oldestFlowTs));
            const lastEmailDate = this.getLastEmailDate();
            const daysDiff = Math.floor((lastEmailDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 60) return 'daily'; if (daysDiff <= 365) return 'weekly'; return 'monthly';
        }
        const days = parseInt(dateRange.replace('d', ''));
        if (days <= 60) return 'daily'; if (days <= 365) return 'weekly'; return 'monthly';
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
    ) {
        const endDate = this.getLastEmailDate();
        const startDate = new Date(endDate);
        if (dateRange === 'all') return { currentValue: 0, previousValue: 0, changePercent: 0, isPositive: true, currentPeriod: undefined, previousPeriod: undefined };
        const periodDays = parseInt(dateRange.replace('d', ''));
        startDate.setDate(startDate.getDate() - periodDays);
        const prevEndDate = new Date(startDate); prevEndDate.setDate(prevEndDate.getDate() - 1);
        const prevStartDate = new Date(prevEndDate); prevStartDate.setDate(prevStartDate.getDate() - periodDays + 1);

        let campaignsToUse = this.campaigns; let flowsToUse = this.flowEmails;
        if (dataType === 'campaigns') flowsToUse = []; else if (dataType === 'flows') campaignsToUse = [];
        if (options?.flowName && options.flowName !== 'all') flowsToUse = flowsToUse.filter(f => f.flowName === options.flowName);

        const current = this.getAggregatedMetricsForPeriod(campaignsToUse, flowsToUse, startDate, endDate);
        const previous = this.getAggregatedMetricsForPeriod(campaignsToUse, flowsToUse, prevStartDate, prevEndDate);

        let currentValue = 0; let previousValue = 0;
        switch (metricKey) {
            case 'totalRevenue': currentValue = current.totalRevenue; previousValue = previous.totalRevenue; break;
            case 'averageOrderValue':
            case 'avgOrderValue': currentValue = current.avgOrderValue; previousValue = previous.avgOrderValue; break;
            case 'revenuePerEmail': currentValue = current.revenuePerEmail; previousValue = previous.revenuePerEmail; break;
            case 'openRate': currentValue = current.openRate; previousValue = previous.openRate; break;
            case 'clickRate': currentValue = current.clickRate; previousValue = previous.clickRate; break;
            case 'clickToOpenRate': currentValue = current.clickToOpenRate; previousValue = previous.clickToOpenRate; break;
            case 'emailsSent': currentValue = current.emailsSent; previousValue = previous.emailsSent; break;
            case 'totalOrders': currentValue = current.totalOrders; previousValue = previous.totalOrders; break;
            case 'conversionRate': currentValue = current.conversionRate; previousValue = previous.conversionRate; break;
            case 'unsubscribeRate': currentValue = current.unsubscribeRate; previousValue = previous.unsubscribeRate; break;
            case 'spamRate': currentValue = current.spamRate; previousValue = previous.spamRate; break;
            case 'bounceRate': currentValue = current.bounceRate; previousValue = previous.bounceRate; break;
        }
        let changePercent = 0; if (previousValue !== 0) changePercent = ((currentValue - previousValue) / previousValue) * 100; else if (currentValue > 0) changePercent = 100;
        const negativeMetrics = ['unsubscribeRate', 'spamRate', 'bounceRate'];
        const isPositive = negativeMetrics.includes(metricKey) ? changePercent < 0 : changePercent > 0;
        return { currentValue, previousValue, changePercent, isPositive, currentPeriod: { startDate, endDate }, previousPeriod: { startDate: prevStartDate, endDate: prevEndDate } };
    }
}
