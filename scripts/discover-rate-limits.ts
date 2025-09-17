import { globalRateLimitTracker } from '../lib/klaviyo/rateLimitTracker';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function probe(endpoint: string, opts: RequestInit) {
  const res = await fetch(`https://a.klaviyo.com${endpoint}`, opts);
  const hdr = res.headers as any as Headers;
  globalRateLimitTracker.updateFromResponse(endpoint, hdr);
  console.log(`\n[${endpoint}]`);
  console.log('X-RateLimit-Tier:', res.headers.get('X-RateLimit-Tier'));
  console.log('X-RateLimit-Limit:', res.headers.get('X-RateLimit-Limit'));
  console.log('X-RateLimit-Remaining:', res.headers.get('X-RateLimit-Remaining'));
  console.log('X-RateLimit-Reset:', res.headers.get('X-RateLimit-Reset'));
  console.log('Retry-After:', res.headers.get('Retry-After'));
  console.log('RateLimit-Limit:', res.headers.get('RateLimit-Limit'));
  console.log('RateLimit-Remaining:', res.headers.get('RateLimit-Remaining'));
  console.log('RateLimit-Reset:', res.headers.get('RateLimit-Reset'));
  // Print all headers (debug)
  // @ts-ignore
  for (const [k, v] of (res.headers as any)) {
    if (/rate/i.test(k)) {
      console.log(`${k}: ${v}`);
    }
  }
}

async function main() {
  // Load .env.local similar to our runner
  try {
    const content = readFileSync(resolve('.env.local'), 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) throw new Error('KLAVIYO_API_KEY missing');
  const headers: Record<string, string> = {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'Accept': 'application/json',
  'Content-Type': 'application/json',
  'revision': process.env.KLAVIYO_API_REVISION || '2024-10-15',
  };
  const endpoints = [
    { name: 'accounts', method: 'GET', url: '/api/accounts' },
    { name: 'campaigns-list', method: 'GET', url: '/api/campaigns' },
    { name: 'campaign-values', method: 'POST', url: '/api/campaign-values-reports', body: JSON.stringify({ data: { type: 'campaign-values-report', attributes: { timeframe: { key: 'last_7_days' }, statistics: ['opens'], filter: 'equals(campaign_id,"test")' }}}) },
    { name: 'lists', method: 'GET', url: '/api/lists' },
    { name: 'segments', method: 'GET', url: '/api/segments' },
    { name: 'metrics', method: 'GET', url: '/api/metrics' },
  ];
  for (const ep of endpoints) {
    try {
      await probe(ep.url, { method: ep.method as any, headers, body: ep.body });
    } catch (e: any) {
      console.warn(`Probe failed for ${ep.name}:`, e?.message || String(e));
    }
    await sleep(2000);
  }
  globalRateLimitTracker.logStatus();
}

main().catch(err => { console.error(err); process.exit(1); });
