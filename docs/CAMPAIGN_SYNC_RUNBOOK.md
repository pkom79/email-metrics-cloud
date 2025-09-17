# Campaign Sync Runbook

This runbook documents how we reliably fetch Klaviyo campaign metrics (including revenue) under strict rate limits, and how to operate, tune, and troubleshoot the sync.

Updated: 2025-09-17

---

## What the sync does

- Pulls recent email campaigns and filters to a target date or date range (account timezone aware).
- For each campaign, fetches a single email message’s subject and audience labels (optional, can be skipped for speed).
- Calls Klaviyo Campaign Values Reports to retrieve accurate metrics including revenue derived from the “Placed Order” metric.
- Aggregates results and uploads a CSV to Supabase Storage.

## Key script

- `scripts/run-campaigns-live.ts`: Node/TypeScript runner invoked via `npm run campaigns:live`.

## Data sources and endpoints

The sync uses only Klaviyo’s values reporting for accuracy (no events fallback unless re-enabled):

- GET `/api/accounts` → account timezone (for local date filters)
- GET `/api/campaigns` and GET `/api/campaigns/{id}` → campaign metadata
- GET `/api/campaigns/{id}/campaign-messages` and GET `/api/campaign-messages/{id}` → email message + subject
- POST `/api/campaign-values-reports` → metrics. Request uses:
  - `statistics[]`: recipients, delivered, bounced, bounce_rate, opens_unique, open_rate, opens, clicks_unique, click_rate, clicks, conversion_uniques, conversion_rate, unsubscribes, unsubscribe_rate, spam_complaints, spam_complaint_rate
  - `value_statistics[]`: conversion_value (preferred)
  - `conversion_metric_id`: “Placed Order” metric id (resolved via GET `/api/metrics`)

Compatibility behavior:
- Some tenants reject `value_statistics`. We first try with `value_statistics=["conversion_value"]`. If a 400 mentions `value_statistics` being invalid, we retry once without `value_statistics` and include `conversion_value` inside `statistics` instead. This yields revenue in the response while keeping calls minimal.

## Timeframe logic (values window)

- Strict send-day mode: For each campaign, the timeframe is the single send day in the account’s timezone (startOfDay → endOfDay, capped at now). This minimizes call time and avoids very wide windows.
- Alternative: Single-call window around send time via `CAMPAIGN_VALUES_LEAD_DAYS`/`CAMPAIGN_VALUES_TAIL_DAYS` with an optional fallback window. Kept disabled for this tenant in favor of strict send day.

## Rate limiting strategy

- Endpoint-specific limiter for `campaign-values-reports` with steady rate set conservatively:
  - `KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE=2`
  - `KLAVIYO_LIMIT_CAMPAIGN_VALUES_BURST=1`
  - Enforced spacing: `CAMPAIGN_VALUES_MIN_DELAY_MS=30000` (30s)
- Retries kept low to avoid long stalls: max retries ≈ 3 for values calls.
- If the API returns `Retry-After` that exceeds our threshold, we skip the call and move on to prevent long blocking (logged as a skip).
- Global limiter left at default safe settings (`KLAVIYO_LIMIT_GLOBAL_PER_MINUTE=60`).

Diagnostics:
- Enable `KLAVIYO_LIMITER_DEBUG=true` and `KLAVIYO_DIAGNOSTICS_SUMMARY=true` to log per-endpoint counters (calls/ok/429/errors/avgLatency/lastStatus/retry-after) and per-call timing.

## Targeting campaigns (fast selection)

- Use the cached campaign list (TTL ~24h) to avoid re-fetch cost: `CAMPAIGN_USE_CAMPAIGN_LIST_CACHE=true` and `CAMPAIGN_CAMPAIGN_LIST_CACHE_TTL_MS=86400000`.
- Filter to sent campaigns within a recent horizon: `CAMPAIGN_ONLY_SENT=true`, `CAMPAIGN_MIN_SEND_WITHIN_DAYS=365` (tunable).
- Target by date:
  - Single day: `CAMPAIGN_TARGET_SEND_DATE=YYYY-MM-DD`
  - Inclusive range (preferred): `CAMPAIGN_TARGET_START_SEND_DATE=YYYY-MM-DD`, `CAMPAIGN_TARGET_END_SEND_DATE=YYYY-MM-DD`.
  - Range takes precedence over single day.
- Optional: skip resolved campaigns with persistent state (can be disabled with `CAMPAIGN_IGNORE_STATE=true`).

## Outputs

- CSV path (local): `email-metrics-cloud-tmp/campaigns-live.csv`
- JSON path (local): `email-metrics-cloud-tmp/campaigns-live.json` (upload disabled by default)
- Supabase upload:
  - Bucket: `campaign-staging`
  - Key prefix: `CAMPAIGN_UPLOAD_PREFIX` (e.g., `acc_canary_1`)

## Environment variables (common)

- KLAVIYO / auth
  - `KLAVIYO_API_KEY`
  - `ADMIN_JOB_SECRET`, Supabase keys (used for upload)

