import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient, User } from '@supabase/supabase-js';
// The auth helper infers a union schema type; to avoid tight coupling to the
// generated Database types (not present here), relax the return type to any
// schema to satisfy TS without impacting runtime. Vercel build was failing
// due to a mismatch: GenericSchema vs "public" literal. Casting is safe for
// our usage (we only call auth + basic queries elsewhere with zod validation).

function hasSupabaseEnv() {
    return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function getServerSupabase(): SupabaseClient<any, any, any, any, any> | null {
    if (!hasSupabaseEnv()) return null;
    // Cast to loose SupabaseClient shape to avoid schema generic mismatch
    return createServerComponentClient({ cookies }) as unknown as SupabaseClient<any, any, any, any, any>;
}

export async function getServerUser(): Promise<User | null> {
    // If env is missing (e.g., during static generation), treat as unauthenticated
    const supabase = getServerSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
}
