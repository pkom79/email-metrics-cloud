import { NextRequest } from 'next/server';
import { fetchFlows } from '../../../../lib/klaviyo/client';

const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;

export async function GET(req: NextRequest) {
  try {
    if (process.env.KLAVIYO_ENABLE !== 'true') {
      return new Response(JSON.stringify({ error: 'Klaviyo source disabled' }), { status: 501 });
    }
    const providedSecret = req.headers.get('x-admin-job-secret') || '';
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    
    const { searchParams } = new URL(req.url);
    const apiKey = searchParams.get('klaviyoApiKey') || process.env.KLAVIYO_API_KEY;
    const pageSize = Number(searchParams.get('pageSize') || '50');
    const maxPages = Number(searchParams.get('maxPages') || '10');
    const revision = searchParams.get('revision') || process.env.KLAVIYO_API_REVISION || '2024-06-15';
    
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing klaviyoApiKey' }), { status: 400 });
    }

    const flows = await fetchFlows(apiKey, { pageSize, maxPages, revision });
    
    const payload = {
      ok: true,
      count: flows.length,
      flows: flows.map(flow => ({
        id: flow.id,
        name: flow.attributes?.name || 'Untitled Flow',
        status: flow.attributes?.status || 'unknown',
        created: flow.attributes?.created,
        updated: flow.attributes?.updated,
        trigger_type: flow.attributes?.trigger_type,
        archived: flow.attributes?.archived || false,
      }))
    };
    
    return new Response(JSON.stringify(payload), { 
      status: 200, 
      headers: { 'content-type': 'application/json' } 
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Unexpected error', details: String(err?.message || err) }), 
      { status: 500 }
    );
  }
}