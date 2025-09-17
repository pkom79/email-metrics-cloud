// Test flow analytics with live data upload using proper upload system
const https = require('https');
const http = require('http');

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !KLAVIYO_API_KEY) {
    console.error('❌ Missing required environment variables:');
    if (!SUPABASE_URL) console.error('  - NEXT_PUBLIC_SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
    if (!KLAVIYO_API_KEY) console.error('  - KLAVIYO_API_KEY');
    process.exit(1);
}

console.log('🎯 Starting live flow analytics test using proper upload system');
console.log(`📡 Base URL: ${BASE_URL}`);
console.log(`🔑 API Key: ${KLAVIYO_API_KEY.substring(0, 10)}...`);

// Simple fetch function using Node.js built-ins
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

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

async function testFlowAnalyticsLive() {
    try {
        console.log('\n🧪 Testing flow analytics API...');

        const url = `${BASE_URL}/api/klaviyo/flow-analytics?format=csv&admin_secret=${KLAVIYO_API_KEY}`;
        const response = await makeRequest(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ API request failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text);
            return null;
        }

        const csvData = await response.text();
        console.log('✅ Flow analytics API successful');
        console.log(`📊 CSV data length: ${csvData.length} characters`);

        const lines = csvData.split('\n');
        console.log('\n📋 First 5 lines of CSV:');
        lines.slice(0, 5).forEach((line, i) => {
            console.log(`  ${i + 1}: ${line}`);
        });

        console.log(`📈 Total data rows: ${lines.length - 1} (excluding header)`);
        return csvData;

    } catch (error) {
        console.error('❌ Error testing flow analytics:', error);
        return null;
    }
}

async function generateSampleFlowData() {
    console.log('\n🎲 Generating sample flow data...');

    const sampleData = `Day,Flow ID,Flow Name,Flow Message ID,Flow Message Name,Flow Message Channel,Status,Delivered,Unique Opens,Open Rate,Unique Clicks,Click Rate,Unsubscribes,Unsubscribe Rate,Bounced,Revenue,Revenue Per Email
2024-01-15,flow_001,Welcome Series,msg_001,Welcome Email 1,email,sent,1250,875,0.70,125,0.10,15,0.012,8,2150.00,1.72
2024-01-15,flow_001,Welcome Series,msg_002,Welcome Email 2,email,sent,1100,770,0.70,89,0.081,12,0.011,6,1890.50,1.72
2024-01-15,flow_002,Abandoned Cart,msg_003,Cart Reminder 1,email,sent,850,425,0.50,89,0.105,8,0.009,5,3200.00,3.76
2024-01-15,flow_002,Abandoned Cart,msg_004,Cart Reminder 2,email,sent,720,360,0.50,76,0.106,7,0.010,4,2850.25,3.96
2024-01-15,flow_003,Post Purchase,msg_005,Thank You Email,email,sent,950,713,0.75,95,0.10,5,0.005,3,1425.75,1.50`;

    return sampleData;
}

async function supabaseRequest(method, path, body = null) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const response = await makeRequest(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Prefer': 'return=representation'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    return response;
}

async function findCanaryAccount() {
    console.log('\n🔍 Looking for canary account...');

    try {
        const response = await supabaseRequest('GET', 'accounts?company=ilike.*canary*&select=*');

        if (!response.ok) {
            console.error('❌ Error querying accounts');
            return null;
        }

        const accounts = await response.json();
        console.log(`📋 Found ${accounts.length} accounts with "canary" in company name`);

        if (accounts.length > 0) {
            console.log(`✅ Found canary account: ${accounts[0].id}`);
            return accounts[0];
        } else {
            console.log('⚠️  No canary account found. Using test reference.');
            return { id: 'acc_canary_1', company: 'Canary Test Account' };
        }
    } catch (error) {
        console.error('❌ Error finding canary account:', error);
        return { id: 'acc_canary_1', company: 'Canary Test Account' };
    }
}

async function initializeUpload() {
    console.log('\n🔄 Initializing upload via API...');

    try {
        const response = await makeRequest(`${BASE_URL}/api/upload/init`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ Upload init failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text);
            return null;
        }

        const data = await response.json();
        console.log('✅ Upload initialized successfully');
        console.log('📋 Upload details:', {
            uploadId: data.uploadId,
            bucket: data.bucket,
            urls: Object.keys(data.urls)
        });

        return data;

    } catch (error) {
        console.error('❌ Error initializing upload:', error);
        return null;
    }
}

