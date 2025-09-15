# Audience Sync (all_subscribers) — Safe Test

## Quickstart (step-by-step)

Follow these steps to test safely on your machine. Defaults are non-destructive.

1) Prerequisites
- Start your dev server in another terminal: npm run dev
- Create or update `.env.local` at the repo root:
   KLAVIYO_ENABLE=true
   ADMIN_JOB_SECRET=replace-with-strong-secret
   AUDIENCE_STAGING_BUCKET=audience-staging           # create this bucket in Supabase Storage
   # Optional if you don’t want to pass it in requests
   KLAVIYO_API_KEY=pk_xxx_staging_only

2) Dry-run against Klaviyo (JSON preview)
- In a terminal, run:
   curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
      -H "Content-Type: application/json" \
      -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
      -d '{
         "mode": "dry-run",
         "format": "json",
         "source": "klaviyo",
         "pageSize": 100,
         "maxPages": 1
      }'

Expected: JSON with a row count and a few preview lines of CSV. Suppressed/unsubscribed are excluded; never_subscribed and list/Shopify leads are included.

3) Dry-run but get raw CSV locally (no writes)
- In a terminal, run:
   curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
      -H "Content-Type: application/json" \
      -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
      -d '{
         "mode": "dry-run",
         "format": "csv",
         "source": "klaviyo",
         "pageSize": 200,
         "maxPages": 2
      }' > /tmp/subscribers.csv
   open /tmp/subscribers.csv

4) Optional: Live write to a staging bucket (safe path)
- Choose IDs for isolation:
   export EMC_ACCOUNT_ID=acc_canary_1
   export EMC_UPLOAD_ID=$(date +%Y-%m-%d_%H-%M-%S)

- Run:
   curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
      -H "Content-Type: application/json" \
      -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
      -d "{\n      \"mode\": \"live\",\n      \"format\": \"json\",\n      \"source\": \"klaviyo\",\n      \"accountId\": \"$EMC_ACCOUNT_ID\",\n      \"uploadId\": \"$EMC_UPLOAD_ID\",\n      \"pageSize\": 500,\n      \"maxPages\": 10\n    }"

Expected: JSON confirming a write into Supabase Storage at
audience-staging/<accountId>/<uploadId>/subscribers.csv within the `AUDIENCE_STAGING_BUCKET`.

5) Optional: Test without Klaviyo (send your own profiles)
- Use the fixture mapping locally:
   node scripts/convert-all-subscribers-fixture-to-csv.js > /tmp/subscribers.csv && open /tmp/subscribers.csv

- Or call the API with your own profiles:
   curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
      -H "Content-Type: application/json" \
      -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
      -d '{
         "mode": "dry-run",
         "format": "json",
         "source": "profiles",
         "profiles": [
            { "id": "01", "email": "a@example.com", "created": "2024-01-01T00:00:00Z", "first_name": "A", "last_name": "Ex" },
            { "id": "02", "email": "b@example.com", "created": "2024-02-01T00:00:00Z" }
         ]
      }'

Troubleshooting
- 401/403: Ensure `x-admin-job-secret` matches `ADMIN_JOB_SECRET` and `KLAVIYO_ENABLE=true` is in `.env.local`.
- 400 unknown source: Body must set `source` to `profiles` or `klaviyo`.
- No file written in live mode: Ensure `AUDIENCE_STAGING_BUCKET` exists in Supabase Storage and the service role has write access.

Live write requirements
- Add these to your root `.env.local` so the server can write to Supabase Storage:
   - `NEXT_PUBLIC_SUPABASE_URL=...` (your Supabase project URL)
   - `SUPABASE_SERVICE_ROLE_KEY=...` (service role key)
- Verify they’re loaded: visit `/api/debug-env` and check that Supabase URL and service key are detected (lengths shown, not the secrets).
- After setting, restart `npm run dev`.

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

Safe API route (staging-only)
- Endpoint: `POST /api/klaviyo/audience-sync`
- Purpose: Map provided profiles (from a request body) into subscribers.csv, or fetch from Klaviyo (staging-only). Defaults to dry-run.

Request body (profiles source)
{
   "mode": "dry-run",               // or "live" (requires x-admin-job-secret and AUDIENCE_STAGING_BUCKET)
   "format": "json",                // or "csv" for raw CSV response (dry-run only)
   "source": "profiles",            // only "profiles" is enabled in this route
   "profiles": [ { "id": "...", "email": "...", "created": "ISO" } ],
   "accountId": "acc_123",          // optional (live)
   "uploadId": "2025-09-14"         // optional (live)
}

Headers for live mode
- `x-admin-job-secret: <ADMIN_JOB_SECRET>`
- Environment must set `AUDIENCE_STAGING_BUCKET` and `ADMIN_JOB_SECRET`.

Responses
- dry-run json: `{ mode: 'dry-run', rows: <number>, csvPreview: [first 5 lines] }`
- dry-run csv: raw CSV stream
- live json: `{ mode: 'live', wrote: { bucket, path }, rows }`

Safety
- No fetching from Klaviyo is performed by this route.
- Live writes are gated by a secret header and a staging-only bucket. This cannot overwrite canonical CSVs.

Klaviyo source (staging-only, gated)
- Set env: `KLAVIYO_ENABLE=true`, `ADMIN_JOB_SECRET`, (optional) `KLAVIYO_API_KEY`.
- Request body (klaviyo source):
{
   "mode": "dry-run",
   "format": "json",
   "source": "klaviyo",
   "klaviyoApiKey": "<staging_key>",   // or use env KLAVIYO_API_KEY
   "pageSize": 200,                     // optional; default 100
   "maxPages": 5                        // optional safety cap
}

Semantics
- Fetches all profiles that are NOT suppressed (excludes suppressed/unsubscribed), including never_subscribed, list imports, and Shopify leads.
- Client-side filtering enforces not-suppressed; no PII or secrets are logged.
- Live mode writes only to `audience-staging/<accountId>/<uploadId>/subscribers.csv` in `AUDIENCE_STAGING_BUCKET`.
