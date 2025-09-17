function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
import { globalRateLimitTracker } from './rateLimitTracker';

// Diagnostics toggles
const LIMITER_DEBUG = process.env.KLAVIYO_LIMITER_DEBUG === 'true';
const DIAG_SUMMARY = process.env.KLAVIYO_DIAGNOSTICS_SUMMARY === 'true';

type EndpointDiagnostics = {
  calls: number;
  ok: number;
  s429: number;
  errors: number;
  totalLatencyMs: number;
  lastStatus?: number;
  lastRetryAfter?: number;
};

const diagnostics = new Map<string, EndpointDiagnostics>();

function ensureDiag(endpointKey: string) {
  if (!diagnostics.has(endpointKey)) diagnostics.set(endpointKey, { calls: 0, ok: 0, s429: 0, errors: 0, totalLatencyMs: 0 });
}

function header(headers: Headers, name: string): string | undefined {
  return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || undefined;
}

export class EndpointLimiter {
  private inFlight = 0;
  private history: number[] = [];
  private pausedUntil = 0;
  private lastStart = 0;
  constructor(private burst = 10, private perMinute = 150, private minIntervalMs = 0) {}
  setConfig(cfg: { burst?: number; perMinute?: number; minIntervalMs?: number }) {
    if (cfg.burst && cfg.burst > 0) this.burst = cfg.burst;
    if (cfg.perMinute && cfg.perMinute > 0) this.perMinute = cfg.perMinute;
    if (cfg.minIntervalMs && cfg.minIntervalMs >= 0) this.minIntervalMs = cfg.minIntervalMs;
  }

  private now() { return Date.now(); }

  async acquire() {
    while (true) {
      const now = this.now();
      this.history = this.history.filter(t => now - t < 60_000);
      if (now < this.pausedUntil) {
        await sleep(this.pausedUntil - now);
        continue;
      }
      // Enforce minimum interval between starts (burst spacing)
      if (this.minIntervalMs > 0) {
        const since = now - this.lastStart;
        if (since < this.minIntervalMs) {
          await sleep(this.minIntervalMs - since);
          continue;
        }
      }
      if (this.inFlight < this.burst && this.history.length < this.perMinute) {
        this.inFlight++;
        this.history.push(now);
        this.lastStart = now;
        return;
      }
      await sleep(100);
    }
  }

