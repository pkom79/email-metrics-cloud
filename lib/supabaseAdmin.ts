import { createClient } from '@supabase/supabase-js';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Order matters (first is preferred)
export const CSV_BUCKETS = ['uploads', 'csv-uploads'] as const;
export type CsvBucket = typeof CSV_BUCKETS[number];

// Canonical filenames the UI asks for
export const ALLOWED_FILES = ['campaigns.csv', 'flows.csv', 'subscribers.csv'] as const;
export type AllowedFile = typeof ALLOWED_FILES[number];

export function sanitizeFileParam(raw: string | null): AllowedFile | null {
  if (!raw) return null;
  const lowered = raw.trim().toLowerCase();
  return (ALLOWED_FILES as readonly string[]).includes(lowered as AllowedFile)
    ? (lowered as AllowedFile)
    : null;
}

// Keywords per canonical file to allow fuzzy detection
export const KEYWORDS: Record<AllowedFile, string[]> = {
  'campaigns.csv': ['campaign', 'send', 'blast'],
  'flows.csv': ['flow', 'automation', 'sequence'],
  'subscribers.csv': ['subscriber', 'list', 'contact', 'people'],
};

