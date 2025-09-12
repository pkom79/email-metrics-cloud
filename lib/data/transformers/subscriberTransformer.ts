import { RawSubscriberCSV, ProcessedSubscriber, AudienceInsights } from '../../data/dataTypes';

export class SubscriberTransformer {
    private readonly REFERENCE_DATE = new Date();

    transform(rawSubscribers: RawSubscriberCSV[]): ProcessedSubscriber[] {
        return rawSubscribers.map((raw) => this.transformSingle(raw));
    }

    private transformSingle(raw: RawSubscriberCSV): ProcessedSubscriber {
        const profileCreated = this.parseDate((raw as any)['Profile Created On'] || (raw as any)['Date Added']) || new Date();
        const firstActiveRaw = this.parseDate((raw as any)['First Active']);
        const firstActive = firstActiveRaw || profileCreated;
        const lastActive = this.parseDate((raw as any)['Last Active']);
        const lastOpen = this.parseDate((raw as any)['Last Open']);
        const lastClick = this.parseDate((raw as any)['Last Click']);

        const lifetimeInDays = Math.floor((this.REFERENCE_DATE.getTime() - profileCreated.getTime()) / (1000 * 60 * 60 * 24));

        const totalClvCsv = this.parseNumber((raw as any)['Total Customer Lifetime Value']);
        const predictedClvCsv = this.parseNumber((raw as any)['Predicted Customer Lifetime Value']);
        const historicClvCsv = this.parseNumber((raw as any)['Historic Customer Lifetime Value']);
        const predictedClv = predictedClvCsv || 0;
        const totalClv = totalClvCsv || 0;
        const historicClv = Number.isFinite(historicClvCsv) && historicClvCsv > 0
            ? historicClvCsv
            : Math.max(totalClv - predictedClv, 0);
        const avgOrderValue = this.parseNumber((raw as any)['Average Order Value']);
        const totalOrders = Math.floor(this.parseNumber((raw as any)['Historic Number Of Orders']));
        const avgDaysBetweenOrders = this.parseOptionalNumber((raw as any)['Average Days Between Orders']);

        const emailConsentRaw = ((raw as any)['Email Marketing Consent'] ?? '').toString();
        const emailConsent = this.parseConsent(emailConsentRaw);
    const emailConsentTimestamp = this.parseDate((raw as any)['Email Marketing Consent Timestamp']);

        const emailSuppressionsRaw = typeof (raw as any)['Email Suppressions'] === 'string' ? (raw as any)['Email Suppressions'] as string : String((raw as any)['Email Suppressions'] ?? '');
        const { suppressions, canReceiveEmail } = this.parseEmailSuppressions(emailSuppressionsRaw);

    const isBuyer = totalOrders > 0 || historicClv > 0;

        return {
            id: (raw as any)['Klaviyo ID'] || '',
            email: (raw as any)['Email'] || '',
            firstName: (raw as any)['First Name'] || '',
            lastName: (raw as any)['Last Name'] || '',
            city: (raw as any)['City'] || '',
            state: (raw as any)['State / Region'] || '',
            country: (raw as any)['Country'] || '',
            zipCode: (raw as any)['Zip Code'] || '',
            source: (raw as any)['Source'] || 'Unknown',
            emailConsent,
            emailConsentRaw,
            emailConsentTimestamp,
            totalClv,
            historicClv,
            predictedClv,
            avgOrderValue,
            totalOrders,
            firstActive,
            lastActive,
            profileCreated,
            isBuyer,
            lifetimeInDays,
            emailSuppressions: suppressions,
            canReceiveEmail,
            avgDaysBetweenOrders,
            lastOpen,
            lastClick,
            firstActiveRaw,
        };
    }

    private parseDate(dateStr: any): Date | null {
        if (dateStr === undefined || dateStr === null || dateStr === '') return null;
        const d = typeof dateStr === 'number' ? new Date(dateStr) : new Date(String(dateStr));
        return isNaN(d.getTime()) ? null : d;
    }

    private parseNumber(value: any): number {
        if (value === undefined || value === null || value === '') return 0;
        if (typeof value === 'number') return isNaN(value) ? 0 : value;
        const cleaned = value.toString().replace(/,/g, '').replace(/\$/g, '').trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    }

