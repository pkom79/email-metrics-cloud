import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false, // stop noisy refresh_token calls in logs
    },
    global: {
      headers: { 'X-Client-Info': 'shared-api/locator-debug' },
    },
  }
)

// buckets we’ll check, in order
export const CSV_BUCKETS = ['uploads', 'csv-uploads'] as const;
export type CsvBucket = typeof CSV_BUCKETS[number];

// only these files are allowed to be requested
export const ALLOWED_FILES = ['campaigns.csv', 'flows.csv', 'subscribers.csv'] as const;
export type AllowedFile = typeof ALLOWED_FILES[number];

export function sanitizeFileParam(raw: string | null): AllowedFile | null {
  if (!raw) return null;
  const lowered = raw.trim().toLowerCase();
  const ok = (ALLOWED_FILES as readonly string[]).find(f => f === lowered);
  return (ok as AllowedFile) ?? null;
}

