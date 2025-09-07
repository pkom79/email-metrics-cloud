// Simple test script to hit our debug endpoint from browser console
// This can be run in the browser developer console while authenticated

async function testReliabilityDebug() {
    try {
        console.log('Testing Revenue Reliability debug endpoint...');

        const response = await fetch('/api/debug-reliability', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include' // Include session cookies
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Debug Response:', data);

        // Check for Nov-Feb data issue
        if (data.weeklyAggregates) {
            const novFebWeeks = data.weeklyAggregates.filter(week => {
                const weekDate = new Date(week.weekStart);
                const month = weekDate.getMonth(); // 0-based: 10=Nov, 11=Dec, 0=Jan, 1=Feb
                return month === 10 || month === 11 || month === 0 || month === 1;
            });

            console.log(`Nov-Feb weeks found: ${novFebWeeks.length}`);
            console.log('Nov-Feb weeks:', novFebWeeks);

            const zeroRevenueWeeks = novFebWeeks.filter(week => week.revenue === 0);
            console.log(`Zero revenue weeks in Nov-Feb: ${zeroRevenueWeeks.length}`);

            if (zeroRevenueWeeks.length > 0) {
                console.warn('⚠️ Found weeks with $0 revenue in Nov-Feb period:');
                zeroRevenueWeeks.forEach(week => {
                    console.warn(`Week ${week.weekStart}: $${week.revenue} revenue, ${week.emailsSent} emails sent`);
                });
            }
        }

        return data;
    } catch (error) {
        console.error('Error testing debug endpoint:', error);
        return null;
    }
}

// Run the test
testReliabilityDebug();
