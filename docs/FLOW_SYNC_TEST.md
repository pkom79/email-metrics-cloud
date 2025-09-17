# Flow Sync Staging Endpoint

This document explains how to exercise the flow staging sync endpoint that writes a `flows.csv` file into the dedicated flow staging bucket for safe inspection without impacting core ingestion / snapshots.

## Route
`POST /api/klaviyo/flow-sync`

## Auth
Send header: `x-admin-job-secret: <ADMIN_JOB_SECRET>`
Klaviyo must be enabled: `KLAVIYO_ENABLE=true`.

## Modes
- `dry-run` (default): Gathers data, returns JSON (or CSV if `format: "csv"`) directly. Does NOT write to storage.
- `live`: Writes `flows.csv` to the flow staging bucket at:
  `flow-staging/<accountId>/<uploadId>/flows.csv`
  (Bucket name comes from `FLOW_STAGING_BUCKET`).

## Request Body Fields
| Field | Type | Default | Notes |
|-------|------|---------|-------|
| mode | `"dry-run" | "live"` | `dry-run` | Live writes CSV to storage. |
| format | `"json" | "csv"` | `json` | Only used in dry-run. |
| accountId | string | required for live | Partition key portion of path. |
| uploadId | string | auto timestamp | Optional custom path segment for repeatability. |
| klaviyoApiKey | string | env fallback | Provide to override configured env key. |
| days | number | 7 | Convenience for date window (max 30). Mutually exclusive with `start/end`. |
| start | YYYY-MM-DD | derived | Inclusive start date. |
| end | YYYY-MM-DD | today | Inclusive end date. |
| limitFlows | number | 25 | Max flows to pull (1-100). |
| limitMessages | number | 20 | Max messages per flow (1-100). |
| allowFallback | boolean | true | If false, rows without flow-report metrics are skipped instead of synthetic. |

If both `days` and `start`/`end` are supplied the explicit `start`/`end` wins.

## Output Schema (flows.csv)
Headers exactly (order preserved):
```
Day,Flow ID,Flow Name,Flow Message ID,Flow Message Name,Flow Message Channel,Status,Delivered,Unique Opens,Open Rate,Unique Clicks,Click Rate,Placed Order,Placed Order Rate,Revenue,Revenue per Recipient,Unsub Rate,Complaint Rate,Bounce Rate,Tags
```
Matches existing flow ingestion expectations.

## Synthetic Fallback
If the real `flow-report` endpoint returns null for a (flow, message, day) the service deterministically seeds pseudo-random performance metrics so trend analysis is still possible. Disable with `allowFallback: false`.

## Example Dry Run
```
curl -X POST http://localhost:3000/api/klaviyo/flow-sync \
  -H 'content-type: application/json' \
  -H 'x-admin-job-secret: $ADMIN_JOB_SECRET' \
  -d '{
    "mode": "dry-run",
    "days": 2,
    "limitFlows": 3,
    "limitMessages": 2
  }'
```

## Example Live Write
```
curl -X POST http://localhost:3000/api/klaviyo/flow-sync \
  -H 'content-type: application/json' \
  -H 'x-admin-job-secret: $ADMIN_JOB_SECRET' \
  -d '{
    "mode": "live",
    "accountId": "acc_canary_1",
    "days": 2,
    "limitFlows": 10,
    "limitMessages": 5
  }'
```
Response JSON will include the bucket + path:
```
{
  "mode": "live",
  "wrote": { "bucket": "<FLOW_STAGING_BUCKET>", "path": "flow-staging/acc_canary_1/2024-09-15T12-00-00-000Z/flows.csv" },
  "rows": 120,
  "fallback": true,
  "ms": 2450
}
```

## Safety Caps
- Max days: 30
- Max flows: 100 (default limit applied earlier to 25 to keep payload small)
- Max messages per flow: 100 (default 20)
- Row budget: 50,000 rows (request rejected if exceeded)

## Error Modes
| Status | Meaning |
|--------|---------|
| 400 | Validation problem (date order, range too large, missing accountId in live) |
| 401 | Admin secret mismatch |
| 415 | Wrong Content-Type |
| 500 | Unexpected internal error or Supabase upload failure |
| 501 | Klaviyo disabled environment |

## Operational Notes
- Use the companion setup endpoint `/api/setup-storage/flow-staging` first to create the bucket.
- This flow staging path intentionally does not trigger snapshot ingestion; manual follow-up processing can read the CSV if desired.
- `uploadId` is optional; omit to auto-generate a timestamp slug.

## Next Steps / Ideas
- Add optional `flowIds` filter list.
- Parallelize per-day requests with AbortController for larger windows.
- Add secondary summary sheet (aggregates by flow) to assist QA.
