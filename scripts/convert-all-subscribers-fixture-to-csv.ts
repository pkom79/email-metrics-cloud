/*
  Safe local conversion script:
  - Reads scripts/fixtures/klaviyo_all_subscribers_sample.json
  - Maps profiles to subscribers.csv rows (Subscribed consent)
  - Prints CSV to stdout

  Usage (optional):
    npx ts-node scripts/convert-all-subscribers-fixture-to-csv.ts > /tmp/subscribers.csv
*/

import fs from 'fs';
import path from 'path';
import { mapProfilesToSubscribersCsvRows, toCsv, KlaviyoProfileMinimal } from '../lib/klaviyo/audienceMapping';

function main() {
  const fixturePath = path.resolve(__dirname, 'fixtures/klaviyo_all_subscribers_sample.json');
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const json = JSON.parse(raw) as { data: KlaviyoProfileMinimal[] };
  const rows = mapProfilesToSubscribersCsvRows(json.data);
  const csv = toCsv(rows);
  process.stdout.write(csv);
}

main();
