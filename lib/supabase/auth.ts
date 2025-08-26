import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export function getServerSupabase(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // During static generation (or misconfiguration), we may be missing env vars.
    // Instead of throwing (which breaks the entire build), return a proxy client
    // that will throw only if actually used. This lets purely static pages build.
    if (!url || !anon) {
        const err = new Error('Supabase env not set. Define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        return new Proxy({}, { get() { throw err; } }) as unknown as SupabaseClient;
    }
    return createServerComponentClient({ cookies });
}

export async function getServerUser(): Promise<User | null> {
    const supabase = getServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
}
