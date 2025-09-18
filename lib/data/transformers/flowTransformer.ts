import { RawFlowCSV, ProcessedFlowEmail, FlowSequenceInfo } from '../../data/dataTypes';

export class FlowTransformer {
    transform(rawFlows: RawFlowCSV[]): ProcessedFlowEmail[] {
        const emailFlows = rawFlows.filter((row) => {
            const channel = (row as any)['Flow Message Channel'];
            return !channel || channel === 'Email' || channel === 'email' || channel === '';
        });

        const sequenceMap = this.buildSequenceMap(emailFlows);

        const transformed: ProcessedFlowEmail[] = [];
        let id = 1;
        let badDateCount = 0;
        const badSamples: any[] = [];
        emailFlows.forEach((raw) => {
            const sequencePosition = sequenceMap.get(`${(raw as any)['Flow ID']}_${(raw as any)['Flow Message ID']}`) || 1;
            const rec = this.transformSingle(raw, id + transformed.length, sequencePosition);
            if (rec) transformed.push(rec);
            else {
                badDateCount++;
                try { const v = (raw as any)['Day']; if (badSamples.length < 5) badSamples.push(v); } catch {}
            }
        });
        if (badDateCount) {
            try { console.warn(`[FlowTransformer] Skipped ${badDateCount} flow rows due to invalid Day. Samples:`, badSamples); } catch {}
        }
        return transformed;
    }

    private buildSequenceMap(flows: RawFlowCSV[]): Map<string, number> {
        const earliestByFlow = new Map<string, Map<string, number>>();
        flows.forEach((flow) => {
            const flowId = (flow as any)['Flow ID'];
            const messageId = (flow as any)['Flow Message ID'];
            const ts = this.parseDate((flow as any)['Day']).getTime();
            if (!earliestByFlow.has(flowId)) earliestByFlow.set(flowId, new Map());
            const inner = earliestByFlow.get(flowId)!;
            const prev = inner.get(messageId);
            if (prev === undefined || ts < prev) inner.set(messageId, ts);
        });
        const sequenceMap = new Map<string, number>();
        earliestByFlow.forEach((msgMap, flowId) => {
            const orderedIds = Array.from(msgMap.entries()).sort((a, b) => a[1] - b[1]).map(([messageId]) => messageId);
            orderedIds.forEach((messageId, index) => sequenceMap.set(`${flowId}_${messageId}`, index + 1));
        });
        return sequenceMap;
    }

    private transformSingle(raw: RawFlowCSV, id: number, sequencePosition: number): ProcessedFlowEmail | null {
        const sentDate = this.parseDateStrict((raw as any)['Day']);
        if (!sentDate) return null; // skip rows with invalid date

        const emailsSent = this.parseNumber((raw as any)['Delivered']);
        const uniqueOpens = this.parseNumber((raw as any)['Unique Opens']);
        const uniqueClicks = this.parseNumber((raw as any)['Unique Clicks']);
        const totalOrders = this.parseNumber((raw as any)['Unique Placed Order'] || (raw as any)['Placed Order'] || 0);
        const revenue = this.parseNumber((raw as any)['Revenue'] || 0);

        const bounceRate = this.parseDecimalRate((raw as any)['Bounce Rate']);
        const bouncesCount = this.parseNumber((raw as any)['Bounced']) || Math.round(emailsSent * bounceRate);

        const unsubscribeRate = this.parseDecimalRate((raw as any)['Unsub Rate'] || (raw as any)['Unsubscribe Rate'] || 0);
        const unsubscribesCount = this.parseNumber((raw as any)['Unsubscribes']) || Math.round(emailsSent * unsubscribeRate);

        const spamRate = this.parseDecimalRate((raw as any)['Complaint Rate'] || (raw as any)['Spam Rate'] || 0);
        const spamComplaintsCount = this.parseNumber((raw as any)['Spam']) || Math.round(emailsSent * spamRate);

        const openRate = emailsSent > 0 ? (uniqueOpens / emailsSent) * 100 : 0;
        const clickRate = emailsSent > 0 ? (uniqueClicks / emailsSent) * 100 : 0;
        const clickToOpenRate = uniqueOpens > 0 ? (uniqueClicks / uniqueOpens) * 100 : 0;
        const conversionRate = uniqueClicks > 0 ? (totalOrders / uniqueClicks) * 100 : 0;
        const revenuePerEmail = emailsSent > 0 ? revenue / emailsSent : 0;
        const avgOrderValue = totalOrders > 0 ? revenue / totalOrders : 0;

        const emailName = (raw as any)['Flow Message Name'] || `Email ${sequencePosition}`;

        return {
            id,
            flowId: (raw as any)['Flow ID'],
            flowName: (raw as any)['Flow Name'],
            flowMessageId: (raw as any)['Flow Message ID'],
            emailName,
            sequencePosition,
            sentDate,
            status: (raw as any)['Status'] || 'unknown',
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
            unsubscribeRate: unsubscribeRate * 100,
            spamRate: spamRate * 100,
            bounceRate: bounceRate * 100,
            avgOrderValue,
        };
    }

