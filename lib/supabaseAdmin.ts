import { createClient } from '@supabase/supabase-js';

const hasAdminEnv = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Export a build-safe admin client. If env vars are missing (e.g., in CI or local
// static builds), expose a proxy that throws only when actually used.
export const supabaseAdmin = hasAdminEnv()
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : (new Proxy({}, {
      get() {
        throw new Error('Supabase admin env not set. Define NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
      }
    }) as any);

// Preferred order when probing buckets for canonical CSVs
export const CSV_BUCKETS = ['uploads', 'csv-uploads', 'preauth-uploads'] as const;
export type CsvBucket = typeof CSV_BUCKETS[number];

// (Legacy sharing helpers removed – new snapshot approach does not expose per-file CSV fetching)

