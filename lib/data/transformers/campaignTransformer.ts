import { RawCampaignCSV, ProcessedCampaign } from '../../data/dataTypes';

export class CampaignTransformer {
    transform(rawCampaigns: RawCampaignCSV[]): ProcessedCampaign[] {
        const out: ProcessedCampaign[] = [];
        let badDateCount = 0;
        const failedSamples: any[] = [];
        for (let i = 0; i < rawCampaigns.length; i++) {
            const raw = rawCampaigns[i];
            const pc = this.transformSingle(raw, i + 1);
            if (pc) {
                out.push(pc);
            } else {
                badDateCount++;
                try {
                    const v = this.extractSendVal(raw);
                    if (failedSamples.length < 5) failedSamples.push(v);
                } catch {}
            }
        }
        if (badDateCount) {
            try {
                console.warn(`[CampaignTransformer] Skipped ${badDateCount} campaign rows due to invalid Send Time. Sample raw values:`, failedSamples);
            } catch {}
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
        const name = (this.findAnyField(raw, ['Campaign name', 'Campaign Name', 'Name']) ?? (raw as any)['Campaign name'] ?? (raw as any)['Campaign Name'] ?? (raw as any)['Name'] ?? '') as string;
        const subject = (this.findAnyField(raw, ['Subject line', 'Subject']) ?? (raw as any)['Subject line'] ?? (raw as any)['Subject'] ?? name) as string;
        // Segments/lists: tolerate "List", "Lists", case/dup variations. Split by comma (and defensively semicolon), trim, dedupe preserving first occurrence.
        const listsRaw = (this.findAnyField(raw, ['Audiences list', 'Lists', 'List']) ?? (raw as any)['Audiences list'] ?? (raw as any)['Lists'] ?? (raw as any)['List'] ?? '') as any;
        const segmentsUsed: string[] = (() => {
            if (listsRaw === undefined || listsRaw === null) return [];
            const s = String(listsRaw);
            if (!s.trim()) return [];
            // Primary: comma-separated. Also split on semicolons if present.
            const parts = s.split(/[;,]/g).map(p => p.replace(/^\s+|\s+$/g, '')); // trim without depending on String.trim for weird unicode
            const seen = new Set<string>();
            const out: string[] = [];
            for (const p of parts) {
                if (!p) continue;
                const key = p; // case-sensitive preserve
                if (!seen.has(key)) { seen.add(key); out.push(p); }
            }
            return out;
        })();
        const sendVal = this.findAnyField(raw, ['Message send date time', 'Send Time', 'Send Time (UTC)', 'Send Date', 'Sent At', 'Send Date (UTC)', 'Send Date (GMT)', 'Date']);
    const rawSentDateString = sendVal != null ? String(sendVal) : undefined;
    const sentDate = this.parseDateStrict(sendVal);
        if (!sentDate) return null; // skip if date unparseable

        const emailsSent = this.parseNumber(this.findAnyField(raw, ['Total recipients', 'Total Recipients', 'Recipients']));
        const uniqueOpens = this.parseNumber(this.findAnyField(raw, ['Unique opens', 'Unique Opens']));
        const uniqueClicks = this.parseNumber(this.findAnyField(raw, ['Unique clicks', 'Unique Clicks']));
        const totalOrders = this.parseNumber(this.findAnyField(raw, [
            'Count of unique conversions',
            'Unique Placed Order',
            'Unique Ordered Product',
            'Total Placed Orders',
            'Placed Order',
            'Placed Orders',
            'Ordered Product',
        ]));
        const revenue = this.parseNumber(this.findAnyField(raw, ['Conversion value', 'Revenue', 'Ordered Product Value']));
        const unsubscribesCount = this.parseNumber(this.findAnyField(raw, ['Unique unsubscribes', 'Unsubscribes']));
        const spamComplaintsCount = this.parseNumber(this.findAnyField(raw, ['Total spam complaints', 'Spam Complaints']));
        const bouncesCount = this.parseNumber(this.findAnyField(raw, ['Total bounced', 'Bounces']));

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
            rawSentDateString,
            // We intentionally treat CSV timestamps as naive account-local wall time anchored to UTC components.
            dayOfWeek: sentDate.getUTCDay(),
            hourOfDay: sentDate.getUTCHours(),
            segmentsUsed,
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

    private extractSendVal(raw: RawCampaignCSV): any {
        return this.findAnyField(raw, ['Message send date time', 'Send Time', 'Send Time (UTC)', 'Send Date', 'Sent At', 'Send Date (UTC)', 'Send Date (GMT)', 'Date']);
    }

    private parseDateStrict(value: any): Date | null {
        if (value === undefined || value === null || value === '') return null;
        try {
            // If value is already a Date
            if (value instanceof Date) {
                return isNaN(value.getTime()) ? null : value;
            }
            // Numeric epoch (seconds or ms)
            if (typeof value === 'number') {
                const n = value;
                const ms = n > 1e12 ? n : (n > 1e10 ? n * 100 : n * 1000);
                const d = new Date(ms);
                return isNaN(d.getTime()) ? null : d;
            }
            let s = String(value).trim();
            if (!s) return null;
            // Normalize: remove commas and the word 'at'
            s = s.replace(/,/g, ' ').replace(/\bat\b/ig, ' ').replace(/\s+/g, ' ').trim();
            // Remove timezone abbreviations (but KEEP numeric offset characters so we can ignore them explicitly without shifting)
            s = s.replace(/\b(UTC|GMT|EST|EDT|CST|CDT|PST|PDT)\b/ig, '').trim();
            s = s.replace(/\([^)]+\)/g, '').trim();
            // Pattern: YYYY-MM-DD HH:mm[:ss][offset]
            const naiveWithOffset = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?([+-]\d{2}:?\d{2})$/);
            if (naiveWithOffset) {
                const [_, Y, M, D, h, m, sec] = naiveWithOffset;
                const year = parseInt(Y, 10); const month = parseInt(M, 10) - 1; const day = parseInt(D, 10);
                const hour = parseInt(h, 10); const minute = parseInt(m, 10); const second = parseInt(sec || '0', 10);
                // Store using UTC to preserve wall-clock time consistently across all timezones
                const d = new Date(Date.UTC(year, month, day, hour, minute, second));
                if (!isNaN(d.getTime())) return d;
            }
            // Handle common MM/DD/YYYY[ HH:mm[:ss]] [AM|PM] formats
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
                // Store using UTC to preserve wall-clock time consistently across all timezones
                const d = new Date(Date.UTC(year, mm - 1, dd, hours, mins, secs));
                if (!isNaN(d.getTime())) return d;
            }
            // ISO-like with space separator (YYYY-MM-DD HH:mm[:ss])
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(s)) {
                const parts = s.split(/[ T]/);
                const [datePart, timePart] = parts.length === 2 ? parts : [parts[0], parts[1]];
                const [Y, M, D] = datePart.split('-').map(n => parseInt(n, 10));
                const [h, m, sec] = timePart.split(':').map(n => parseInt(n, 10));
                // Store using UTC to preserve wall-clock time consistently across all timezones
                const d = new Date(Date.UTC(Y, M - 1, D, h, m, sec || 0));
                if (!isNaN(d.getTime())) return d;
            }
            // Bare date YYYY-MM-DD as midnight
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                const [Y, M, D] = s.split('-').map(n => parseInt(n, 10));
                // Store using UTC to preserve wall-clock time consistently across all timezones
                const d = new Date(Date.UTC(Y, M - 1, D, 0, 0, 0));
                if (!isNaN(d.getTime())) return d;
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
