#!/usr/bin/env node

/**
 * Test script for Klaviyo Flow APIs
 * Tests the new flow endpoints to ensure they return data in the expected format
 */

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET || 'your-admin-secret';
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY || 'your-api-key';
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function testFlowsEndpoint() {
    console.log('🔄 Testing Flows Endpoint...');

    const url = new URL('/api/klaviyo/flows', BASE_URL);
    url.searchParams.set('klaviyoApiKey', KLAVIYO_API_KEY);
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('maxPages', '1');

    try {
        const response = await fetch(url.toString(), {
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Flows endpoint failed:', response.status, error);
            return false;
        }

        const data = await response.json();
        console.log('✅ Flows endpoint response:', {
            count: data.count,
            hasFlows: data.flows && data.flows.length > 0,
            sampleFlow: data.flows?.[0] || null,
        });

        return data.flows && data.flows.length > 0 ? data.flows[0].id : null;
    } catch (error) {
        console.error('❌ Error testing flows endpoint:', error);
        return false;
    }
}

async function testFlowMessagesEndpoint(flowId) {
    if (!flowId) {
        console.log('⏭️  Skipping Flow Messages test (no flow ID available)');
        return false;
    }

    console.log('🔄 Testing Flow Messages Endpoint...');

    const url = new URL('/api/klaviyo/flow-messages', BASE_URL);
    url.searchParams.set('klaviyoApiKey', KLAVIYO_API_KEY);
    url.searchParams.set('flowId', flowId);
    url.searchParams.set('pageSize', '10');

    try {
        const response = await fetch(url.toString(), {
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Flow messages endpoint failed:', response.status, error);
            return false;
        }

        const data = await response.json();
        console.log('✅ Flow Messages endpoint response:', {
            flowId: data.flowId,
            count: data.count,
            hasMessages: data.flowMessages && data.flowMessages.length > 0,
            sampleMessage: data.flowMessages?.[0] || null,
        });

        return true;
    } catch (error) {
        console.error('❌ Error testing flow messages endpoint:', error);
        return false;
    }
}

async function testFlowAnalyticsEndpoint() {
    console.log('🔄 Testing Flow Analytics Endpoint (JSON)...');

    const url = new URL('/api/klaviyo/flow-analytics', BASE_URL);
    url.searchParams.set('klaviyoApiKey', KLAVIYO_API_KEY);
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('maxPages', '1');
    url.searchParams.set('format', 'json');

    try {
        const response = await fetch(url.toString(), {
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Flow analytics endpoint failed:', response.status, error);
            return false;
        }

        const data = await response.json();
        console.log('✅ Flow Analytics JSON endpoint response:', {
            count: data.count,
            hasAnalytics: data.flowAnalytics && data.flowAnalytics.length > 0,
            sampleAnalytic: data.flowAnalytics?.[0] || null,
        });

        return true;
    } catch (error) {
        console.error('❌ Error testing flow analytics endpoint:', error);
        return false;
    }
}

async function testFlowAnalyticsCSVEndpoint() {
    console.log('🔄 Testing Flow Analytics Endpoint (CSV)...');

    const url = new URL('/api/klaviyo/flow-analytics', BASE_URL);
    url.searchParams.set('klaviyoApiKey', KLAVIYO_API_KEY);
    url.searchParams.set('pageSize', '5');
    url.searchParams.set('maxPages', '1');
    url.searchParams.set('format', 'csv');

    try {
        const response = await fetch(url.toString(), {
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Flow analytics CSV endpoint failed:', response.status, error);
            return false;
        }

        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim());
        const headers = lines[0];

        console.log('✅ Flow Analytics CSV endpoint response:', {
            contentType: response.headers.get('content-type'),
            hasHeaders: headers.includes('Day') && headers.includes('Flow ID'),
            lineCount: lines.length,
            headersSample: headers.slice(0, 100) + (headers.length > 100 ? '...' : ''),
        });

        return true;
    } catch (error) {
        console.error('❌ Error testing flow analytics CSV endpoint:', error);
        return false;
    }
}

async function main() {
    console.log('🧪 Klaviyo Flow API Tests');
    console.log('========================');

    if (!KLAVIYO_API_KEY || KLAVIYO_API_KEY === 'your-api-key') {
        console.error('❌ KLAVIYO_API_KEY environment variable is not set');
        process.exit(1);
    }

    if (!ADMIN_SECRET || ADMIN_SECRET === 'your-admin-secret') {
        console.error('❌ ADMIN_JOB_SECRET environment variable is not set');
        process.exit(1);
    }

    const flowId = await testFlowsEndpoint();
    await testFlowMessagesEndpoint(flowId);
    await testFlowAnalyticsEndpoint();
    await testFlowAnalyticsCSVEndpoint();

    console.log('');
    console.log('🎉 Test suite completed!');
    console.log('');
    console.log('📋 Expected CSV Format (from your requirements):');
    console.log('Day,Flow ID,Flow Name,Flow Message ID,Flow Message Name,Flow Message Channel,Status,Delivered,Unique Opens,Open Rate,Unique Clicks,Click Rate,Placed Order,Placed Order Rate,Revenue,Revenue per Recipient,Unsub Rate,Complaint Rate,Bounce Rate,Tags');
    console.log('09/04/2025,Sz4yWQ,ec-welcome_flow,UtqWST,ec-welcome_flow-email3,Email,live,6.0,3.0,0.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,');
}

main().catch(console.error);