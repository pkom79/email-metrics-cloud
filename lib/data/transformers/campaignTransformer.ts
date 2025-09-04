import { RawCampaignCSV, ProcessedCampaign } from '../../data/dataTypes';
import { parseMetricDate } from '../dateUtils';

export class CampaignTransformer {
    transform(rawCampaigns: RawCampaignCSV[]): ProcessedCampaign[] {
        return rawCampaigns.map((raw, index) => this.transformSingle(raw, index + 1));
    }

    private transformSingle(raw: RawCampaignCSV, id: number): ProcessedCampaign {
        const sentDate = this.parseDate((raw as any)['Send Time']);

        const emailsSent = this.parseNumber((raw as any)['Total Recipients']);
        const uniqueOpens = this.parseNumber((raw as any)['Unique Opens']);
        const uniqueClicks = this.parseNumber((raw as any)['Unique Clicks']);
        const totalOrders = this.parseNumber((raw as any)['Unique Placed Order']);
        const revenue = this.parseNumber((raw as any)['Revenue']);
        const unsubscribesCount = this.parseNumber((raw as any)['Unsubscribes']);
        const spamComplaintsCount = this.parseNumber((raw as any)['Spam Complaints']);
        const bouncesCount = this.parseNumber((raw as any)['Bounces']);

        const openRate = emailsSent > 0 ? (uniqueOpens / emailsSent) * 100 : 0;
        const clickRate = emailsSent > 0 ? (uniqueClicks / emailsSent) * 100 : 0;
        const clickToOpenRate = uniqueOpens > 0 ? (uniqueClicks / uniqueOpens) * 100 : 0;
        const conversionRate = uniqueClicks > 0 ? (totalOrders / uniqueClicks) * 100 : 0;

        const revenuePerEmail = emailsSent > 0 ? revenue / emailsSent : 0;
        const unsubscribeRate = emailsSent > 0 ? (unsubscribesCount / emailsSent) * 100 : 0;
        const spamRate = emailsSent > 0 ? (spamComplaintsCount / emailsSent) * 100 : 0;
        const bounceRate = emailsSent > 0 ? (bouncesCount / emailsSent) * 100 : 0;
        const avgOrderValue = totalOrders > 0 ? revenue / totalOrders : 0;

        return {
            id,
            campaignName: (raw as any)['Campaign Name'] || '',
            subject: (raw as any)['Subject'] || (raw as any)['Campaign Name'],
            sentDate,
            dayOfWeek: sentDate.getDay(),
            hourOfDay: sentDate.getHours(),
            emailsSent,
            uniqueOpens,
            uniqueClicks,
            totalOrders,
            revenue,
            unsubscribesCount,
            spamComplaintsCount,
            bouncesCount,
            openRate,
            clickRate,
            clickToOpenRate,
            conversionRate,
            revenuePerEmail,
            unsubscribeRate,
            spamRate,
            bounceRate,
            avgOrderValue,
        };
    }

    private parseDate(dateStr: string): Date {
        const d = parseMetricDate(dateStr);
        return d || new Date();
    }

    private parseNumber(value: any): number {
        if (value === undefined || value === null || value === '') return 0;
        if (typeof value === 'number') return isNaN(value) ? 0 : value;
        const cleaned = value.toString().replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '').trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    }
}
