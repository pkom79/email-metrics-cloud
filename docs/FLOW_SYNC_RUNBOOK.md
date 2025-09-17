# Flow Sync Runbook

This runbook documents how we reliably build flows.csv from Klaviyo Flow APIs (message-level daily metrics), with clear gating, rate-limit awareness, and operations guidance.

Updated: 2025-09-17

---

## What the sync does

- Fetches flows and their messages (email channel) and builds a per-day time series of performance metrics.
- Primary metric source is Klaviyo’s flow-report analytics (grouped by `flow_action_id` so message mapping is consistent).
- Enriches message names/channels via the Flow Messages endpoint to ensure IDs → human names and channel are stable.
- Writes CSV compatible with the snapshot processor and dashboard.

## Primary endpoint

- `POST /api/klaviyo/flow-sync`

Request body (common toggles):
```
{
  "mode": "dry-run" | "live",                 // default dry-run
  "format": "json" | "csv",                   // default json
  "days": 7, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", // timeframe controls (account TZ)
  "limitFlows": 25, "limitMessages": 50,      // safety caps
  "enrichMessageNames": true,                   // fetch flow messages to map names/channels
  "aggregation": "per-day" | "range" | "auto",
  "timeframeKey": "last_30_days",             // optional pre-defined window
  "conversionMetricId": "...",                 // optional override (Placed Order)
  "debug": false
}
```

Headers for live writes and all calls: `x-admin-job-secret: <ADMIN_JOB_SECRET>`.  
Klaviyo API key: pass `klaviyoApiKey` or set in env (`KLAVIYO_API_KEY` or `KLAVIYO_API_KEY_PRIVATE`).

## Data sources and endpoints

- Flows list and message traversal
  - `GET https://a.klaviyo.com/api/flows`
  - `GET https://a.klaviyo.com/api/flows/{id}/flow-actions` (or `flow-messages`) for messages and their action IDs

- Analytics (primary)
  - Flow Report endpoint (queried per day or range) grouped by `flow_action_id`; includes delivered, opens, clicks, conversions, revenue, and rates.
  - Conversion metric id: resolved via `GET /api/metrics` for “Placed Order” (preferred integration Shopify when available).

## Timezone & timeframe logic

- Account timezone is resolved and applied; defaults to UTC if unknown.
- Default mode is per-day aggregation across the requested window.
- Alternative `range` mode runs a single multi-day analytics request (use with caution if you need lower call counts). `auto` can attempt per-day then fallback.
- Draft flows can be included with zero rows (`includeDrafts`) to create stable shapes.

## Rate limiting & safety

- The implementation uses internal pacing between daily requests; avoid large `days` for one-off calls.
- Recommended caps: `limitFlows ≤ 50`, `limitMessages ≤ 100`, `days ≤ 30`.
- Global limiter envs are available if you observe 429s: `KLAVIYO_LIMIT_GLOBAL_BURST`, `KLAVIYO_LIMIT_GLOBAL_PER_MINUTE`.
- Row budget: the route enforces a CSV row limit (e.g., 50,000) and fails fast with a clear error if exceeded.
- Live paths require: `KLAVIYO_ENABLE=true` and correct admin secret; Supabase service envs for uploads.

## Outputs

- Dry-run JSON: `{ mode, rows, days, flows, sample, csvPreview, diagnostics }`
- Dry-run CSV: streamed rows with stable header order:
```
Day, Flow ID, Flow Name, Flow Message ID, Flow Message Name, Flow Message Channel, Status, Delivered, Unique Opens, Open Rate, Unique Clicks, Click Rate, Placed Order, Placed Order Rate, Revenue, Revenue per Recipient, Unsub Rate, Complaint Rate, Bounce Rate, Tags
```
- Live write (staging): JSON confirming object path in `FLOW_STAGING_BUCKET`.
- In ingestion orchestrations (dashboard): flows.csv is written to the data ingest bucket with campaigns.csv and subscribers.csv prior to snapshot processing.

## Environment variables

- Gating & Klaviyo
  - `KLAVIYO_ENABLE=true`
  - `KLAVIYO_API_KEY` or `KLAVIYO_API_KEY_PRIVATE`
  - `KLAVIYO_API_REVISION` (default `2024-06-15`)
  - `ADMIN_JOB_SECRET`

- Analytics / conversion metric
  - `SHOPIFY_PLACED_ORDER_METRIC_ID` (optional; otherwise resolved via Metrics API)

- Storage (for live route writes)
  - `FLOW_STAGING_BUCKET` (staging-only route writes)
  - For orchestrated dashboard ingest: service role and ingest bucket (see snapshot processor).
  - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## How to run

Dry-run JSON for last 7 days:
```bash
curl -sS -X POST "http://localhost:3000/api/klaviyo/flow-sync" \
  -H "Content-Type: application/json" \
  -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
  -d '{
    "mode": "dry-run",
    "format": "json",
    "days": 7,
    "limitFlows": 20,
    "enrichMessageNames": true
  }'
```

CSV (range example):
```bash
curl -sS -X POST "http://localhost:3000/api/klaviyo/flow-sync" \
  -H "Content-Type: application/json" \
  -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
  -d '{
    "mode": "dry-run",
    "format": "csv",
    "start": "2025-09-01",
    "end": "2025-09-05",
    "limitFlows": 10
  }' > /tmp/flows.csv
```

Live write to staging bucket:
```bash
curl -sS -X POST "http://localhost:3000/api/klaviyo/flow-sync" \
  -H "Content-Type: application/json" \
  -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
  -d '{
    "mode": "live",
    "format": "json",
    "accountId": "acc_canary_1",
    "uploadId": "2025-09-17T01-00-00Z",
    "days": 7,
    "limitFlows": 20,
    "enrichMessageNames": true
  }'
```

## Troubleshooting

- 501 Klaviyo disabled: set `KLAVIYO_ENABLE=true`.
- 401 Unauthorized: admin secret missing/invalid.
- Range too large / row budget exceeded: reduce `days`, `limitFlows`, `limitMessages`.
- Zero rows / missing metrics: ensure analytics are available in your workspace; verify conversion metric id (“Placed Order”) resolution.
- 429s: reduce per-minute budget via global limiter envs; space out calls by increasing the daily pacing (or use `range` mode cautiously for fewer calls).
- Upload failed: verify Supabase envs and staging bucket permissions.

## Acceptance criteria checklist

- Produces flows.csv with stable headers and per-day rows per message.
- Applies account-timezone date logic; supports per-day and range modes.
- Enforces conservative caps and returns clear diagnostics when limited.
- Gated by feature flag and admin secret; dry-run by default; safe live writes confirmed.

## Orchestrator & Snapshot Ingest

- In production, flow sync is one of three CSV producers used to build a snapshot:
  - `flows.csv` (this sync)
  - `campaigns.csv` (Campaign Sync Runbook)
  - `subscribers.csv` (Audience Sync Runbook)
- The orchestrator writes these files into the data ingest bucket (env: `DATA_INGEST_BUCKET`, fallback `PREAUTH_BUCKET`) under `/<uploadId>/...` and then creates a snapshot and triggers `POST /api/snapshots/process`.
- The processor reads the three CSVs, generates `snapshot_series` and `snapshot_totals`, and sets `snapshots.last_email_date`.
- For nightly updates, prefer a small patch window (e.g., yesterday ±1) rather than rebuilding the entire two-year history; delete series rows in-range then re-insert to avoid duplicates.
