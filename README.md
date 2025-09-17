# email-metrics-cloud

Next.js 14 + Supabase application for email marketing analytics with automated data processing and cleanup.

## Runbooks

- Campaign Sync: see `docs/CAMPAIGN_SYNC_RUNBOOK.md` for how we fetch Klaviyo campaign metrics under rate limits, how to run it, and troubleshooting tips.

## Setup

### Local Development
1. Copy `.env.local.example` to `.env.local` and fill values
2. `npm install`
3. `npm run dev`

### Environment Variables
```bash
# Required for production
MAX_UPLOADS_PER_ACCOUNT=1
DELETED_ACCOUNT_RETENTION_DAYS=30
# Preferred ingest bucket (fallback to PREAUTH_BUCKET if unset)
DATA_INGEST_BUCKET=preauth-uploads

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
SUPABASE_JWT_SECRET=your_jwt_secret
```

## Deployment (Vercel)

### Environment Variables Setup
1. Go to [Vercel Dashboard](https://vercel.com)
2. Select your `email-metrics-cloud` project
3. Navigate to **Settings** → **Environment Variables**
4. Add the following variables (set for Production, Preview, and Development):
   - `MAX_UPLOADS_PER_ACCOUNT = 1`
   - `DELETED_ACCOUNT_RETENTION_DAYS = 30`
   - `DATA_INGEST_BUCKET = preauth-uploads`

### Cron Job Setup (Vercel Cron Functions)
1. Create `vercel.json` in project root
2. Configure daily cleanup job at 2 AM UTC
3. Deploy changes to activate cron

See [Vercel Cron Documentation](https://vercel.com/docs/cron-jobs) for details.

## Data Management

### Automatic Cleanup System
- **Preauth uploads**: Removed after 24 hours if not linked to account
- **Active accounts**: Keep only most recent upload per account
- **Deleted accounts**: 30-day retention before permanent deletion
- **Cleanup endpoint**: `/api/cleanup` (runs via cron job)

### Manual Cleanup
```bash
# Test cleanup (GET request)
curl https://your-domain.com/api/cleanup

# Run cleanup (POST request, admin only)
curl -X POST https://your-domain.com/api/cleanup
```

## Routes
- `/(public)/upload/step-0` — Pre-auth upload wizard
- `/(public)/signup` — Account creation
- `/(auth)/dashboard` — Analytics dashboard
- `/api/cleanup` — Data cleanup endpoint
- `/api/auth/callback` — Enhanced email confirmation with upload linking
 - `/api/klaviyo/flow-analytics` — Flow performance aggregation (daily)

### Klaviyo Flow Analytics Endpoint
`GET /api/klaviyo/flow-analytics`

Admin-only (requires `x-admin-job-secret` header and `KLAVIYO_ENABLE=true`). Produces daily performance rows for Klaviyo flows & messages over a date range. The Klaviyo public API does not expose a native day-by-day flow message analytics feed; this endpoint composes data from the Flow Report endpoint where available and falls back to deterministic synthetic metrics when the upstream call is unsupported.

Query Params:
| Param | Example | Notes |
|-------|---------|-------|
| `klaviyoApiKey` | `pk_xxx` | Optional if `KLAVIYO_API_KEY` env set |
| `days` | `7` | Mutually exclusive with `start`/`end`; default 7; max 90 |
| `start` | `2025-09-01` | Inclusive start (YYYY-MM-DD) |
| `end` | `2025-09-07` | Inclusive end (YYYY-MM-DD) |
| `flowId` | `AbCdEf` | Filter to single flow |
| `maxFlows` | `25` | Safety cap; default 25; max 100 |
| `format` | `csv` or `json` | Default json |

Response (JSON):
```jsonc
{
   "ok": true,
   "count": 140,
   "days": 7,
   "flows": 12,
   "fallback": true,   // true if any synthetic rows were generated
   "rows": [
      {
         "day": "2025-09-14",
         "flowId": "AbCdEf",
         "flowName": "ec-abandoned_checkout",
         "flowMessageId": "AbCdEf_flow",
         "flowMessageName": "ec-abandoned_checkout",
         "channel": "Email",
         "status": "live",
         "delivered": 1234,
         "uniqueOpens": 890,
         "openRate": 0.72,
         "uniqueClicks": 110,
         "clickRate": 0.089,
         "placedOrders": 17,
         "placedOrderRate": 0.013,
         "revenue": 456.78,
         "revenuePerRecipient": 0.37,
         "unsubscribeRate": 0.005,
         "complaintRate": 0.0004,
         "bounceRate": 0.021
      }
   ]
}
```

CSV Columns (when `format=csv`):
`Day,Flow ID,Flow Name,Flow Message ID,Flow Message Name,Flow Message Channel,Status,Delivered,Unique Opens,Open Rate,Unique Clicks,Click Rate,Placed Order,Placed Order Rate,Revenue,Revenue per Recipient,Unsub Rate,Complaint Rate,Bounce Rate,Tags`

Fallback Behavior:
* The endpoint attempts per-day calls to Klaviyo `flow-report` with `statistics[]` & `valueStatistics[]`.
* If a call returns 4xx/5xx or null data, a deterministic synthetic row is generated (seeded by flow/message/day) so repeated requests are stable.
* `fallback: true` signals at least one synthetic row.

Rate / Safety Limits:
* Max 90 days per request.
* Max 100 flows (`maxFlows`).
* Flow messages fetched per flow; if the flow messages API fails, a single pseudo message aggregates the flow.

Auth Example:
```bash
curl -H "x-admin-job-secret: $ADMIN_JOB_SECRET" \
   "http://localhost:3000/api/klaviyo/flow-analytics?days=3&format=csv&klaviyoApiKey=$KLAVIYO_API_KEY" -o flow_analytics.csv
```

Use Cases:
* Populate snapshot seed data for flows performance.
* Generate CSV for manual inspection.
* Provide interim metrics until a native Klaviyo endpoint is exposed.

Limitations:
* Synthetic rows do not reflect real performance – they are placeholders where Klaviyo does not supply day-level stats.
* Revenue and order metrics rely on "Placed Order" metric availability; absence triggers zeros (or synthetic values if fallback).


## Architecture

### Data Flow
1. **Upload**: Files stored in the ingest bucket (default `preauth-uploads`) with 24h TTL
2. **Account Creation**: User signs up, email confirmation sent
3. **Email Confirmation**: Triggers upload linking via `/api/auth/callback`
4. **Data Processing**: CSVs processed into snapshots with metrics
5. **Dashboard**: Loads processed data from snapshots tables

### Database Tables
- `accounts` - User account metadata
- `uploads` - Upload tracking (preauth → bound → processed)
- `snapshots` - Immutable processed datasets
- `snapshot_totals` - Aggregated metrics per snapshot
- `snapshot_series` - Daily time series data

### Removed Features
The legacy public dashboard sharing feature (snapshot_shares table, `/shared/*` pages, share APIs) was removed on 2025-08-29.

Summary:
* All share-related API routes now return 410 Gone.
* Helper libs (`shareToken.ts`, `shareStaticBuilder.ts`) throw on import.
* UI sharing surface (ShareModal, shared pages) deleted.
* Migration `20250829000000_drop_snapshot_sharing.sql` drops `snapshot_shares` and related objects.

All former sharing code paths are inert or deleted. Reintroduction would require a fresh privacy & security review.

## Region
Deploy Vercel Functions in US East (iad1). Align Supabase project to US East.

---

**Stability Status (Aug 26 2025)**
- ✅ Desktop analytics dashboard stable and functional
- ✅ Enhanced auth flow with upload linking
- ✅ Comprehensive data cleanup system
- ⚠️ Mobile experience requires optimization (use desktop for full functionality)
