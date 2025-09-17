#!/usr/bin/env node

/**
 * Live Test Script for Klaviyo Flow APIs with Supabase Integration
 * Tests flow endpoints and uploads sample data to acc_canary_1 account
 */

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET || 'your-admin-secret';
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY || 'your-api-key';
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Test account configuration
const TEST_ACCOUNT_ID = 'acc_canary_1';
const TEST_UPLOAD_ID = `flow-test-${new Date().toISOString().replace(/[:.]/g, '-')}`;

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

        return data.flows && data.flows.length > 0 ? data.flows[0] : null;
    } catch (error) {
        console.error('❌ Error testing flows endpoint:', error);
        return false;
    }
}

async function testFlowAnalyticsEndpoint() {
    console.log('🔄 Testing Flow Analytics Endpoint...');

    const url = new URL('/api/klaviyo/flow-analytics', BASE_URL);
    url.searchParams.set('klaviyoApiKey', KLAVIYO_API_KEY);
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('maxPages', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('startDate', '2025-09-01');
    url.searchParams.set('endDate', '2025-09-15');

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
            return null;
        }

        const data = await response.json();
        console.log('✅ Flow Analytics endpoint response:', {
            count: data.count,
            hasAnalytics: data.flowAnalytics && data.flowAnalytics.length > 0,
            sampleAnalytic: data.flowAnalytics?.[0] || null,
        });

        return data.flowAnalytics || [];
    } catch (error) {
        console.error('❌ Error testing flow analytics endpoint:', error);
        return null;
    }
}

