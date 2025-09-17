// Simple flow API test using proper authentication
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

console.log('🎯 Testing flow analytics APIs');
console.log(`📡 Base URL: ${BASE_URL}`);
console.log(`🔑 API Key: ${KLAVIYO_API_KEY.substring(0, 10)}...`);
console.log(`🔐 Admin Secret: ${ADMIN_JOB_SECRET.substring(0, 10)}...`);

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

async function testFlowMessagesEndpoint() {
    console.log('\n🔄 Testing /api/klaviyo/flow-messages...');

    try {
        const url = `${BASE_URL}/api/klaviyo/flow-messages?klaviyoApiKey=${KLAVIYO_API_KEY}`;
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

async function testFlowAnalyticsJSON() {
    console.log('\n🔄 Testing /api/klaviyo/flow-analytics (JSON)...');

    try {
        const url = `${BASE_URL}/api/klaviyo/flow-analytics?format=json&klaviyoApiKey=${KLAVIYO_API_KEY}`;
        const response = await makeRequest(url, {
            headers: {
                'x-admin-job-secret': ADMIN_JOB_SECRET,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ Flow analytics JSON failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text.substring(0, 500));
            return false;
        }

        const data = await response.json();
        console.log('✅ Flow analytics JSON successful');
        console.log('📊 Result:', {
            hasAnalytics: Array.isArray(data) && data.length > 0,
            count: Array.isArray(data) ? data.length : 0,
            firstEntry: data?.[0] || null
        });

        return data;
    } catch (error) {
        console.error('❌ Error testing flow analytics JSON:', error.message);
        return false;
    }
}

async function testFlowAnalyticsCSV() {
    console.log('\n🔄 Testing /api/klaviyo/flow-analytics (CSV)...');

    try {
        const url = `${BASE_URL}/api/klaviyo/flow-analytics?format=csv&klaviyoApiKey=${KLAVIYO_API_KEY}`;
        const response = await makeRequest(url, {
            headers: {
                'x-admin-job-secret': ADMIN_JOB_SECRET,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ Flow analytics CSV failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text.substring(0, 500));
            return false;
        }

        const csvData = await response.text();
        console.log('✅ Flow analytics CSV successful');

        const lines = csvData.split('\n').filter(line => line.trim());
        console.log(`📊 CSV has ${lines.length} lines (including header)`);

        if (lines.length > 0) {
            console.log('📋 CSV Header:', lines[0]);
            if (lines.length > 1) {
                console.log('📋 First data row:', lines[1]);
            }
        }

        return csvData;
    } catch (error) {
        console.error('❌ Error testing flow analytics CSV:', error.message);
        return false;
    }
}

async function main() {
    console.log('🚀 Starting flow API testing');

    try {
        // Test all endpoints
        const flows = await testFlowsEndpoint();
        const messages = await testFlowMessagesEndpoint();
        const analyticsJSON = await testFlowAnalyticsJSON();
        const analyticsCSV = await testFlowAnalyticsCSV();

        console.log('\n📋 Test Summary:');
        console.log(`  ✅ Flows endpoint: ${flows ? 'PASS' : 'FAIL'}`);
        console.log(`  ✅ Flow messages endpoint: ${messages ? 'PASS' : 'FAIL'}`);
        console.log(`  ✅ Flow analytics JSON: ${analyticsJSON ? 'PASS' : 'FAIL'}`);
        console.log(`  ✅ Flow analytics CSV: ${analyticsCSV ? 'PASS' : 'FAIL'}`);

        const allPassed = flows && messages && analyticsJSON && analyticsCSV;

        if (allPassed) {
            console.log('\n🎉 All flow API tests passed!');
            console.log('✅ Flow functionality is working correctly');

            if (analyticsCSV) {
                console.log('\n📤 Ready for live data upload test!');
                console.log('💡 You can now run a test that uploads this flow data to Supabase');
            }
        } else {
            console.log('\n⚠️  Some tests failed. Check the logs above for details.');
        }

    } catch (error) {
        console.error('❌ Test suite failed:', error);
    }
}

main().catch(console.error);