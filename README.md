# email-metrics-cloud

Next.js 14 + Supabase application for email marketing analytics with automated data processing and cleanup.

## Runbooks

- (none at the moment)

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

# Stripe Billing
STRIPE_SECRET_KEY=your_stripe_secret
STRIPE_WEBHOOK_SECRET=whsec_from_stripe
STRIPE_MONTHLY_PRICE_ID=price_monthly
STRIPE_ANNUAL_PRICE_ID=price_annual
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_or_live
NEXT_PUBLIC_APP_URL=https://emailmetrics.io
STRIPE_PORTAL_CONFIGURATION_ID=bpc_xxxxx
```

### Account Model

Each user owns exactly one account. All dashboard data, uploads, and notifications are scoped to that account. Global Admins can switch between accounts for support and auditing.

- Owner accounts live in `public.accounts` (`owner_user_id` column).
- Global Admins are resolved by `public.is_admin()` (JWT `role=admin` or `app_admins` table).
- Notifications: Postmark outbox processed by `/api/cron/notifications` (Vercel Cron every minute).
- Storage: Private ingest bucket (default `preauth-uploads`) with RLS aligned to `public.accounts.owner_user_id`.

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
- **Cleanup**: `/api/cron/cleanup` is invoked by Vercel Cron (GET). It triggers the secured master cleanup.

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

### CSV-Only Ingestion
The app ingests data exclusively from user-provided CSV exports and processes them into snapshots for analysis. Upload all three files (campaigns.csv, flows.csv, subscribers.csv) via the upload wizard.


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