async function generateSampleFlowCSV(analytics) {
    console.log('📝 Generating sample flow CSV data...');

    // Use real data if available, otherwise generate sample data
    let flowData = analytics && analytics.length > 0 ? analytics : [];

    if (flowData.length === 0) {
        // Generate sample data matching your requirements
        flowData = [
            {
                day: '2025-09-04',
                flowId: 'Sz4yWQ',
                flowName: 'ec-welcome_flow',
                flowMessageId: 'UtqWST',
                flowMessageName: 'ec-welcome_flow-email1',
                channel: 'Email',
                status: 'live',
                delivered: 10,
                uniqueOpens: 6,
                openRate: 0.6,
                uniqueClicks: 2,
                clickRate: 0.2,
                placedOrders: 1,
                placedOrderRate: 0.1,
                revenue: 45.99,
                revenuePerRecipient: 4.599,
                unsubscribeRate: 0.01,
                complaintRate: 0.005,
                bounceRate: 0.02,
            },
            {
                day: '2025-09-05',
                flowId: 'Sz4yWQ',
                flowName: 'ec-welcome_flow',
                flowMessageId: 'UtqWS2',
                flowMessageName: 'ec-welcome_flow-email2',
                channel: 'Email',
                status: 'live',
                delivered: 8,
                uniqueOpens: 4,
                openRate: 0.5,
                uniqueClicks: 1,
                clickRate: 0.125,
                placedOrders: 0,
                placedOrderRate: 0.0,
                revenue: 0.0,
                revenuePerRecipient: 0.0,
                unsubscribeRate: 0.0,
                complaintRate: 0.0,
                bounceRate: 0.01,
            },
            {
                day: '2025-09-06',
                flowId: 'Sz4yWQ',
                flowName: 'ec-welcome_flow',
                flowMessageId: 'UtqWS3',
                flowMessageName: 'ec-welcome_flow-email3',
                channel: 'Email',
                status: 'live',
                delivered: 6,
                uniqueOpens: 3,
                openRate: 0.5,
                uniqueClicks: 0,
                clickRate: 0.0,
                placedOrders: 0,
                placedOrderRate: 0.0,
                revenue: 0.0,
                revenuePerRecipient: 0.0,
                unsubscribeRate: 0.0,
                complaintRate: 0.0,
                bounceRate: 0.0,
            }
        ];
    }

    // Convert to CSV format matching your requirements
    const headers = [
        'Day',
        'Flow ID',
        'Flow Name',
        'Flow Message ID',
        'Flow Message Name',
        'Flow Message Channel',
        'Status',
        'Delivered',
        'Unique Opens',
        'Open Rate',
        'Unique Clicks',
        'Click Rate',
        'Placed Order',
        'Placed Order Rate',
        'Revenue',
        'Revenue per Recipient',
        'Unsub Rate',
        'Complaint Rate',
        'Bounce Rate',
        'Tags'
    ];

    const csvRows = flowData.map(item => [
        item.day || '',
        item.flowId || '',
        item.flowName || '',
        item.flowMessageId || '',
        item.flowMessageName || '',
        item.channel || 'Email',
        item.status || 'live',
        item.delivered || 0,
        item.uniqueOpens || 0,
        (item.openRate || 0).toFixed(3),
        item.uniqueClicks || 0,
        (item.clickRate || 0).toFixed(3),
        item.placedOrders || 0,
        (item.placedOrderRate || 0).toFixed(3),
        (item.revenue || 0).toFixed(2),
        (item.revenuePerRecipient || 0).toFixed(3),
        (item.unsubscribeRate || 0).toFixed(3),
        (item.complaintRate || 0).toFixed(3),
        (item.bounceRate || 0).toFixed(3),
        item.tags || ''
    ]);

    const csv = [headers, ...csvRows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

    console.log('✅ Generated CSV data:', {
        rows: flowData.length,
        sampleRow: flowData[0]
    });

    return { csv, data: flowData };
}

async function generateSampleCampaignCSV() {
    console.log('📝 Generating sample campaign CSV data...');

    const headers = [
        'Campaign Name',
        'Tags',
        'Subject',
        'List',
        'Send Time',
        'Send Weekday',
        'Total Recipients',
        'Unique Placed Order',
        'Placed Order Rate',
        'Revenue',
        'Unique Opens',
        'Open Rate',
        'Total Opens',
        'Unique Clicks',
        'Click Rate',
        'Total Clicks',
        'Unsubscribes',
        'Spam Complaints',
        'Spam Complaints Rate',
        'Successful Deliveries',
        'Bounces',
        'Bounce Rate',
        'Campaign ID',
        'Campaign Channel'
    ];

    const campaignData = [
        [
            'Welcome Campaign Test',
            '',
            'Welcome to our store!',
            'Subscribers',
            '2025-09-04 10:00:00',
            'Wednesday',
            100,
            5,
            '0.05',
            '250.00',
            60,
            '0.6',
            65,
            15,
            '0.15',
            18,
            1,
            0,
            '0.0',
            98,
            2,
            '0.02',
            'C001',
            'Email'
        ]
    ];

    const csv = [headers, ...campaignData]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

    return csv;
}

async function generateSampleSubscriberCSV() {
    console.log('📝 Generating sample subscriber CSV data...');

    const headers = [
        'Email',
        'Klaviyo ID',
        'First Name',
        'Last Name',
        'Organization',
        'Title',
        'Phone Number',
        'Address',
        'Address 2',
        'City',
        'State / Region',
        'Country',
        'Zip Code',
        'Latitude',
        'Longitude',
        'Source',
        'IP Address',
        'Email Marketing Consent',
        'Email Marketing Consent Timestamp',
        'Historic Customer Lifetime Value',
        'Total Customer Lifetime Value',
        'Predicted Customer Lifetime Value',
        'Average Order Value',
        'Historic Number Of Orders',
        'First Active',
        'Last Active',
        'Profile Created On',
        'Date Added',
        'Last Open',
        'Last Click',
        'Average Days Between Orders',
        'Email Suppressions'
    ];

    const subscriberData = [
        [
            'test@example.com',
            'TEST001',
            'Test',
            'User',
            'Test Company',
            'Customer',
            '+1234567890',
            '123 Test St',
            '',
            'Test City',
            'Test State',
            'US',
            '12345',
            '40.7128',
            '-74.0060',
            'Website',
            '192.168.1.1',
            'subscribed',
            '2025-09-01 12:00:00',
            '100.00',
            '150.00',
            '200.00',
            '50.00',
            '3',
            '2025-09-01 12:00:00',
            '2025-09-06 15:30:00',
            '2025-09-01 12:00:00',
            '2025-09-01 12:00:00',
            '2025-09-06 10:15:00',
            '2025-09-05 14:20:00',
            '30',
            ''
        ],
        [
            'test2@example.com',
            'TEST002',
            'Test2',
            'User2',
            'Test Company',
            'Customer',
            '+1234567891',
            '456 Test Ave',
            '',
            'Test City',
            'Test State',
            'US',
            '12345',
            '40.7128',
            '-74.0060',
            'Website',
            '192.168.1.2',
            'subscribed',
            '2025-09-02 09:00:00',
            '75.00',
            '125.00',
            '175.00',
            '62.50',
            '2',
            '2025-09-02 09:00:00',
            '2025-09-06 16:45:00',
            '2025-09-02 09:00:00',
            '2025-09-02 09:00:00',
            '2025-09-06 11:30:00',
            '2025-09-04 13:15:00',
            '45',
            ''
        ]
    ];

    const csv = [headers, ...subscriberData]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

    return csv;
}

async function uploadCSVToSupabase(filename, csvContent) {
    console.log(`🔄 Uploading ${filename} to Supabase...`);

    try {
        const uploadUrl = new URL('/api/upload', BASE_URL);

        const formData = new FormData();
        const blob = new Blob([csvContent], { type: 'text/csv' });
        formData.append('file', blob, filename);
        formData.append('accountId', TEST_ACCOUNT_ID);
        formData.append('uploadId', TEST_UPLOAD_ID);

        const response = await fetch(uploadUrl.toString(), {
            method: 'POST',
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.text();
            console.error(`❌ Upload ${filename} failed:`, response.status, error);
            return false;
        }

        const result = await response.json();
        console.log(`✅ Uploaded ${filename}:`, result);
        return true;
    } catch (error) {
        console.error(`❌ Error uploading ${filename}:`, error);
        return false;
    }
}

async function createSnapshot() {
    console.log('🔄 Creating snapshot...');

    try {
        const snapshotUrl = new URL('/api/snapshots', BASE_URL);

        const response = await fetch(snapshotUrl.toString(), {
            method: 'POST',
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                accountId: TEST_ACCOUNT_ID,
                uploadId: TEST_UPLOAD_ID,
                label: `Flow API Test - ${new Date().toISOString().split('T')[0]}`,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Snapshot creation failed:', response.status, error);
            return null;
        }

        const result = await response.json();
        console.log('✅ Snapshot created:', result);
        return result.snapshotId;
    } catch (error) {
        console.error('❌ Error creating snapshot:', error);
        return null;
    }
}

async function processSnapshot(snapshotId) {
    console.log('🔄 Processing snapshot...');

    try {
        const processUrl = new URL('/api/snapshots/process', BASE_URL);

        const response = await fetch(processUrl.toString(), {
            method: 'POST',
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                snapshotId: snapshotId,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Snapshot processing failed:', response.status, error);
            return false;
        }

        const result = await response.json();
        console.log('✅ Snapshot processed:', result);
        return true;
    } catch (error) {
        console.error('❌ Error processing snapshot:', error);
        return false;
    }
}

async function verifyDataInSupabase(snapshotId) {
    console.log('🔄 Verifying data in Supabase...');

    try {
        // This would typically use a Supabase client to query the data
        // For now, we'll just confirm the snapshot exists
        const verifyUrl = new URL(`/api/snapshots/${snapshotId}`, BASE_URL);

        const response = await fetch(verifyUrl.toString(), {
            headers: {
                'x-admin-job-secret': ADMIN_SECRET,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Data verification failed:', response.status, error);
            return false;
        }

        const result = await response.json();
        console.log('✅ Data verified in Supabase:', {
            snapshotId: result.id,
            label: result.label,
            status: result.status,
            lastEmailDate: result.last_email_date,
        });
        return true;
    } catch (error) {
        console.error('❌ Error verifying data:', error);
        return false;
    }
}

async function main() {
    console.log('🧪 Klaviyo Flow API Live Test with Supabase Integration');
    console.log('========================================================');
    console.log(`📍 Test Account: ${TEST_ACCOUNT_ID}`);
    console.log(`📍 Upload ID: ${TEST_UPLOAD_ID}`);
    console.log('');

    if (!KLAVIYO_API_KEY || KLAVIYO_API_KEY === 'your-api-key') {
        console.error('❌ KLAVIYO_API_KEY environment variable is not set');
        process.exit(1);
    }

    if (!ADMIN_SECRET || ADMIN_SECRET === 'your-admin-secret') {
        console.error('❌ ADMIN_JOB_SECRET environment variable is not set');
        process.exit(1);
    }

    // Step 1: Test Flow APIs
    console.log('📊 PHASE 1: Testing Flow APIs');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const flowData = await testFlowsEndpoint();
    const analytics = await testFlowAnalyticsEndpoint();

    // Step 2: Generate Sample Data
    console.log('\n📝 PHASE 2: Generating Sample Data');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const { csv: flowCSV } = await generateSampleFlowCSV(analytics);
    const campaignCSV = await generateSampleCampaignCSV();
    const subscriberCSV = await generateSampleSubscriberCSV();

    // Step 3: Upload to Supabase
    console.log('\n☁️  PHASE 3: Uploading to Supabase');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const uploadResults = await Promise.all([
        uploadCSVToSupabase('flows.csv', flowCSV),
        uploadCSVToSupabase('campaigns.csv', campaignCSV),
        uploadCSVToSupabase('subscribers.csv', subscriberCSV),
    ]);

    if (!uploadResults.every(Boolean)) {
        console.error('❌ Some uploads failed, aborting');
        process.exit(1);
    }

    // Step 4: Create and Process Snapshot
    console.log('\n🏗️  PHASE 4: Creating Snapshot');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const snapshotId = await createSnapshot();
    if (!snapshotId) {
        console.error('❌ Snapshot creation failed, aborting');
        process.exit(1);
    }

    const processSuccess = await processSnapshot(snapshotId);
    if (!processSuccess) {
        console.error('❌ Snapshot processing failed');
        process.exit(1);
    }

    // Step 5: Verify Data
    console.log('\n✅ PHASE 5: Verification');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const verifySuccess = await verifyDataInSupabase(snapshotId);

    // Final Summary
    console.log('\n🎉 TEST COMPLETED!');
    console.log('==================');
    console.log(`✅ Account ID: ${TEST_ACCOUNT_ID}`);
    console.log(`✅ Upload ID: ${TEST_UPLOAD_ID}`);
    console.log(`✅ Snapshot ID: ${snapshotId}`);
    console.log(`✅ Status: ${verifySuccess ? 'SUCCESS' : 'PARTIAL'}`);

    if (verifySuccess) {
        console.log('\n📋 Your flow data is now available in the dashboard!');
        console.log(`🔗 View at: ${BASE_URL}/dashboard`);
    }
}

main().catch(console.error);