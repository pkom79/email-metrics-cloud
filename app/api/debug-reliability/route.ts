import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { DataManager } from '../../../lib/data/dataManager';
import { buildWeeklyAggregatesInRange } from '../../../lib/analytics/reliability';

export async function GET(request: NextRequest) {
    try {
        // Build-safe guard: If env vars are missing, disable this debug route
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
            return NextResponse.json({ error: 'Supabase env missing; debug-reliability disabled' }, { status: 503 });
        }
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get account_id from query params
        const url = new URL(request.url);
        const accountId = url.searchParams.get('account_id');
        
        if (!accountId) {
            return NextResponse.json({ error: 'account_id required' }, { status: 400 });
        }

        console.log('Debug Reliability - User:', user.id, 'Account:', accountId);

        // Load data using the same logic as dashboard
        const dm = new DataManager();
        
        // Fetch snapshots
        const listResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/snapshots/list?account_id=${accountId}`, {
            headers: { Cookie: request.headers.get('cookie') || '' }
        });
        
        if (!listResponse.ok) {
            return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 });
        }

        const listData = await listResponse.json();
        if (!listData.snapshots?.length) {
            return NextResponse.json({ error: 'No snapshots found' }, { status: 404 });
        }

        // Load CSV data
        const csvTypes = ['campaigns', 'flows', 'subscribers'];
        const files: Record<string, File> = {};
        
        for (const type of csvTypes) {
            try {
                const csvResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/snapshots/download-csv?type=${type}&account_id=${accountId}`, {
                    headers: { Cookie: request.headers.get('cookie') || '' }
                });
                
                if (csvResponse.ok) {
                    const blob = await csvResponse.blob();
                    files[type] = new File([blob], `${type}.csv`, { type: 'text/csv' });
                }
            } catch (error) {
                console.error(`Error loading ${type}:`, error);
            }
        }

        // Load files into DataManager
        const result = await dm.loadCSVFiles(files as any);
        console.log('Load result:', result);

        // Get campaigns and flows
        const campaigns = dm.getCampaigns();
        const flows = dm.getFlowEmails();

        console.log('Debug Reliability - Total campaigns:', campaigns.length);
        console.log('Debug Reliability - Total flows:', flows.length);

        // Find Nov-Feb campaigns
        const novFebCampaigns = campaigns.filter(c => {
            const date = c.sentDate;
            const year = date.getFullYear();
            const month = date.getMonth(); // 0-based
            return (year === 2024 && month >= 10) || (year === 2025 && month <= 1); // Nov 2024 - Feb 2025
        });

        console.log('Debug Reliability - Nov-Feb campaigns:', novFebCampaigns.length);
        
        const novFebRevenue = novFebCampaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
        console.log('Debug Reliability - Nov-Feb total revenue:', novFebRevenue);

        // Test weekly aggregation
        const startDate = new Date('2024-11-01');
        const endDate = new Date('2025-02-28');
        
        const weeks = buildWeeklyAggregatesInRange(campaigns, flows, startDate, endDate);
        const novFebWeeks = weeks.filter(w => {
            const date = w.weekStart;
            return date >= startDate && date <= endDate;
        });

        console.log('Debug Reliability - Nov-Feb weeks:', novFebWeeks.length);
        console.log('Debug Reliability - Nov-Feb weeks total revenue:', novFebWeeks.reduce((sum, w) => sum + w.totalRevenue, 0));

        // Sample data
        const sampleCampaigns = novFebCampaigns.slice(0, 5).map(c => ({
            sentDate: c.sentDate.toISOString(),
            revenue: c.revenue,
            subject: c.subject?.substring(0, 50) + '...'
        }));

        const sampleWeeks = novFebWeeks.slice(0, 5).map(w => ({
            weekStart: w.weekStart.toISOString(),
            totalRevenue: w.totalRevenue,
            campaignRevenue: w.campaignRevenue,
            flowRevenue: w.flowRevenue
        }));

        return NextResponse.json({
            loadSuccess: result.success,
            loadErrors: result.errors,
            totalCampaigns: campaigns.length,
            totalFlows: flows.length,
            novFebCampaigns: novFebCampaigns.length,
            novFebRevenue,
            novFebWeeks: novFebWeeks.length,
            novFebWeeksRevenue: novFebWeeks.reduce((sum, w) => sum + w.totalRevenue, 0),
            sampleCampaigns,
            sampleWeeks
        });

    } catch (error) {
        console.error('Debug Reliability Error:', error);
        return NextResponse.json({ 
            error: 'Server error', 
            details: error instanceof Error ? error.message : String(error) 
        }, { status: 500 });
    }
}
