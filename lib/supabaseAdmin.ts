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

// Buckets we’ll search in order
export const CSV_BUCKETS = ['csv-uploads', 'uploads'] as const