  release() {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  pauseFor(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }
}

// Optional global limiter + env-configurable overrides
function envInt(name: string, fallback?: number): number | undefined {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// If defined, all requests coordinated via this limiter in addition to per-endpoint
export const globalLimiter: EndpointLimiter | undefined = (() => {
  const perMinute = envInt('KLAVIYO_LIMIT_GLOBAL_PER_MINUTE');
  const burst = envInt('KLAVIYO_LIMIT_GLOBAL_BURST');
  if (perMinute || burst) {
    return new EndpointLimiter(burst ?? 5, perMinute ?? 60);
  }
  return undefined;
})();

function parseRetryAfterSeconds(text?: string | null) {
  if (!text) return undefined;
  const matches = text.match(/\d+/g);
  if (!matches) return undefined;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function parseRetryAfter(response: Response): Promise<number | undefined> {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  try {
    const clone = response.clone();
    const data = await clone.json();
    const detail = data?.errors?.[0]?.detail;
    return parseRetryAfterSeconds(detail);
  } catch {
    try {
      const text = await response.clone().text();
      return parseRetryAfterSeconds(text);
    } catch {
      return undefined;
    }
  }
}

export async function executeWithLimiter(
  limiter: EndpointLimiter,
  requestFn: () => Promise<Response>,
  context: string,
  maxRetries = 30,
  opts?: { maxRetryAfterSeconds?: number }
): Promise<Response> {
  const endpointKey = (context || '').split(' ')[0] || 'unknown';
  ensureDiag(endpointKey);
  function parseRateLimitLimitsFromHeaders(headers: Headers): { burstPerSec?: number; perMinute?: number } {
    // Prefer RFC RateLimit-Limit; fall back to X-RateLimit-Limit
    const raw = headers.get('RateLimit-Limit') || headers.get('ratelimit-limit') || headers.get('X-RateLimit-Limit') || headers.get('x-ratelimit-limit') || '';
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    let burstPerSec: number | undefined;
    let perMinute: number | undefined;
    for (const p of parts) {
      // Expect forms like "1;w=1" or "150;w=60"
      const m = p.match(/(\d+)\s*(?:;\s*w\s*=\s*(\d+))?/i);
      if (!m) continue;
      const limit = Number(m[1]);
      const win = m[2] ? Number(m[2]) : undefined;
      if (win === 1) {
        burstPerSec = Math.min(burstPerSec ?? limit, limit);
      } else if (win === 60) {
        perMinute = Math.min(perMinute ?? limit, limit);
      }
    }
    return { burstPerSec, perMinute };
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Acquire both global and endpoint limiters (if global configured)
    if (globalLimiter) await globalLimiter.acquire();
    await limiter.acquire();
    try {
      const t0 = Date.now();
      const res = await requestFn();
      const elapsed = Date.now() - t0;
      const info = diagnostics.get(endpointKey)!;
      info.calls += 1;
      info.totalLatencyMs += elapsed;
      info.lastStatus = res.status;
      // Update dynamic rate limit tracker if available and align limiter config
      try {
        globalRateLimitTracker.updateFromResponse(endpointKey, res.headers as any);
        const parsed = parseRateLimitLimitsFromHeaders(res.headers as any);
        if (parsed.burstPerSec || parsed.perMinute) {
          const minIv = parsed.burstPerSec ? Math.ceil(1000 / Math.max(1, parsed.burstPerSec)) : undefined;
          limiter.setConfig({ burst: parsed.burstPerSec, perMinute: parsed.perMinute, minIntervalMs: minIv });
        }
        const delay = globalRateLimitTracker.getDelayForEndpoint(endpointKey);
        if (delay > 0) await sleep(delay);
      } catch {}
      if (res.status === 429) {
        const seconds = await parseRetryAfter(res);
        info.s429 += 1;
        info.lastRetryAfter = seconds;
        if (opts?.maxRetryAfterSeconds && seconds && seconds > opts.maxRetryAfterSeconds) {
          // Too long to wait; bubble up so caller can skip/handle
          const err: any = new Error(`[limiter] ${context}: retry-after=${seconds}s exceeds threshold ${opts.maxRetryAfterSeconds}s`);
          err.code = 'RETRY_AFTER_TOO_LONG';
          throw err;
        }
        const delay = seconds ? seconds * 1000 : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
        // lightweight diagnostics for understanding slowness
        console.warn(`[limiter] 429 received for ${context}; retry-after=${seconds ?? 'n/a'}s; delaying ${Math.round(delay)}ms`);
        limiter.pauseFor(delay);
        if (globalLimiter) globalLimiter.pauseFor(delay);
        await sleep(delay);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
        await sleep(delay);
        continue;
      }
      if (res.ok) info.ok += 1; else info.errors += 1;
      if (LIMITER_DEBUG) {
        const rl = header(res.headers as any, 'RateLimit-Limit') || header(res.headers as any, 'X-RateLimit-Limit');
        const rs = header(res.headers as any, 'RateLimit-Remaining') || header(res.headers as any, 'X-RateLimit-Remaining');
        const rr = header(res.headers as any, 'Retry-After');
        console.log(`[limiter] ${context} -> ${res.status} in ${elapsed}ms; limits=${rl || 'n/a'} remaining=${rs || 'n/a'} retry-after=${rr || 'n/a'}`);
      }
      return res;
    } catch (err) {
      if (attempt >= maxRetries - 1) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
      await sleep(delay);
    } finally {
      limiter.release();
      if (globalLimiter) globalLimiter.release();
    }
  }
  throw new Error(`Max retries exceeded for ${context}`);
}

// Print diagnostics summary on process exit if enabled
if (DIAG_SUMMARY) {
  const print = () => {
    try {
      const summary: any = {};
      for (const [key, d] of diagnostics) {
        summary[key] = {
          calls: d.calls,
          ok: d.ok,
          s429: d.s429,
          errors: d.errors,
          avgLatencyMs: d.calls ? Math.round(d.totalLatencyMs / d.calls) : 0,
          lastStatus: d.lastStatus,
          lastRetryAfter: d.lastRetryAfter,
        };
      }
      if (Object.keys(summary).length) {
        console.log('[limiter] summary', summary);
      }
    } catch {}
  };
  process.once('beforeExit', print);
  process.once('exit', print);
}

// Endpoint limiters with env overrides (safe defaults preserved)
export const campaignsLimiter = new EndpointLimiter(
  envInt('KLAVIYO_LIMIT_CAMPAIGNS_BURST', 5)!,
  envInt('KLAVIYO_LIMIT_CAMPAIGNS_PER_MINUTE', 60)!
);
export const campaignMessagesLimiter = new EndpointLimiter(
  envInt('KLAVIYO_LIMIT_CAMPAIGN_MESSAGES_BURST', 5)!,
  envInt('KLAVIYO_LIMIT_CAMPAIGN_MESSAGES_PER_MINUTE', 60)!
);
export const campaignTagsLimiter = new EndpointLimiter(
  envInt('KLAVIYO_LIMIT_CAMPAIGN_TAGS_BURST', 5)!,
  envInt('KLAVIYO_LIMIT_CAMPAIGN_TAGS_PER_MINUTE', 60)!
);
export const listsLimiter = new EndpointLimiter(
  envInt('KLAVIYO_LIMIT_LISTS_BURST', 5)!,
  envInt('KLAVIYO_LIMIT_LISTS_PER_MINUTE', 60)!
);
export const campaignValuesLimiter = new EndpointLimiter(
  envInt('KLAVIYO_LIMIT_CAMPAIGN_VALUES_BURST', 1)!,
  envInt('KLAVIYO_LIMIT_CAMPAIGN_VALUES_PER_MINUTE', 15)!,
  envInt('CAMPAIGN_VALUES_MIN_DELAY_MS', 1100)!
);
export const segmentsLimiter = new EndpointLimiter(
  envInt('KLAVIYO_LIMIT_SEGMENTS_BURST', 5)!,
  envInt('KLAVIYO_LIMIT_SEGMENTS_PER_MINUTE', 60)!
);
