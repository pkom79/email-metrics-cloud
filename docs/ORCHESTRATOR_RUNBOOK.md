# Nightly Orchestrator Runbook

This orchestrates Klaviyo data syncs (flows, campaigns, audience), writes CSVs to the ingest bucket, and triggers snapshot processing.

## Endpoint

- Path: `/api/dashboard/update`
- Methods:
  - POST: primary logic (internal use)
  - GET: cron-friendly wrapper (externally callable by Vercel Cron)
- Runtime: nodejs (Fluid Compute enabled)

## Auth & Security

- Requires `ADMIN_JOB_SECRET`.
  - POST: provide via header `x-admin-job-secret`.
  - GET: provide via query `token=...`.
- For live runs, `accountId` is required.
- Idempotency: set with header `x-idempotency-key` (POST) or query `idempotency=...` (GET). Default for GET is `nightly-YYYY-MM-DD` (UTC).

## Modes

- `mode=dry-run`: fetches CSVs but does not write to storage. Returns JSON with row counts and CSV previews.
- `mode=live`: writes `flows.csv`, `campaigns.csv`, `subscribers.csv` to ingest bucket under an `uploadId`, creates a `snapshots` row, and triggers `/api/snapshots/process`.

## GET query params (selected)

- `mode`: `dry-run` | `live` (default `live` for GET)
- `token`: admin secret (required)
- `accountId`: required when `mode=live`
- `days`: number of days (1..30), used by flow-sync
- `timeframeKey`: campaign timeframe, e.g. `last_7_days`, `last_30_days`
- `fast=1`: validation mode. Applies tight limits and skips heavy producers in dry-run:
  - flow: `limitFlows=1`, `limitMessages=1`, `enrichMessageNames=false`
  - audience: `maxPages=0` (header only)
  - campaign/audience: skipped in dry-run (still returns headers)

## Success criteria

- Dry-run: HTTP 200 with JSON like:
  - `rows.flows > 0`, `rows.campaigns >= 0`, `rows.subscribers >= 0`
  - `previews.*` show the CSV headers and first line(s)
- Live: HTTP 200 with JSON including `{ accountId, uploadId, snapshotId }` and keys written.

## Cron (Production)

Configured in `vercel.json`:

- Cleanup: `0 2 * * *` → `/api/cleanup`
- Nightly orchestrator: `5 3 * * *` → `/api/dashboard/update?...` (GET-only)

Note: Vercel registers crons only on Production deployments.

## Troubleshooting

- 401 Unauthorized:
  - Ensure token/header equals `ADMIN_JOB_SECRET` in the environment.
- 501 Klaviyo source disabled:
  - Set `KLAVIYO_ENABLE=true` and redeploy.
- 400 Missing klaviyoApiKey:
  - Provide `klaviyoApiKey` or set `KLAVIYO_API_KEY_PRIVATE` (preferred) / `KLAVIYO_API_KEY` in env.
- 502 Flow/Campaign/Audience sync failed:
  - Check `details` in JSON for upstream errors or throttling (HTTP 429). Consider:
    - Narrowing `days` or `timeframeKey` (e.g., `last_7_days`)
    - Running in off-peak hours
    - Using dry-run or `fast=1` for smoke checks
- Timeouts:
  - Fluid Compute is enabled and `maxDuration=800` for long-running routes. If still timing out under heavy throttling, reduce workload.

## Manual checks after live run

- Storage (Supabase): ingest bucket → folder `{uploadId}` containing `flows.csv`, `campaigns.csv`, `subscribers.csv`.
- Database:
  - `uploads`: row for `{uploadId}` bound to `account_id`
  - `snapshots`: new row linked to `upload_id`; processing moves status forward
- Processing: `/api/snapshots/process` should be invoked; check logs or derived tables.

## Examples (replace placeholders)

- Dry-run validation (fast):
  - GET `/api/dashboard/update?mode=dry-run&fast=1&days=7&token=***`
- Live (narrow window):
  - GET `/api/dashboard/update?mode=live&accountId=<account-id>&days=7&timeframeKey=last_7_days&token=***`

## Notes

- The GET handler forwards to POST internally to keep logic centralized.
- In dry-run + fast mode, campaign and audience producers are skipped for speed; CSV headers are still returned.