    private parseOptionalNumber(value: any): number | null {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value === 'number') return isNaN(value) ? null : value;
        const cleaned = value.toString().replace(/,/g, '').replace(/\$/g, '').trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    }

    private parseConsent(value: any): boolean {
        if (value === undefined || value === null) return false;
        const str = String(value).toUpperCase().trim();
        if (str === 'TRUE') return true;
        if (str === 'FALSE') return false;
        if (str === 'NEVER_SUBSCRIBED') return false;
        const date = new Date(String(value));
        return !isNaN(date.getTime());
    }

    private parseEmailSuppressions(raw: string | undefined): { suppressions: string[]; canReceiveEmail: boolean } {
        if (!raw || raw.trim() === '') return { suppressions: [], canReceiveEmail: false };
        const trimmed = raw.trim();
        if (trimmed === '[]') return { suppressions: [], canReceiveEmail: true };
        const normalized = trimmed.replace(/""/g, '"');
        if (normalized.startsWith('[') && normalized.endsWith(']')) {
            try {
                const parsed = JSON.parse(normalized);
                if (Array.isArray(parsed)) {
                    const tokens = parsed.map((v: any) => (typeof v === 'string' ? v : String(v)))
                        .map((v: string) => v.replace(/^\s*['\"]?|['\"]?\s*$/g, ''))
                        .map((v: string) => v.toUpperCase().trim())
                        .filter(Boolean);
                    return { suppressions: tokens, canReceiveEmail: false };
                }
            } catch { }
        }
        const parts = normalized.replace(/^\[/, '').replace(/\]$/, '')
            .split(/[,;|]/)
            .map((p) => p.replace(/^\s*['\"]?|['\"]?\s*$/g, ''))
            .map((p) => p.toUpperCase().trim())
            .filter(Boolean);
        return { suppressions: parts, canReceiveEmail: false };
    }

    getAudienceInsights(subscribers: ProcessedSubscriber[]): AudienceInsights {
        const totalSubscribers = subscribers.length;
        if (totalSubscribers === 0) {
            return {
                totalSubscribers: 0,
                buyerCount: 0,
                nonBuyerCount: 0,
                buyerPercentage: 0,
                avgClvAll: 0,
                avgClvBuyers: 0,
                purchaseFrequency: { never: 0, oneOrder: 0, twoOrders: 0, threeTo5: 0, sixPlus: 0 },
                lifetimeDistribution: { zeroTo3Months: 0, threeTo6Months: 0, sixTo12Months: 0, oneToTwoYears: 0, twoYearsPlus: 0 },
            };
        }
        const buyers = subscribers.filter((s) => s.isBuyer);
        const nonBuyers = subscribers.filter((s) => !s.isBuyer);
    const avgClvAll = subscribers.reduce((sum, s) => sum + (s.historicClv ?? s.totalClv), 0) / totalSubscribers;
    const avgClvBuyers = buyers.length > 0 ? buyers.reduce((sum, s) => sum + (s.historicClv ?? s.totalClv), 0) / buyers.length : 0;
        const purchaseFrequency = {
            never: nonBuyers.length,
            oneOrder: buyers.filter((s) => s.totalOrders === 1).length,
            twoOrders: buyers.filter((s) => s.totalOrders === 2).length,
            threeTo5: buyers.filter((s) => s.totalOrders >= 3 && s.totalOrders <= 5).length,
            sixPlus: buyers.filter((s) => s.totalOrders >= 6).length,
        };
        const lifetimeDistribution = {
            zeroTo3Months: subscribers.filter((s) => s.lifetimeInDays <= 90).length,
            threeTo6Months: subscribers.filter((s) => s.lifetimeInDays > 90 && s.lifetimeInDays <= 180).length,
            sixTo12Months: subscribers.filter((s) => s.lifetimeInDays > 180 && s.lifetimeInDays <= 365).length,
            oneToTwoYears: subscribers.filter((s) => s.lifetimeInDays > 365 && s.lifetimeInDays <= 730).length,
            twoYearsPlus: subscribers.filter((s) => s.lifetimeInDays > 730).length,
        };
        return { totalSubscribers, buyerCount: buyers.length, nonBuyerCount: nonBuyers.length, buyerPercentage: (buyers.length / totalSubscribers) * 100, avgClvAll, avgClvBuyers, purchaseFrequency, lifetimeDistribution };
    }
}
