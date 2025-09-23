// Debug script to test linking an upload with the known upload ID from your logs
const uploadId = '5f4703d6-13e5-49a3-ba0c-b057fb60b3f9';

const testLinkUpload = async () => {
    try {
        console.log('Testing link-upload for upload ID:', uploadId);

        const response = await fetch('https://email-metrics-cloud.vercel.app/api/auth/link-upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                uploadId: uploadId,
                label: 'Test Upload Link'
            })
        });

        const result = await response.json();
        console.log('Response status:', response.status);
        console.log('Response:', JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('Error:', error);
    }
};

testLinkUpload();
