// Flow API test that handles flow ID requirement
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment from .env.local
try {
    const envPath = path.join(__dirname, '.env.local');
    const envData = fs.readFileSync(envPath, 'utf8');
    envData.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
    console.log('✅ Environment loaded from .env.local');
} catch (error) {
    console.log('⚠️  Could not load .env.local, using existing environment');
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const ADMIN_JOB_SECRET = process.env.ADMIN_JOB_SECRET;

if (!KLAVIYO_API_KEY) {
    console.error('❌ KLAVIYO_API_KEY is required');
    process.exit(1);
}

if (!ADMIN_JOB_SECRET) {
    console.error('❌ ADMIN_JOB_SECRET is required');
    process.exit(1);
}

console.log('🎯 Testing flow analytics APIs with flow ID handling');
console.log(`📡 Base URL: ${BASE_URL}`);
console.log(`🔑 API Key: ${KLAVIYO_API_KEY.substring(0, 10)}...`);

// Simple fetch function
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;

        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = lib.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    text: () => Promise.resolve(data),
                    json: () => Promise.resolve(JSON.parse(data))
                });
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function testFlowsEndpoint() {
    console.log('\n🔄 Testing /api/klaviyo/flows...');

    try {
        const url = `${BASE_URL}/api/klaviyo/flows?klaviyoApiKey=${KLAVIYO_API_KEY}`;
        const response = await makeRequest(url, {
            headers: {
                'x-admin-job-secret': ADMIN_JOB_SECRET,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ Flows endpoint failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text.substring(0, 500));
            return false;
        }

        const data = await response.json();
        console.log('✅ Flows endpoint successful');
        console.log('📊 Result:', {
            count: data.count,
            hasFlows: data.flows && data.flows.length > 0,
            firstFlowId: data.flows?.[0]?.id || null
        });

        return data;
    } catch (error) {
        console.error('❌ Error testing flows endpoint:', error.message);
        return false;
    }
}

async function testFlowMessagesEndpoint(flowId) {
    console.log(`\n🔄 Testing /api/klaviyo/flow-messages with flowId=${flowId}...`);

    try {
        const url = `${BASE_URL}/api/klaviyo/flow-messages?klaviyoApiKey=${KLAVIYO_API_KEY}&flowId=${flowId}`;
        const response = await makeRequest(url, {
            headers: {
                'x-admin-job-secret': ADMIN_JOB_SECRET,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ Flow messages endpoint failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text.substring(0, 500));
            return false;
        }

        const data = await response.json();
        console.log('✅ Flow messages endpoint successful');
        console.log('📊 Result:', {
            count: data.count,
            hasMessages: data.flowMessages && data.flowMessages.length > 0,
            firstMessageId: data.flowMessages?.[0]?.id || null
        });

        return data;
    } catch (error) {
        console.error('❌ Error testing flow messages endpoint:', error.message);
        return false;
    }
}

async function testDirectKlaviyoAPI() {
    console.log('\n🔍 Testing direct Klaviyo API to check available endpoints...');

    // Let's try to get flow analytics directly from Klaviyo
    const testEndpoints = [
        'https://a.klaviyo.com/api/flow-analytics',
        'https://a.klaviyo.com/api/flows/analytics',
        'https://a.klaviyo.com/api/flows/QTTzp8/analytics'
    ];

    for (const endpoint of testEndpoints) {
        try {
            console.log(`🧪 Testing: ${endpoint}`);

            const response = await makeRequest(endpoint, {
                headers: {
                    'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
                    'revision': '2024-06-15',
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                console.log(`✅ ${endpoint} works!`);
                const data = await response.json();
                console.log('Sample data:', JSON.stringify(data, null, 2).substring(0, 500));
                return endpoint;
            } else {
                console.log(`❌ ${endpoint}: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.log(`❌ ${endpoint}: Error - ${error.message}`);
        }
    }

    return null;
}

async function generateSampleFlowAnalytics() {
    console.log('\n🎲 Generating sample flow analytics data (since API endpoint not available)...');

    // Generate sample data in our expected format
    const sampleData = [
        {
            day: '2024-01-15',
            flowId: 'QTTzp8',
            flowName: 'Welcome Series',
            flowMessageId: 'msg_001',
            flowMessageName: 'Welcome Email 1',
            flowMessageChannel: 'email',
            status: 'sent',
            delivered: 1250,
            uniqueOpens: 875,
            openRate: 0.70,
            uniqueClicks: 125,
            clickRate: 0.10,
            unsubscribes: 15,
            unsubscribeRate: 0.012,
            bounced: 8,
            revenue: 2150.00,
            revenuePerEmail: 1.72
        },
        {
            day: '2024-01-15',
            flowId: 'QTTzp8',
            flowName: 'Welcome Series',
            flowMessageId: 'msg_002',
            flowMessageName: 'Welcome Email 2',
            flowMessageChannel: 'email',
            status: 'sent',
            delivered: 1100,
            uniqueOpens: 770,
            openRate: 0.70,
            uniqueClicks: 89,
            clickRate: 0.081,
            unsubscribes: 12,
            unsubscribeRate: 0.011,
            bounced: 6,
            revenue: 1890.50,
            revenuePerEmail: 1.72
        }
    ];

    console.log('📊 Generated sample analytics with', sampleData.length, 'entries');
    return sampleData;
}

async function generateCSVFromAnalytics(analytics) {
    console.log('\n📄 Converting analytics to CSV format...');

    const headers = [
        'Day', 'Flow ID', 'Flow Name', 'Flow Message ID', 'Flow Message Name',
        'Flow Message Channel', 'Status', 'Delivered', 'Unique Opens', 'Open Rate',
        'Unique Clicks', 'Click Rate', 'Unsubscribes', 'Unsubscribe Rate',
        'Bounced', 'Revenue', 'Revenue Per Email'
    ];

    const csvLines = [headers.join(',')];

    for (const entry of analytics) {
        const row = [
            entry.day,
            entry.flowId,
            entry.flowName,
            entry.flowMessageId,
            entry.flowMessageName,
            entry.flowMessageChannel,
            entry.status,
            entry.delivered,
            entry.uniqueOpens,
            entry.openRate,
            entry.uniqueClicks,
            entry.clickRate,
            entry.unsubscribes,
            entry.unsubscribeRate,
            entry.bounced,
            entry.revenue,
            entry.revenuePerEmail
        ];
        csvLines.push(row.join(','));
    }

    const csv = csvLines.join('\n');
    console.log('✅ CSV generated with', csvLines.length, 'lines');
    console.log('📋 Preview:', csv.split('\n').slice(0, 3).join('\n'));

    return csv;
}

async function main() {
    console.log('🚀 Starting comprehensive flow API investigation');

    try {
        // Step 1: Test flows endpoint to get flow ID
        const flows = await testFlowsEndpoint();
        if (!flows || !flows.flows || flows.flows.length === 0) {
            console.error('❌ No flows available for testing');
            return;
        }

        const firstFlowId = flows.flows[0].id;
        console.log(`\n🎯 Using flow ID: ${firstFlowId}`);

        // Step 2: Test flow messages with the flow ID
        const messages = await testFlowMessagesEndpoint(firstFlowId);

        // Step 3: Investigate direct Klaviyo API endpoints
        const workingEndpoint = await testDirectKlaviyoAPI();

        // Step 4: Generate sample analytics data (since the API endpoint seems unavailable)
        const sampleAnalytics = await generateSampleFlowAnalytics();

        // Step 5: Convert to CSV format
        const csvData = await generateCSVFromAnalytics(sampleAnalytics);

        console.log('\n📋 Investigation Summary:');
        console.log(`  ✅ Flows endpoint: ${flows ? 'PASS' : 'FAIL'} (${flows ? flows.count : 0} flows)`);
        console.log(`  ✅ Flow messages endpoint: ${messages ? 'PASS' : 'FAIL'} (${messages ? messages.count : 0} messages)`);
        console.log(`  ✅ Direct Klaviyo API: ${workingEndpoint ? 'FOUND' : 'NOT FOUND'}`);
        console.log(`  ✅ Sample analytics: GENERATED (${sampleAnalytics.length} entries)`);
        console.log(`  ✅ CSV conversion: READY (${csvData.split('\n').length} lines)`);

        if (flows && messages) {
            console.log('\n🎉 Flow basics are working!');
            console.log('💡 We can use flow and flow-message data to build analytics');
            console.log('📤 Sample CSV data is ready for upload testing');
        }

        console.log('\n📄 Generated CSV Preview:');
        console.log(csvData);

    } catch (error) {
        console.error('❌ Investigation failed:', error);
    }
}

main().catch(console.error);