import { RawFlowCSV, ProcessedFlowEmail, FlowSequenceInfo } from '../../data/dataTypes';
import { parseMetricDate } from '../dateUtils';

export class FlowTransformer {
    transform(rawFlows: RawFlowCSV[]): ProcessedFlowEmail[] {
        const emailFlows = rawFlows.filter((row) => {
            const channel = (row as any)['Flow Message Channel'];
            return !channel || channel === 'Email' || channel === 'email' || channel === '';
        });

        const sequenceMap = this.buildSequenceMap(emailFlows);

        const transformed: ProcessedFlowEmail[] = [];
        let id = 1;
        emailFlows.forEach((raw) => {
            const sequencePosition = sequenceMap.get(`${(raw as any)['Flow ID']}_${(raw as any)['Flow Message ID']}`) || 1;
            transformed.push(this.transformSingle(raw, id++, sequencePosition));
        });
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

    private transformSingle(raw: RawFlowCSV, id: number, sequencePosition: number): ProcessedFlowEmail {
        const sentDate = this.parseDate((raw as any)['Day']);

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
