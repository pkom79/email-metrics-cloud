"use client";
import Papa from 'papaparse';
import {
    RawCampaignCSV,
    RawFlowCSV,
    RawSubscriberCSV,
    ParseResult,
    ValidationError,
} from './dataTypes';

export class CSVParser {
    private readonly CHUNK_SIZE = 1000;

    private async parseCSV<T>(file: File, onProgress?: (progress: number) => void): Promise<ParseResult<T>> {
        return new Promise((resolve) => {
            const results: T[] = [];
            // Throttle progress emissions to avoid render thrash
            let lastEmit = 0;
            let lastPct = -1;
            const emitProgress = (pct: number) => {
                const now = Date.now();
                // Emit if 120ms passed or progress advanced by >= 1%
                if (!onProgress) return;
                if (pct >= 100 || now - lastEmit >= 120 || Math.floor(pct) > Math.floor(lastPct)) {
                    lastEmit = now;
                    lastPct = pct;
                    try { onProgress(Math.min(pct, 99)); } catch {}
                }
            };

            Papa.parse(file, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                worker: true,
                chunk: (chunk: Papa.ParseResult<T>) => {
                    results.push(...chunk.data);
                    if (chunk.meta.cursor && file.size) {
                        const progress = (chunk.meta.cursor / file.size) * 100;
                        emitProgress(progress);
                    }
                },
                complete: () => {
                    try { onProgress && onProgress(100); } catch {}
                    resolve({ success: true, data: results });
                },
                error: (error: Error) => resolve({ success: false, error: `Failed to parse CSV: ${error.message}` }),
            });
        });
    }

    async parseCampaigns(file: File, onProgress?: (progress: number) => void): Promise<ParseResult<RawCampaignCSV>> {
        const result = await this.parseCSV<RawCampaignCSV>(file, onProgress);
        if (!result.success || !result.data) return result;
        return this.validateCampaigns(result.data);
    }

    async parseFlows(file: File, onProgress?: (progress: number) => void): Promise<ParseResult<RawFlowCSV>> {
        return new Promise((resolve) => {
            Papa.parse(file, {
                header: false,
                dynamicTyping: true,
                skipEmptyLines: true,
                worker: true,
                complete: (parseResults) => {
                    const allRows = parseResults.data as any[][];
                    if (allRows.length <= 3) {
                        resolve({ success: false, error: 'File does not contain enough rows' });
                        return;
                    }
                    let headerRowIndex = -1;
                    for (let i = 0; i < Math.min(10, allRows.length); i++) {
                        if (allRows[i][0] === 'Day') { headerRowIndex = i; break; }
                    }
                    const headers = headerRowIndex >= 0 ? allRows[headerRowIndex] : allRows[2];
                    const dataRows: RawFlowCSV[] = [];
                    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 3;
                    for (let i = startRow; i < allRows.length; i++) {
                        const row = allRows[i];
                        const obj: any = {};
                        headers.forEach((header: string, index: number) => {
                            if (header && row[index] !== undefined) obj[header] = row[index];
                        });
                        dataRows.push(obj as RawFlowCSV);
                    }
                    const validated = this.validateFlows(dataRows);
                    if (onProgress) onProgress(100);
                    resolve(validated);
                },
                error: (error) => resolve({ success: false, error: `Failed to parse CSV: ${error.message}` }),
            });
        });
    }

    async parseSubscribers(file: File, onProgress?: (progress: number) => void): Promise<ParseResult<RawSubscriberCSV>> {
        const result = await this.parseCSV<RawSubscriberCSV>(file, onProgress);
        if (!result.success || !result.data) return result;
        return this.validateSubscribers(result.data);
    }

    private validateCampaigns(data: RawCampaignCSV[]): ParseResult<RawCampaignCSV> {
        const validData: RawCampaignCSV[] = [];
        const rejected: { idx: number; reason: string }[] = [];
        // Normalize keys to tolerate duplicate-renamed headers (e.g., "Send Date_2")
        const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const tokens = (s: string) => normalizeKey(s).split(' ').filter(Boolean);
        const isTokenSubset = (want: string, have: string) => {
            const w = new Set(tokens(want));
            const h = new Set(tokens(have));
            // want tokens must be contained in have tokens
            for (const t of w) { if (!h.has(t)) return false; }
            return true;
        };
        const hasAnyNormalized = (row: any, keys: string[]) => {
            const rowKeys = Object.keys(row);
            return keys.some((want) => {
                const target = normalizeKey(want);
                for (const rk of rowKeys) {
                    const nk = normalizeKey(rk);
                    if ((nk === target || nk.startsWith(target) || isTokenSubset(target, nk)) && row[rk] !== undefined && row[rk] !== null && row[rk] !== '') return true;
                }
                return false;
            });
        };
        const findAnyFieldNormalized = (row: any, keys: string[]) => {
            const rowKeys = Object.keys(row);
            for (const want of keys) {
                const target = normalizeKey(want);
                // exact match first
                for (const rk of rowKeys) {
                    const nk = normalizeKey(rk);
                    if (nk === target || isTokenSubset(target, nk)) {
                        const v = row[rk];
                        if (v !== undefined && v !== null && v !== '') return v;
                    }
                }
                // then prefix match to catch duplicate headers
                for (const rk of rowKeys) {
                    const nk = normalizeKey(rk);
                    if (nk.startsWith(target)) {
                        const v = row[rk];
                        if (v !== undefined && v !== null && v !== '') return v;
                    }
                }
            }
            return undefined;
        };
        data.forEach((row, i) => {
            // Campaign name
            if (!hasAnyNormalized(row, ['Campaign name', 'Campaign Name', 'Name'])) {
                rejected.push({ idx: i, reason: 'missing name' });
                return;
            }
            // Send time/date: accept several variants
            if (!hasAnyNormalized(row, ['Message send date time', 'Send Time', 'Send Date', 'Sent At', 'Send Date (UTC)', 'Send Date (GMT)', 'Date'])) {
                rejected.push({ idx: i, reason: 'missing send date' });
                return;
            }
            // Exclude pure-SMS campaigns; include if channel mentions email or is missing/unknown
            const channelRaw = findAnyFieldNormalized(row, ['Send channel', 'Campaign Channel', 'Channel', 'Message Channel']);
            if (typeof channelRaw === 'string') {
                const ch = channelRaw.toLowerCase();
                const mentionsEmail = ch.includes('email');
                const mentionsSms = ch.includes('sms');
                if (!mentionsEmail && mentionsSms) {
                    rejected.push({ idx: i, reason: 'sms-only' });
                    return;
                }
            }
            validData.push(row);
        });
        try {
            if (process.env.NEXT_PUBLIC_DIAG_UPLOAD === '1' || process.env.NEXT_PUBLIC_DIAG_SEGMENT === '1' || process.env.NEXT_PUBLIC_DIAG_DASHBOARD === '1') {
                console.info(`[CSVParser] Campaign rows accepted: ${validData.length}, rejected: ${rejected.length}`);
            }
        } catch {}
        if (validData.length === 0) return { success: false, error: 'No valid campaign data found. Ensure the CSV has Campaign Name and Send Time/Date columns.' };
        return { success: true, data: validData };
    }

    private validateFlows(data: RawFlowCSV[]): ParseResult<RawFlowCSV> {
        const validData: RawFlowCSV[] = [];
        const requiredFields = ['Day', 'Flow ID', 'Flow Name', 'Flow Message ID', 'Flow Message Name', 'Status', 'Delivered'];
        data.forEach((row) => {
            let isValid = true;
            requiredFields.forEach((field) => {
                const v = (row as any)[field];
                if (v === undefined || v === null || v === '') isValid = false;
            });
            if (isValid) validData.push(row);
        });
        if (validData.length === 0) return { success: false, error: 'No valid flow data found. Check that the CSV contains the required fields.' };
        return { success: true, data: validData };
    }

    private validateSubscribers(data: RawSubscriberCSV[]): ParseResult<RawSubscriberCSV> {
        const validData: RawSubscriberCSV[] = [];
        const requiredFields = ['Email', 'Klaviyo ID', 'Email Marketing Consent'];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        data.forEach((row) => {
            let isValid = true;
            requiredFields.forEach((field) => {
                const v = (row as any)[field];
                if (v === undefined || v === null || v === '') isValid = false;
            });
            if ((row as any)['Email'] && typeof (row as any)['Email'] === 'string' && !emailRegex.test((row as any)['Email'])) isValid = false;
            if (isValid) validData.push(row);
        });
        if (validData.length === 0) return { success: false, error: 'No valid subscriber data found. Check that the CSV contains valid email addresses.' };
        return { success: true, data: validData };
    }
}
