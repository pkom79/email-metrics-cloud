import { RawCampaignCSV, ProcessedCampaign } from '../../data/dataTypes';

export class CampaignTransformer {
    transform(rawCampaigns: RawCampaignCSV[]): ProcessedCampaign[] {
        const out: ProcessedCampaign[] = [];
        let badDateCount = 0;
        for (let i = 0; i < rawCampaigns.length; i++) {
            const pc = this.transformSingle(rawCampaigns[i], i + 1);
            if (pc) out.push(pc); else badDateCount++;
        }
        if (badDateCount) {
            try { console.warn(`[CampaignTransformer] Skipped ${badDateCount} campaign rows due to invalid Send Time`); } catch {}
        }
        return out;
    }

    private normalizeKey(k: string): string {
        return k.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    private findField(raw: any, base: string): any {
        const target = this.normalizeKey(base);
        // exact match preferred
        for (const key of Object.keys(raw)) {
            if (this.normalizeKey(key) === target) return (raw as any)[key];
        }
        // then prefix match to handle duplicates like "Send Time_2"
        for (const key of Object.keys(raw)) {
            if (this.normalizeKey(key).startsWith(target)) return (raw as any)[key];
        }
        return undefined;
    }

    private transformSingle(raw: RawCampaignCSV, id: number): ProcessedCampaign | null {
        const name = (this.findField(raw, 'Campaign Name') ?? (raw as any)['Campaign Name'] ?? '') as string;
        const subject = (this.findField(raw, 'Subject') ?? (raw as any)['Subject'] ?? name) as string;
        const sendVal = this.findField(raw, 'Send Time');
        const sentDate = this.parseDateStrict(sendVal);
        if (!sentDate) return null; // skip if date unparseable

        const emailsSent = this.parseNumber(this.findField(raw, 'Total Recipients'));
        const uniqueOpens = this.parseNumber(this.findField(raw, 'Unique Opens'));
        const uniqueClicks = this.parseNumber(this.findField(raw, 'Unique Clicks'));
        const totalOrders = this.parseNumber(this.findField(raw, 'Unique Placed Order'));
        const revenue = this.parseNumber(this.findField(raw, 'Revenue'));
        const unsubscribesCount = this.parseNumber(this.findField(raw, 'Unsubscribes'));
        const spamComplaintsCount = this.parseNumber(this.findField(raw, 'Spam Complaints'));
        const bouncesCount = this.parseNumber(this.findField(raw, 'Bounces'));

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
            campaignName: name,
            subject,
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

    private parseDateStrict(value: any): Date | null {
        if (value === undefined || value === null || value === '') return null;
        try {
            // If value is already a Date
            if (value instanceof Date) {
                return isNaN(value.getTime()) ? null : value;
            }
            const s = String(value).trim();
            const d = new Date(s);
            if (!isNaN(d.getTime())) return d;
            // Try adding Z if it looks like ISO without timezone
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:.+$/i.test(s)) {
                const dz = new Date(s + 'Z');
                if (!isNaN(dz.getTime())) return dz;
            }
            // Try US locale fallback
            const dl = new Date(Date.parse(s));
            if (!isNaN(dl.getTime())) return dl;
            return null;
        } catch { return null; }
    }

    private parseNumber(value: any): number {
        if (value === undefined || value === null || value === '') return 0;
        if (typeof value === 'number') return isNaN(value) ? 0 : value;
        const cleaned = value.toString().replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '').trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    }
}
