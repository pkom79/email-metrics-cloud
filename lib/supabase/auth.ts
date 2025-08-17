import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export function getServerSupabase(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
        throw new Error('Supabase env not set. Define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }
    return createServerComponentClient({ cookies });
}

export async function getServerUser(): Promise<User | null> {
    const supabase = getServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
}
