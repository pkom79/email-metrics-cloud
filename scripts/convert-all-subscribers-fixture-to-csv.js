// Safe local conversion script (no external calls)
// Reads scripts/fixtures/klaviyo_all_subscribers_sample.json and prints subscribers.csv to stdout
// This JS version avoids requiring ts-node.

const fs = require('fs');
const path = require('path');

function mapProfilesToRows(profiles) {
    return (profiles || [])
        .filter((p) => p && p.email)
        .map((p) => ({
            Email: p.email,
            'Email Marketing Consent': 'Subscribed',
            'Created At': p.created,
            'Klaviyo ID': p.id,
            'First Name': p.first_name ?? undefined,
            'Last Name': p.last_name ?? undefined,
        }));
}

function toCsv(rows) {
    const headers = [
        'Email',
        'Email Marketing Consent',
        'Created At',
        'Klaviyo ID',
        'First Name',
        'Last Name',
    ];
    const escape = (v) => {
        if (v === undefined || v === null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => escape(row[h])).join(','));
    }
    return lines.join('\n') + '\n';
}

function main() {
    const fixturePath = path.resolve(__dirname, 'fixtures/klaviyo_all_subscribers_sample.json');
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const json = JSON.parse(raw);
    const rows = mapProfilesToRows(json.data || []);
    const csv = toCsv(rows);
    process.stdout.write(csv);
}

main();
