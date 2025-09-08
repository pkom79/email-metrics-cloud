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

            Papa.parse(file, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                chunk: (chunk: Papa.ParseResult<T>) => {
                    results.push(...chunk.data);
                    if (onProgress && chunk.meta.cursor && file.size) {
                        const progress = (chunk.meta.cursor / file.size) * 100;
                        onProgress(Math.min(progress, 99));
                    }
                },
                complete: () => {
                    if (onProgress) onProgress(100);
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
        // Only require the essential identifiers; numeric fields can be blank and will parse to 0 later
        const requiredFields = ['Campaign Name', 'Send Time', 'Total Recipients'];
        data.forEach((row) => {
            let isValid = true;
            for (const field of requiredFields) {
                const v = (row as any)[field];
                if (v === undefined || v === null || v === '') { isValid = false; break; }
            }
            // Exclude SMS campaigns if the channel column is present
            const channel = (row as any)['Campaign Channel'];
            if (isValid && channel && typeof channel === 'string' && channel.toLowerCase().includes('sms')) {
                isValid = false;
            }
            if (isValid) validData.push(row);
        });
        if (validData.length === 0) return { success: false, error: 'No valid campaign data found. Ensure the CSV has Campaign Name, Send Time, and Total Recipients.' };
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
