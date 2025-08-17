import { createClient } from '@supabase/supabase-js';

// Lazily create a browser Supabase client. If env vars are missing, return a
// stub that throws a clear error when any property is accessed. This prevents
// crashes during build/prerender while still surfacing a helpful error at
// runtime if the client is actually used without configuration.
export const supabase = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
        const err = new Error(
            'Supabase env not set. Define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment (e.g. Vercel Project Settings → Environment Variables).'
        );
        return new Proxy({}, {
            get() { throw err; }
        }) as any;
    }

    // Enable new Storage hostname to support large uploads (>50MB). Some older
    // versions may not have typed options; cast options to any to avoid TS noise.
    return createClient(url, anon, ({ storage: { useNewHostname: true } } as unknown) as any);
})();