- Selection and behavior
  - `CAMPAIGN_LIMIT` — safety cap per run
  - `CAMPAIGN_IGNORE_STATE` — allow reprocessing
  - `CAMPAIGN_USE_CAMPAIGN_LIST_CACHE`, `CAMPAIGN_CAMPAIGN_LIST_CACHE_TTL_MS`
  - `CAMPAIGN_ONLY_SENT`, `CAMPAIGN_MIN_SEND_WITHIN_DAYS`
  - `CAMPAIGN_TARGET_SEND_DATE` or `CAMPAIGN_TARGET_START_SEND_DATE`/`CAMPAIGN_TARGET_END_SEND_DATE`
  - `CAMPAIGN_SKIP_AUDIENCE_NAMES` — true to skip list/segment lookups
  - `CAMPAIGN_SKIP_VALUES` — true to skip metrics (diagnostics only)

- Values timing/pacing
  - `CAMPAIGN_VALUES_STRICT_SEND_DAY` — set true (recommended for this tenant)
  - `CAMPAIGN_VALUES_SINGLE_CALL` — true when using lead/tail windows
  - `CAMPAIGN_VALUES_LEAD_DAYS`, `CAMPAIGN_VALUES_TAIL_DAYS`
  - `CAMPAIGN_VALUES_FALLBACK_LEAD_DAYS`, `CAMPAIGN_VALUES_FALLBACK_TAIL_DAYS`
  - `CAMPAIGN_VALUES_MIN_DELAY_MS` — min spacing between values calls

- Limiters
  - `KLAVIYO_LIMIT_CAMPAIGN_VALUES_BURST`, `KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE`
  - `KLAVIYO_LIMIT_GLOBAL_BURST`, `KLAVIYO_LIMIT_GLOBAL_PER_MINUTE`
  - `KLAVIYO_LIMITER_DEBUG`, `KLAVIYO_DIAGNOSTICS_SUMMARY`

- Uploads
  - `CAMPAIGN_UPLOAD_ONLY_ON_FINAL=true`
  - `CAMPAIGN_UPLOAD_PREFIX` (e.g., `acc_canary_1`)
  - `CAMPAIGN_UPLOAD_JSON=false` by default

## How to run

1. Ensure `.env.local` is configured (see variables above). For a range:
   ```bash
   CAMPAIGN_TARGET_START_SEND_DATE=2025-09-01
   CAMPAIGN_TARGET_END_SEND_DATE=2025-09-05
   CAMPAIGN_LIMIT=20
   CAMPAIGN_VALUES_STRICT_SEND_DAY=true
   KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE=2
   CAMPAIGN_VALUES_MIN_DELAY_MS=30000
   KLAVIYO_LIMITER_DEBUG=true
   KLAVIYO_DIAGNOSTICS_SUMMARY=true
   ```
2. Run the script:
   ```bash
   npm run campaigns:live
   ```
3. Confirm output:
   - Look for `[filter] ... matched X/Y` lines
   - Timing logs per campaign
   - Upload confirmation: `Uploaded to supabase://campaign-staging/<prefix>/campaigns-live.csv`

## Troubleshooting

- 400 mentioning `value_statistics` invalid
  - Expected for some tenants; we automatically retry without `value_statistics` and include `conversion_value` inside `statistics`. No action needed.

- Many 429s or long `Retry-After`
  - Lower `KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE` and/or increase `CAMPAIGN_VALUES_MIN_DELAY_MS`.
  - Keep `CAMPAIGN_VALUES_CONCURRENCY=1`.
  - Ensure strict send-day is enabled to minimize window size.

- Zero revenue
  - Ensure `conversion_metric_id` resolves: script uses `fetchMetricIds` to look up “Placed Order”. If the metric is missing, revenue will be 0.
  - Verify the campaign actually produced orders on the send day; widen window slightly if needed.

- Slow runs (~60s per campaign)
  - This is expected at 2/min with 30s spacing when a compatibility retry occurs (two calls per campaign). You can cautiously try `KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE=3` and `CAMPAIGN_VALUES_MIN_DELAY_MS=20000`, then monitor for 429s.

- Empty values response
  - By default, we do not fallback to Events (`CAMPAIGN_VALUES_EVENTS_FALLBACK=false`). To test data presence, temporarily enable it: `CAMPAIGN_VALUES_EVENTS_FALLBACK=true` (not recommended for production correctness).

## Example: 2025-09-01 → 2025-09-05 run

- Filters matched 2 campaigns.
- Both required compatibility retry; first completed in ~2.7s, second in ~63s (due to spacing and retry).
- CSV uploaded to `supabase://campaign-staging/acc_canary_1/campaigns-live.csv` with 2 rows.

## Acceptance criteria checklist

- Uses campaign-values endpoint for metrics and revenue.
- Honors strict rate limits with conservative pacing and short retry budget.
- Applies account-timezone date targeting (single day or range).
- Produces CSV in Supabase Storage with correct columns.
- Emits diagnostics for verification and future tuning.

## Orchestrator & Snapshot Ingest

- Campaign sync is one of three producers used to construct a snapshot for the dashboard:
  - `campaigns.csv` (this sync)
  - `flows.csv` (see Flow Sync Runbook)
  - `subscribers.csv` (see Audience Sync Runbook)
- The orchestrator writes all three files into the data ingest bucket (env: `DATA_INGEST_BUCKET`, fallback `PREAUTH_BUCKET`) under a common `uploadId`.
- It then creates a snapshot row and triggers `POST /api/snapshots/process`, which reads the three CSVs and populates `snapshot_series` and `snapshot_totals` for the dashboard.
- For nightly refresh, patch only a recent-day window in the snapshot (e.g., yesterday ±1) instead of re-fetching the full history; delete and re-insert series rows in-range, then recompute totals.