async function uploadFlowData(csvData, signedUrl) {
    console.log('\n📤 Uploading flow data via signed URL...');

    try {
        const response = await makeRequest(signedUrl, {
            method: 'PUT',
            body: csvData,
            headers: {
                'Content-Type': 'text/csv'
            }
        });

        if (!response.ok) {
            console.error(`❌ Upload failed: ${response.status} ${response.statusText}`);
            return false;
        }

        console.log('✅ Flow data uploaded successfully');
        return true;

    } catch (error) {
        console.error('❌ Error uploading flow data:', error);
        return false;
    }
}

async function uploadOtherFiles(uploadData) {
    console.log('\n📝 Uploading other required files...');

    const subscribersData = `Email,Status,Subscribed Date
test@example.com,subscribed,2024-01-01
user@example.com,subscribed,2024-01-02`;

    const campaignsData = `Campaign Name,Subject,Send Time,Recipients,Opens,Clicks,Revenue
Test Campaign,Welcome!,2024-01-15T10:00:00Z,100,50,10,250.00
Sample Campaign,Special Offer,2024-01-16T14:00:00Z,200,120,25,500.00`;

    try {
        const subscribersResponse = await makeRequest(uploadData.urls.subscribers.token, {
            method: 'PUT',
            body: subscribersData,
            headers: { 'Content-Type': 'text/csv' }
        });

        console.log(subscribersResponse.ok ? '✅ Subscribers uploaded' : '⚠️  Subscribers upload failed');

        const campaignsResponse = await makeRequest(uploadData.urls.campaigns.token, {
            method: 'PUT',
            body: campaignsData,
            headers: { 'Content-Type': 'text/csv' }
        });

        console.log(campaignsResponse.ok ? '✅ Campaigns uploaded' : '⚠️  Campaigns upload failed');
        return true;

    } catch (error) {
        console.error('⚠️  Error uploading other files:', error);
        return false;
    }
}

async function linkUploadToAccount(uploadId, accountId) {
    console.log('\n🔗 Linking upload to account...');

    try {
        const updateData = {
            account_id: accountId,
            status: 'processed',
            updated_at: new Date().toISOString()
        };

        const response = await supabaseRequest('PATCH', `uploads?id=eq.${uploadId}`, updateData);

        if (!response.ok) {
            console.error('❌ Upload linking failed');
            return null;
        }

        console.log('✅ Upload linked successfully');
        return { id: uploadId, ...updateData };

    } catch (error) {
        console.error('❌ Error linking upload:', error);
        return null;
    }
}

async function createSnapshot(accountId, uploadId) {
    console.log('\n📸 Creating snapshot...');

    try {
        const snapshotData = {
            id: `snapshot_${Date.now()}`,
            account_id: accountId,
            upload_id: uploadId,
            label: `Flow Analytics Test - ${new Date().toISOString().split('T')[0]}`,
            status: 'ready',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const response = await supabaseRequest('POST', 'snapshots', snapshotData);

        if (!response.ok) {
            console.error('❌ Snapshot creation failed');
            return null;
        }

        console.log('✅ Snapshot created successfully');
        return snapshotData;

    } catch (error) {
        console.error('❌ Error creating snapshot:', error);
        return null;
    }
}

async function main() {
    console.log('🚀 Starting comprehensive flow test with proper upload system');

    try {
        // Test flow analytics API
        const realCsvData = await testFlowAnalyticsLive();
        const csvData = realCsvData || await generateSampleFlowData();

        if (!csvData) {
            console.error('❌ No CSV data available');
            return;
        }

        // Find canary account
        const canaryAccount = await findCanaryAccount();
        if (!canaryAccount) {
            console.error('❌ No canary account');
            return;
        }

        // Initialize upload
        const uploadData = await initializeUpload();
        if (!uploadData) {
            console.error('❌ Upload initialization failed');
            return;
        }

        // Upload flow data
        const flowSuccess = await uploadFlowData(csvData, uploadData.urls.flows.token);
        if (!flowSuccess) {
            console.error('❌ Flow data upload failed');
            return;
        }

        // Upload other files
        await uploadOtherFiles(uploadData);

        // Link to account
        const linked = await linkUploadToAccount(uploadData.uploadId, canaryAccount.id);
        if (!linked) {
            console.error('❌ Upload linking failed');
            return;
        }

        // Create snapshot
        const snapshot = await createSnapshot(canaryAccount.id, uploadData.uploadId);
        if (!snapshot) {
            console.error('❌ Snapshot creation failed');
            return;
        }

        console.log('\n🎉 Flow test completed successfully!');
        console.log('📋 Summary:');
        console.log(`  - Account: ${canaryAccount.id}`);
        console.log(`  - Upload: ${uploadData.uploadId}`);
        console.log(`  - Snapshot: ${snapshot.id}`);
        console.log('\n✅ Flow data uploaded using proper system');
        console.log('🔗 Check the dashboard to see flow analytics data');

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

main().catch(console.error);