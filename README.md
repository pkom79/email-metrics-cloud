# email-metrics-cloud (bootstrap)

Next.js 14 + Supabase skeleton for the hosted account module.

Setup
1. Copy `.env.local.example` to `.env.local` and fill values (see Email Metrics repo docs:
   - `docs/cloud-env.md`
   - `docs/sql/schema.sql`
   - `docs/sql/rls.sql`
2. `npm install`
3. `npm run dev`

Routes
- /(public)/upload/step-0 — pre-auth upload wizard (placeholder)
- /(public)/signup — account creation (placeholder)
- /(auth)/dashboard — snapshot picker (placeholder)
- /api/* — stubbed route handlers, return 501 for now

Region
- Deploy Vercel Functions in US East (iad1). Align Supabase project to US East.
