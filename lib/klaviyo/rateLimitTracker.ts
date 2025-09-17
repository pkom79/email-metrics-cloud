type Tier = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'UNKNOWN';

const KLAVIYO_RATE_TIERS: Record<Tier, { burst: number; steady: number; perHour: number }> = {
  XS: { burst: 1, steady: 15, perHour: 900 },
  S: { burst: 10, steady: 150, perHour: 9000 },
  M: { burst: 10, steady: 150, perHour: 9000 },
  L: { burst: 75, steady: 700, perHour: 42000 },
  XL: { burst: 350, steady: 3500, perHour: 210000 },
  UNKNOWN: { burst: 1, steady: 15, perHour: 900 },
};

export type RateLimitInfo = {
  tier: Tier;
  limit?: number;
  remaining?: number;
  reset?: Date;
  discovered: Date;
};

export class RateLimitTracker {
  private limits = new Map<string, RateLimitInfo>();

  updateFromResponse(endpoint: string, headers: Headers) {
    let tier = (headers.get('X-RateLimit-Tier') || headers.get('x-ratelimit-tier') || '').toUpperCase() as Tier;
    // Support both legacy X-RateLimit-* and RFC RateLimit-* headers
    const limitRaw = headers.get('RateLimit-Limit') || headers.get('ratelimit-limit') || headers.get('X-RateLimit-Limit') || headers.get('x-ratelimit-limit') || '';
    const remainingRaw = headers.get('RateLimit-Remaining') || headers.get('ratelimit-remaining') || headers.get('X-RateLimit-Remaining') || headers.get('x-ratelimit-remaining') || '';
    const resetRaw = headers.get('RateLimit-Reset') || headers.get('ratelimit-reset') || headers.get('X-RateLimit-Reset') || headers.get('x-ratelimit-reset') || '';
    if (!tier) {
      if (/\b15\b/.test(limitRaw)) tier = 'XS';
      else if (/\b150\b/.test(limitRaw)) tier = 'S';
      else if (/\b700\b/.test(limitRaw)) tier = 'L';
      else tier = 'UNKNOWN';
    }
    const info: RateLimitInfo = {
      tier,
      limit: Number(limitRaw) || undefined,
      remaining: Number(remainingRaw) || undefined,
      reset: resetRaw ? new Date(Number(resetRaw) * 1000) : undefined,
      discovered: new Date(),
    };
    this.limits.set(endpoint, info);
    return info;
  }

  getDelayForEndpoint(endpoint: string) {
    const info = this.limits.get(endpoint);
    if (!info) return 0;
    const t = KLAVIYO_RATE_TIERS[info.tier] || KLAVIYO_RATE_TIERS.UNKNOWN;
    // Minimum delay to respect burst limit
    return Math.ceil(1000 / Math.max(1, t.burst));
  }

  logStatus() {
    console.log('\n=== Discovered Rate Limits ===');
    for (const [ep, info] of this.limits.entries()) {
      console.log(`${ep}: tier=${info.tier} limit=${info.limit ?? '?'} remaining=${info.remaining ?? '?'} reset=${info.reset?.toISOString() ?? '?'} @ ${info.discovered.toISOString()}`);
    }
  }
}

export const globalRateLimitTracker = new RateLimitTracker();
