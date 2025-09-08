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

    private findAnyField(raw: any, candidates: string[]): any {
        for (const c of candidates) {
            const v = this.findField(raw, c);
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }

    private transformSingle(raw: RawCampaignCSV, id: number): ProcessedCampaign | null {
        const name = (this.findAnyField(raw, ['Campaign Name', 'Name']) ?? (raw as any)['Campaign Name'] ?? (raw as any)['Name'] ?? '') as string;
        const subject = (this.findField(raw, 'Subject') ?? (raw as any)['Subject'] ?? name) as string;
        const sendVal = this.findAnyField(raw, ['Send Time', 'Send Date', 'Sent At', 'Send Date (UTC)', 'Send Date (GMT)', 'Date']);
        const sentDate = this.parseDateStrict(sendVal);
        if (!sentDate) return null; // skip if date unparseable

        const emailsSent = this.parseNumber(this.findAnyField(raw, ['Total Recipients', 'Recipients']));
        const uniqueOpens = this.parseNumber(this.findField(raw, 'Unique Opens'));
        const uniqueClicks = this.parseNumber(this.findField(raw, 'Unique Clicks'));
        const totalOrders = this.parseNumber(this.findAnyField(raw, ['Unique Placed Order', 'Total Placed Orders', 'Placed Orders']));
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
            let s = String(value).trim();
            if (!s) return null;
            // Normalize common timezone abbreviations that JS Date struggles with
            s = s.replace(/\b(UTC|GMT|EST|EDT|CST|CDT|PST|PDT)\b/ig, '').trim();
            // Handle common MM/DD/YYYY[ HH:mm[:ss]] [AM|PM] formats explicitly in UTC to avoid locale ambiguity
            const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
            if (mdy) {
                const mm = parseInt(mdy[1], 10);
                const dd = parseInt(mdy[2], 10);
                const yy = parseInt(mdy[3], 10);
                const year = mdy[3].length === 2 ? (yy > 70 ? 1900 + yy : 2000 + yy) : yy;
                let hours = parseInt(mdy[4] || '0', 10);
                const mins = parseInt(mdy[5] || '0', 10);
                const secs = parseInt(mdy[6] || '0', 10);
                const ampm = (mdy[7] || '').toUpperCase();
                if (ampm) {
                    if (ampm === 'PM' && hours < 12) hours += 12;
                    if (ampm === 'AM' && hours === 12) hours = 0;
                }
                const d = new Date(Date.UTC(year, mm - 1, dd, hours, mins, secs));
                if (!isNaN(d.getTime())) return d;
            }
            // Try native parse
            const d1 = new Date(s);
            if (!isNaN(d1.getTime())) return d1;
            // Try adding Z if it looks like ISO without timezone
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:.+$/i.test(s)) {
                const dz = new Date(s + 'Z');
                if (!isNaN(dz.getTime())) return dz;
            }
            // Fallback to Date.parse
            const d2 = new Date(Date.parse(s));
            if (!isNaN(d2.getTime())) return d2;
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
