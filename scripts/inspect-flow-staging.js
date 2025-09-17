#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error('Missing Supabase env');
    process.exit(1);
}
const c = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
(async () => {
    const prefix = 'flow-staging/acc_canary_1';
    const { data: top, error: topErr } = await c.storage.from('flow-staging').list(prefix);
    console.log('TOP_LIST', { topErr, top });
    if (top) {
        for (const folder of top) {
            if (folder.name.includes('2025-09-15')) {
                const dir = `${prefix}/${folder.name}`;
                const { data: fileList, error: listErr } = await c.storage.from('flow-staging').list(dir);
                console.log('DIR_LIST', { dir, listErr, fileList });
                const { data: dl, error: dlErr } = await c.storage.from('flow-staging').download(dir + '/flows.csv');
                console.log('DOWNLOAD', { dlErr, size: dl ? dl.size : 0 });
                if (dl) {
                    const text = await dl.text();
                    console.log('FIRST_LINES\n' + text.split(/\n/).slice(0, 6).join('\n'));
                }
            }
        }
    }
})();
