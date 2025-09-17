# Audience Sync Runbook

This runbook documents how we reliably build the subscribers.csv from Klaviyo profiles (and optionally events enrichment) under safe defaults and clear gating, and how to operate and troubleshoot the sync.

Updated: 2025-09-17

---

## What the sync does

- Maps Klaviyo profiles into our canonical subscribers.csv. Three schemas supported:
  - minimal: smallest set for dashboard bootstrapping
  - extended: includes additional profile fields
  - required: exact headers for downstream reporting (includes First/Last Active/Open/Click fields)
- Sources:
  - Provided profiles in the request body (no external calls), or
  - Live fetch from Klaviyo Profiles API (NOT SUPPRESSED only), gated by feature flag + admin secret.
- Optional enrichment: looks up First Active / Last Open / Last Click via Events API for a subset (safety-capped).
- Outputs CSV either directly (dry-run) or writes to a staging bucket (live). In orchestrated runs feeding the dashboard snapshot processor, the subscribers.csv is written alongside flows.csv and campaigns.csv.

## Primary endpoint

- `POST /api/klaviyo/audience-sync`

Request body (common):
```
{
  "mode": "dry-run" | "live",     // default dry-run
  "format": "json" | "csv",       // default json
  "schema": "minimal" | "extended" | "required", // default minimal
  "source": "profiles" | "klaviyo" // default profiles
}
```

When `source = "profiles"` provide `profiles: KlaviyoProfileMinimal[]` in the body.  
When `source = "klaviyo"` provide a staging API key or set `KLAVIYO_API_KEY` in env; pass paging and sort options (`pageSize`, `maxPages`, `sortBy`, `sortDir`).

Headers (for live writes and Klaviyo source): `x-admin-job-secret: <ADMIN_JOB_SECRET>`

## Data sources and endpoints

- Profiles: `GET https://a.klaviyo.com/api/profiles`
  - Fields requested: email, first_name, last_name, created, updated, last_event_date, properties, external_id, phone_number, locale, location, organization, title, image, subscriptions, predictive_analytics.
  - Client-side filter drops suppressed/unsubscribed records. Never_subscribed and imports/leads remain.

- Events enrichment (optional for required schema): `GET https://a.klaviyo.com/api/events`
  - Filter by `profile_id` (fallback to `person_id`) and include `metric` to map names.
  - Target metrics: "Opened Email" and "Clicked Email"; infer earliest engagement as First Active.

## Timeframe & selection

- Profiles fetch is not date-windowed; use `pageSize` + `maxPages` + `sort` to keep calls bounded.
- Events enrichment is safety-capped: per-profile pageSize and maxPages are limited; `enrichProfileLimit` can restrict the number of profiles scanned.

## Rate limiting & safety

- Profiles fetch uses sequential paging. Keep `pageSize` ≤ 100 and a conservative `maxPages`.
- Events enrichment performs limited per-profile scans; set `enrichProfileLimit` and `enrichEventsMaxPages` to small values (e.g., 100 profiles × 3 pages).
- All live paths require:
  - `KLAVIYO_ENABLE=true`
  - `x-admin-job-secret` matching `ADMIN_JOB_SECRET`
  - Supabase service envs to upload (see below)
- Dry-run is the default and returns JSON or raw CSV without writes.

## Outputs

- Dry-run JSON: `{ mode: 'dry-run', rows, csvPreview: [] }`
- Dry-run CSV: streamed CSV response.
- Live write (staging): JSON confirming object path in `AUDIENCE_STAGING_BUCKET`.
- In ingestion orchestrations (dashboard): subscribers.csv is written to the data ingest bucket together with flows.csv and campaigns.csv prior to snapshot processing.

Required schema headers (exact order):
```
Email, Klaviyo ID, First Name, Last Name, Email Marketing Consent, Email Suppressions, Email Suppressions Timestamp, First Active, Last Active, Profile Created On, Last Open, Last Click, Total Customer Lifetime Value, Predicted Customer Lifetime Value, Predicted Number Of Orders, Average Order Value, Average Days Between Orders, Historic Customer Lifetime Value, Historic Number Of Orders, Expected Date Of Next Order
```

## Environment variables

- Gating & Klaviyo
  - `KLAVIYO_ENABLE=true`
  - `KLAVIYO_API_KEY` (or pass `klaviyoApiKey` per request)
  - `KLAVIYO_API_REVISION` (default `2024-06-15`)
  - `ADMIN_JOB_SECRET`

- Storage (for live route writes)
  - `AUDIENCE_STAGING_BUCKET` (staging-only route writes)
  - For orchestrated dashboard ingest: service keys and ingest bucket (see snapshot processor).
  - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## How to run

Dry-run preview (Klaviyo source, JSON):
```bash
curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
  -H "Content-Type: application/json" \
  -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
  -d '{
    "mode": "dry-run",
    "format": "json",
    "source": "klaviyo",
    "schema": "required",
    "pageSize": 100,
    "maxPages": 1
  }'
```

Dry-run CSV to file:
```bash
curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
  -H "Content-Type: application/json" \
  -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
  -d '{
    "mode": "dry-run",
    "format": "csv",
    "source": "klaviyo",
    "schema": "required",
    "pageSize": 200,
    "maxPages": 2
  }' > /tmp/subscribers.csv
```

Live write to staging bucket (safe path):
```bash
curl -sS -X POST "http://localhost:3000/api/klaviyo/audience-sync" \
  -H "Content-Type: application/json" \
  -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
  -d '{
    "mode": "live",
    "format": "json",
    "source": "klaviyo",
    "schema": "required",
    "accountId": "acc_canary_1",
    "uploadId": "2025-09-17T01-00-00Z",
    "pageSize": 500,
    "maxPages": 10
  }'
```

## Troubleshooting

- 501 Klaviyo disabled: set `KLAVIYO_ENABLE=true`.
- 401 Unauthorized: missing or wrong `x-admin-job-secret`, or missing admin secret env.
- No rows: lower `pageSize` and `maxPages`; verify API key has access; ensure suppression filtering isn’t excluding everything.
- Enrichment blank: events enrichment is optional; check `enrichEvents` options and API key; high-volume tenants may need to disable enrichment.
- Upload failed: ensure Supabase envs and the staging bucket exist; service role has write access.

## Acceptance criteria checklist

- Produces subscribers.csv with selected schema and stable header order.
- Suppressed/unsubscribed profiles are excluded; never_subscribed and list imports allowed.
- Optional events enrichment fills First Active / Last Open / Last Click when enabled.
- Gated by feature flag and admin secret; dry-run by default; safe live writes confirmed.

## Orchestrator & Snapshot Ingest

- In production, audience sync runs as part of an orchestrated ingest that produces three files:
  - `subscribers.csv` (this sync)
  - `flows.csv` (see Flow Sync Runbook)
  - `campaigns.csv` (see Campaign Sync Runbook)
- The orchestrator writes all three into the data ingest bucket (env: `DATA_INGEST_BUCKET`, fallback `PREAUTH_BUCKET`) under a common `uploadId` folder:
  - `/<uploadId>/subscribers.csv`
  - `/<uploadId>/flows.csv`
  - `/<uploadId>/campaigns.csv`
- It then creates a snapshot row referencing `uploadId` and calls `POST /api/snapshots/process` which:
  - Reads the three CSVs from the ingest bucket
  - Computes `snapshot_series` and `snapshot_totals`
  - Updates `snapshots.last_email_date`
- For incremental nightly updates, the orchestrator can patch only a recent window (e.g., yesterday ±1 day) by deleting series rows in that date range for the target snapshot and re-inserting new rows; totals are recalculated from the series.
