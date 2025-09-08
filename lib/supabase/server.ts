import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !service) {
        const err = new Error('Supabase service env not set. Define NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
        return new Proxy({}, { get() { throw err; } }) as any;
    }
    return createClient(url, service, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}
