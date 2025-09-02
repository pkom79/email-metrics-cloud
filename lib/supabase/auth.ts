import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient, User } from '@supabase/supabase-js';
// The auth helper infers a union schema type; to avoid tight coupling to the
// generated Database types (not present here), relax the return type to any
// schema to satisfy TS without impacting runtime. Vercel build was failing
// due to a mismatch: GenericSchema vs "public" literal. Casting is safe for
// our usage (we only call auth + basic queries elsewhere with zod validation).

export function getServerSupabase(): SupabaseClient<any, any, any, any, any> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // During static generation (or misconfiguration), we may be missing env vars.
    // Instead of throwing (which breaks the entire build), return a proxy client
    // that will throw only if actually used. This lets purely static pages build.
    if (!url || !anon) {
        const err = new Error('Supabase env not set. Define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        return new Proxy({}, { get() { throw err; } }) as unknown as SupabaseClient;
    }
    // Cast to loose SupabaseClient shape to avoid schema generic mismatch
    return createServerComponentClient({ cookies }) as unknown as SupabaseClient<any, any, any, any, any>;
}

export async function getServerUser(): Promise<User | null> {
    const supabase = getServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
}