    // Strict date parsing: return null if unparseable (do not substitute with "now")
    private parseDateStrict(value: any): Date | null {
        if (value === undefined || value === null || value === '') return null;
        try {
            if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
            if (typeof value === 'number') { const ms = value > 1e12 ? value : (value > 1e10 ? value * 100 : value * 1000); const d = new Date(ms); return isNaN(d.getTime()) ? null : d; }
            let s = String(value).trim(); if (!s) return null;
            s = s.replace(/,/g, ' ').replace(/\bat\b/ig, ' ').replace(/\s+/g, ' ').trim();
            s = s.replace(/\b(UTC|GMT|EST|EDT|CST|CDT|PST|PDT)\b/ig, '').trim();
            s = s.replace(/\([^)]+\)/g, '').trim();
            s = s.replace(/([+-]\d{2}:?\d{2})$/, '').trim();
            // Common YYYY-MM-DD or MM/DD/YYYY
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + 'T00:00:00Z'); return isNaN(d.getTime()) ? null : d; }
            const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
            if (mdy) { const mm = +mdy[1], dd = +mdy[2], yy = +mdy[3]; const year = mdy[3].length === 2 ? (yy > 70 ? 1900 + yy : 2000 + yy) : yy; const d = new Date(Date.UTC(year, mm - 1, dd)); return isNaN(d.getTime()) ? null : d; }
            const d1 = new Date(s); if (!isNaN(d1.getTime())) return d1;
            const dz = new Date(s + 'Z'); if (!isNaN(dz.getTime())) return dz;
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

    private parseDecimalRate(value: any): number {
        if (value === undefined || value === null || value === '') return 0;
        if (typeof value === 'number') return value;
        if (value.toString().includes('%')) return this.parseNumber(value) / 100;
        return this.parseNumber(value);
    }

    getFlowSequenceInfo(flowName: string, processedFlows: ProcessedFlowEmail[]): FlowSequenceInfo {
        const flowEmails = processedFlows.filter((email) => email.flowName === flowName);
        if (flowEmails.length === 0) return { flowId: '', messageIds: [], emailNames: [], sequenceLength: 0 };
        const byMessageId = new Map<string, { seq: number; earliestSeq: number; latestTs: number; latestName: string }>();
        flowEmails.forEach((email) => {
            const key = email.flowMessageId;
            const ts = email.sentDate.getTime();
            if (!byMessageId.has(key)) {
                byMessageId.set(key, { seq: email.sequencePosition, earliestSeq: email.sequencePosition, latestTs: ts, latestName: email.emailName });
            } else {
                const cur = byMessageId.get(key)!;
                if (email.sequencePosition < cur.earliestSeq) cur.earliestSeq = email.sequencePosition;
                if (ts > cur.latestTs) { cur.latestTs = ts; cur.latestName = email.emailName; }
            }
        });
        const ordered = Array.from(byMessageId.entries()).sort((a, b) => a[1].earliestSeq - b[1].earliestSeq);
        return {
            flowId: flowEmails[0].flowId,
            messageIds: ordered.map(([id]) => id),
            emailNames: ordered.map(([_, v]) => v.latestName),
            sequenceLength: ordered.length,
        };
    }

    getUniqueFlowNames(processedFlows: ProcessedFlowEmail[]): string[] {
        return Array.from(new Set(processedFlows.map((email) => email.flowName))).sort();
    }
}
