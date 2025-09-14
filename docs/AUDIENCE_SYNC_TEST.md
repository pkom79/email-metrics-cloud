# Audience Sync (all_subscribers) — Safe Test

Purpose: Validate mapping Klaviyo's all_subscribers segment into our canonical `subscribers.csv` schema without touching production data or UI.

Artifacts
- Mapping lib: `lib/klaviyo/audienceMapping.ts`
- Fixture: `scripts/fixtures/klaviyo_all_subscribers_sample.json`
- Converter (JS, no dependencies): `scripts/convert-all-subscribers-fixture-to-csv.js`

Try it locally (non-destructive)
1. Run the converter and preview CSV:
   node scripts/convert-all-subscribers-fixture-to-csv.js > /tmp/subscribers.csv
   open /tmp/subscribers.csv

2. Optional: Pipe into our parser to verify fields
   - The CSV headers match what `parseSubscribers()` in `lib/snapshotBuilder.ts` expects: `Email`, `Email Marketing Consent`, `Created At`, `Klaviyo ID`, `First Name`, `Last Name`.

Contract
- Consent is set to "Subscribed" for all profiles from the all_subscribers segment.
- Dates are ISO strings (UTC). UI will format them as needed.
- We do not add or remove UI; this is a staging-only utility.

Notes
- Follow branding guidelines in `docs/BRANDING.md` when any UI for audience is added later. No UI changes are made here.
- Keep PII out of logs. Do not commit real production data.
