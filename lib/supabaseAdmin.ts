import { createClient } from '@supabase/supabase-js';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Preferred order when probing buckets for canonical CSVs
export const CSV_BUCKETS = ['uploads', 'csv-uploads'] as const;
export type CsvBucket = typeof CSV_BUCKETS[number];

// (Legacy sharing helpers removed – new snapshot approach does not expose per-file CSV fetching)

