import { createClient } from '@supabase/supabase-js';

// Lazily create a browser Supabase client. If env vars are missing in dev,
// return a stub that throws a clear error when used, instead of crashing on import.
export const supabase = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
        if (process.env.NODE_ENV !== 'production') {
            const err = new Error(
                'Supabase env not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in cloud/.env.local, then restart the dev server.'
            );
            return new Proxy({}, {
                get() { throw err; }
            }) as any;
        }
        // In production, fail fast so misconfiguration is visible
        throw new Error('supabaseUrl is required.');
    }

    // Enable new Storage hostname to support large uploads (>50MB). Some older
    // versions may not have typed options; cast options to any to avoid TS noise.
    return createClient(url, anon, ({ storage: { useNewHostname: true } } as unknown) as any);
})();
