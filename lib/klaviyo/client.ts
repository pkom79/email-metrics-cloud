import dayjs from '../dayjs';
import { campaignsLimiter, campaignMessagesLimiter, campaignTagsLimiter, listsLimiter, campaignValuesLimiter, segmentsLimiter, executeWithLimiter } from './limiters';

export interface KlaviyoApiProfileRaw {
  id: string;
  type?: string;
  attributes?: any;
}

export interface FetchProfilesOptions {
  pageSize?: number; // default 100
  maxPages?: number; // safety cap
  revision?: string; // Klaviyo API revision header
  // Optional sorting; useful to fetch most recent first
  sortBy?: string; // e.g., 'created', 'updated', 'id', 'email', 'subscriptions.email.marketing.suppression.timestamp'
  sortDir?: 'asc' | 'desc';
}

export interface SubscribedProfileMinimal {
  id: string;
  email: string;
  created?: string;
  first_name?: string | null;
  last_name?: string | null;
  updated?: string | null;
  phone_number?: string | null;
  locale?: string | null;
  last_event_date?: string | null;
  first_active?: string | null;
  last_open?: string | null;
  last_click?: string | null;
  external_id?: string | null;
  organization?: string | null;
  title?: string | null;
  image?: string | null;
  location?: any | null;
  subscriptions?: any | null;
  properties?: any | null;
  predictive_analytics?: any | null;
}

function isSuppressedOrUnsubscribed(attrs: any): boolean {
  if (!attrs) return false; // default to not suppressed when unknown
  // Explicit suppression indicators
  if (attrs?.email_suppressed === true) return true;
  const emailSub = attrs?.subscriptions?.email?.marketing || attrs?.subscriptions?.email || {};
  // Primary: can_receive_email_marketing=false => suppressed/unemailable
  if (emailSub?.can_receive_email_marketing === false) return true;
  // Primary: suppressions array has active suppression reasons
  const supArr = emailSub?.suppressions;
  if (Array.isArray(supArr) && supArr.length > 0) return true;
  const status = emailSub?.status || attrs?.email_marketing_consent || emailSub?.consent;
  if (typeof status === 'string') {
    const s = status.toUpperCase();
    // Treat unsubscribed/suppressed as suppressed; include NEVER_SUBSCRIBED (not suppressed)
    if (s === 'UNSUBSCRIBED' || s === 'SUPPRESSED') return true;
  }
  // Do NOT exclude based on can_email/emailable; requirement is "not suppressed", not "can email".
  return false;
}

function mapRawToMinimal(p: KlaviyoApiProfileRaw): SubscribedProfileMinimal | null {
  const a = p?.attributes || {};
  const email = a?.email || a?.$email || a?.profile?.email;
  if (!email) return null;
  if (isSuppressedOrUnsubscribed(a)) return null; // exclude suppressed/unsubscribed
  const props = a?.properties || {};
  const pickProp = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = props?.[k] ?? props?.[`$${k}`];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return null;
  };
  return {
    id: p.id,
    email,
    created: a?.created || a?.created_at || a?.profile_created || undefined,
    first_name: a?.first_name ?? a?.firstName ?? null,
    last_name: a?.last_name ?? a?.lastName ?? null,
    updated: a?.updated ?? null,
    phone_number: a?.phone_number ?? null,
    locale: a?.locale ?? null,
    last_event_date: a?.last_event_date ?? null,
    first_active: pickProp(['first_active', 'First Active', 'firstActive']),
    last_open: pickProp(['last_open', 'Last Open', 'lastOpen', 'last_opened', 'lastEmailOpen', 'last_open_at']),
    last_click: pickProp(['last_click', 'Last Click', 'lastClick', 'lastEmailClick', 'last_click_at']),
    external_id: a?.external_id ?? null,
    organization: a?.organization ?? null,
    title: a?.title ?? null,
    image: a?.image ?? null,
    location: a?.location ?? null,
    subscriptions: a?.subscriptions ?? null,
    properties: a?.properties ?? null,
    predictive_analytics: a?.predictive_analytics ?? null,
  };
}

export async function fetchAllSubscribedProfiles(apiKey: string, opts: FetchProfilesOptions = {}): Promise<SubscribedProfileMinimal[]> {
  // Klaviyo enforces page size between 1 and 100
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 100, 1), 1000); // hard safety cap
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';

  // Base URL for Klaviyo Profiles API (JSON:API). We ask for only the fields we need.
  const base = 'https://a.klaviyo.com/api/profiles';
  // Request valid fields per Klaviyo Profiles JSON:API
  const fieldList = [
    'email',
    'first_name',
    'last_name',
    'created',
    'updated',
    'last_event_date',
    'properties',
    'external_id',
    'phone_number',
    'locale',
    'location',
    'organization',
    'title',
    'image',
    'subscriptions',
    'predictive_analytics',
  ];
  const fields = `fields[profile]=${fieldList.join(',')}`;
  // No server-side filter: we include all and filter client-side to remove suppressed/unsubscribed.

  // Only supported values for additional-fields are 'predictive_analytics' and 'subscriptions'
  const additional = 'additional-fields[profile]=subscriptions,predictive_analytics';
  const sortParam = opts.sortBy ? `&sort=${opts.sortDir === 'asc' ? '' : '-'}${encodeURIComponent(opts.sortBy)}` : '';
  let url = `${base}?page[size]=${pageSize}&${fields}&${additional}${sortParam}`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };

  const results: SubscribedProfileMinimal[] = [];
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const data: KlaviyoApiProfileRaw[] = Array.isArray(json?.data) ? json.data : [];
    for (const raw of data) {
      const m = mapRawToMinimal(raw);
      if (m) results.push(m);
    }
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
  }
  return results;
}

// -------- Events enrichment (First Active, Last Open, Last Click) ---------

export interface FetchEventsOptions {
  pageSize?: number; // default 100
  maxPages?: number; // default 3
  revision?: string;
  sort?: 'asc' | 'desc'; // default 'desc'
}

interface EventItemRaw {
  id: string;
  type?: string;
  attributes?: { datetime?: string };
  relationships?: { metric?: { data?: { id?: string; type?: string } } };
}

interface IncludedMetricRaw { id: string; type?: string; attributes?: { name?: string } }
interface IncludedProfileRaw { id: string; type?: string; attributes?: { email?: string } }

async function fetchEventsForProfile(apiKey: string, profileId: string, opts: FetchEventsOptions = {}): Promise<{ time?: string; metricName?: string }[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 3, 1), 20);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = 'https://a.klaviyo.com/api/events';
  const fieldsEvent = 'fields[event]=datetime';
  const include = 'include=metric';
  const fieldsMetric = 'fields[metric]=name';
  const rawId = profileId;
  // Prefer profile_id filter; some workspaces use person_id historically—fallback if no results
  const sortParam = opts.sort === 'asc' ? 'sort=datetime' : 'sort=-datetime';
  const makeUrl = (filterExpr: string) => `${base}?${filterExpr}&${sortParam}&page[size]=${pageSize}&${fieldsEvent}&${include}&${fieldsMetric}`;
  let url = makeUrl(`filter=${encodeURIComponent(`equals(profile_id,"${rawId}")`)}`);
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const out: { time?: string; metricName?: string }[] = [];
  let pages = 0;
  let triedFallback = false;
  while (pages < maxPages && url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo events fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const count = Array.isArray(json?.data) ? json.data.length : 0;
    const included: IncludedMetricRaw[] = Array.isArray(json?.included) ? json.included : [];
    const metricsById = new Map<string, string>();
    for (const m of included) {
      const name = m?.attributes?.name;
      if (m?.id && name) metricsById.set(m.id, name);
    }
    const data: EventItemRaw[] = Array.isArray(json?.data) ? json.data : [];
    for (const ev of data) {
      const metricId = ev?.relationships?.metric?.data?.id;
      const metricName = metricId ? metricsById.get(metricId) : undefined;
  out.push({ time: (ev as any)?.attributes?.datetime, metricName });
    }
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
    // If first page had zero results for profile_id, try person_id fallback once
    if (pages === 1 && count === 0 && !triedFallback) {
      triedFallback = true;
  url = makeUrl(`filter=${encodeURIComponent(`equals(person_id,"${rawId}")`)}`);
      pages = 0; // restart paging for fallback
    }
  }
  return out;
}

export async function fetchEventsSummaryForProfiles(apiKey: string, profileIds: string[], opts: { pageSize?: number; maxPages?: number; profileLimit?: number } = {}) {
  // Default: attempt all provided profiles, but cap hard to 1000 for safety
  const limit = Math.max(1, Math.min(opts.profileLimit ?? profileIds.length, 1000, profileIds.length));
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 3;
  const pick = profileIds.slice(0, limit);
  const result: Record<string, { firstActive?: string; lastOpen?: string; lastClick?: string }> = {};

  // Attempt metrics-based enrichment first for precision
  try {
    const metrics = await fetchMetricIds(apiKey, ['Opened Email', 'Clicked Email']);
    const openedMetricId = metrics['Opened Email'];
    const clickedMetricId = metrics['Clicked Email'];
    if (openedMetricId || clickedMetricId) {
      for (const id of pick) {
        let firstActive: string | undefined;
        let lastOpen: string | undefined;
        let lastClick: string | undefined;
        if (openedMetricId) {
          const times = await fetchFirstAndLastTimesForMetric(apiKey, id, openedMetricId, { pageSize, maxPages });
          lastOpen = times.last ?? lastOpen;
          if (times.first) firstActive = firstActive ? (times.first < firstActive ? times.first : firstActive) : times.first;
        }
        if (clickedMetricId) {
          const times = await fetchFirstAndLastTimesForMetric(apiKey, id, clickedMetricId, { pageSize, maxPages });
          lastClick = times.last ?? lastClick;
          if (times.first) firstActive = firstActive ? (times.first < firstActive ? times.first : firstActive) : times.first;
        }
        result[id] = { firstActive, lastOpen, lastClick };
      }
      return result;
    }
  } catch (e) {
    // non-fatal; fall through to name-based scan
  }

  for (const id of pick) {
    // Pass 1: descending for fast lastOpen/lastClick and potential firstActive if found
    const descEvents = await fetchEventsForProfile(apiKey, id, { pageSize, maxPages, sort: 'desc' });
    let firstActive: string | undefined;
    let lastOpen: string | undefined;
    let lastClick: string | undefined;
    for (const e of descEvents) {
      if (!e.time) continue;
      const name = (e.metricName || '').toLowerCase();
      const isOpen = /(open|opened email)/.test(name);
      const isClick = /(click|clicked email)/.test(name);
      const isWeb = /(active on site|viewed product|added to cart|started checkout|placed order|checkout|started checkout|viewed item|added item)/.test(name);
      if (isOpen) {
        if (!lastOpen || e.time > lastOpen) lastOpen = e.time;
      }
      if (isClick) {
        if (!lastClick || e.time > lastClick) lastClick = e.time;
      }
      if (isOpen || isClick || isWeb) {
        // Track earliest seen engagement even while scanning desc
        if (!firstActive || e.time < firstActive) firstActive = e.time;
      }
    }
    // Pass 2: if firstActive still unknown, scan oldest-first up to a few pages to find earliest engagement
    if (!firstActive) {
      const ascEvents = await fetchEventsForProfile(apiKey, id, { pageSize, maxPages: Math.max(2, Math.min(5, maxPages)), sort: 'asc' });
      for (const e of ascEvents) {
        if (!e.time) continue;
        const name = (e.metricName || '').toLowerCase();
        const isOpen = /(open|opened email)/.test(name);
        const isClick = /(click|clicked email)/.test(name);
        const isWeb = /(active on site|viewed product|added to cart|started checkout|placed order|checkout|started checkout|viewed item|added item)/.test(name);
        if (isOpen || isClick || isWeb) { firstActive = e.time; break; }
      }
    }
    result[id] = { firstActive, lastOpen, lastClick };
  }
  return result;
}


// ------- Rate limit helper -------
class RateLimiter {
  constructor(private maxRetries = 8, private initialDelay = 1500) {}

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private nextDelay(attempt: number, retryAfter?: string | null) {
    if (retryAfter) {
      const sec = Number(retryAfter);
      if (!Number.isNaN(sec) && sec > 0) return sec * 1000;
    }
    const base = this.initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(base + jitter, 30000);
  }

  async run<T>(fn: () => Promise<T>, context = ''): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const status = err?.status || err?.response?.status;
        if (status === 429 && attempt < this.maxRetries - 1) {
          const retryAfter = err?.headers?.['retry-after'] || err?.response?.headers?.get?.('retry-after');
          const delay = this.nextDelay(attempt, retryAfter);
          if (process.env.FLOW_REPORT_DEBUG === 'true') {
            console.warn(`Rate limited${context ? ` ${context}` : ''}, retrying in ${delay}ms (attempt ${attempt + 1})`);
          }
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
const rateLimiter = new RateLimiter();

export interface KlaviyoCampaignRaw {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    status?: string;
    scheduled_at?: string;
    send_time?: string;
  };
  relationships?: any;
}

export async function fetchCampaigns(
  apiKey: string,
  opts: { pageSize?: number; maxPages?: number; revision?: string; channel?: string } = {}
): Promise<KlaviyoCampaignRaw[]> {
  const maxPages = Math.min(Math.max(opts.maxPages ?? 10, 1), 100);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = 'https://a.klaviyo.com/api/campaigns';
  const params = new URLSearchParams();
  if (opts.channel) params.set('filter', `equals(messages.channel,"${opts.channel}")`);
  let url = params.toString() ? `${base}?${params}` : base;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const results: KlaviyoCampaignRaw[] = [];
  let pages = 0;
  while (url && pages < maxPages) {
    const res = await executeWithLimiter(campaignsLimiter, () => fetch(url, { headers }), 'campaigns');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo campaigns fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const data: KlaviyoCampaignRaw[] = Array.isArray(json?.data) ? json.data : [];
    results.push(...data);
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
  }
  return results;
}

export async function fetchCampaignById(
  apiKey: string,
  campaignId: string,
  opts: { revision?: string } = {}
): Promise<KlaviyoCampaignRaw | null> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = `https://a.klaviyo.com/api/campaigns/${encodeURIComponent(campaignId)}`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await executeWithLimiter(campaignsLimiter, () => fetch(url, { headers }), `campaign ${campaignId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo campaign fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json();
  const data = json?.data;
  if (!data) return null;
  return data as KlaviyoCampaignRaw;
}

export async function fetchCampaignMessages(
  apiKey: string,
  campaignId: string,
  opts: { revision?: string; pageSize?: number; maxPages?: number } = {}
) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = `https://a.klaviyo.com/api/campaigns/${encodeURIComponent(campaignId)}/campaign-messages`;
  // Note: page[size] may not be supported on all accounts; rely on link-based pagination primarily.
  let url = base; // (opts.pageSize ? `${base}?page[size]=${Math.min(Math.max(opts.pageSize, 1), 100)}` : base);
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const results: any[] = [];
  let pages = 0;
  const maxPages = Math.min(Math.max(opts.maxPages ?? 100, 1), 1000);
  while (url && pages < maxPages) {
    const res = await executeWithLimiter(campaignMessagesLimiter, () => fetch(url, { headers }), `campaign-messages ${campaignId}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo campaign messages fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    results.push(...data);
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
  }
  return results;
}

// Fetch specific campaign-message for rich fields (subject/definition)
export async function fetchCampaignMessageDetail(
  apiKey: string,
  messageId: string,
  opts: { revision?: string } = {}
) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = `https://a.klaviyo.com/api/campaign-messages/${encodeURIComponent(messageId)}`;
  const url = base; // rely on default fields; some workspaces expose attributes.definition/content
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo campaign message detail failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  return json?.data?.attributes || {};
}

export async function fetchCampaignMessageAudienceNames(
  apiKey: string,
  messageId: string,
  opts: { revision?: string } = {}
): Promise<Array<{ id?: string; kind?: 'list' | 'segment'; name?: string }>> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = `https://a.klaviyo.com/api/campaign-messages/${encodeURIComponent(messageId)}`;
  const url = `${base}?include=audience.list,audience.segment`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo campaign message audience fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  const included: any[] = Array.isArray(json?.included) ? json.included : [];
  const out: Array<{ id?: string; kind?: 'list' | 'segment'; name?: string }> = [];
  for (const inc of included) {
    const t = (inc?.type || '').toLowerCase();
    const id = inc?.id;
    const name = inc?.attributes?.name;
    if (t === 'list' && id) out.push({ id, kind: 'list', name });
    if (t === 'segment' && id) out.push({ id, kind: 'segment', name });
  }
  return out;
}

export async function fetchCampaignValues(params: { apiKey: string; campaignIds: string[]; statistics?: string[]; valueStatistics?: string[]; conversionMetricId: string; timeframeKey?: string; startISO?: string; endISO?: string; revision?: string }) {
  const { campaignIds } = params;
  if (!campaignIds.length) return [];
  const revision = params.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = 'https://a.klaviyo.com/api/campaign-values-reports';
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${params.apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  // Build statistics ensuring conversion_value is not included here; it must be requested via value_statistics
  const defaultStatistics = [
    'recipients',
    'delivered',
    'bounced',
    'bounce_rate',
    'opens_unique',
    'open_rate',
    'opens',
    'clicks_unique',
    'click_rate',
    'clicks',
    'conversion_uniques',
    'conversion_rate',
    'unsubscribes',
    'unsubscribe_rate',
    'spam_complaints',
    'spam_complaint_rate'
  ];
  const statistics = (params.statistics ?? defaultStatistics).filter(s => s !== 'conversion_value');
  const valueStatistics = params.valueStatistics ?? ['conversion_value'];
  const conversionMetricId = params.conversionMetricId;
  const timeframeKey = params.timeframeKey || 'last_30_days';
  const out: Array<{ campaign_id?: string; statistics: Record<string, number> }> = [];
  for (let i = 0; i < campaignIds.length; i += 1) {
    const batch = campaignIds.slice(i, i + 1);
    const results = await Promise.all(batch.map(async (campaignId) => {
      if (process.env.CAMPAIGN_LOG_TIMING === 'true') {
        try {
          console.log('[debug] campaign-values request', {
            campaignId,
            timeframe: params.timeframeKey ? { key: params.timeframeKey } : { start: params.startISO, end: params.endISO },
            statistics,
            value_statistics: valueStatistics,
            conversionMetricId,
          });
        } catch {}
      }
      const buildBody = (useValueStatistics: boolean) => JSON.stringify({
        data: {
          type: 'campaign-values-report',
          attributes: {
            timeframe: timeframeKey ? { key: timeframeKey } : { start: params.startISO, end: params.endISO },
            statistics: useValueStatistics ? statistics : [...statistics, 'conversion_value'],
            ...(useValueStatistics ? { value_statistics: valueStatistics } : {}),
            conversion_metric_id: conversionMetricId,
            filter: `equals(campaign_id,"${campaignId}")`,
          },
        },
      });

      // First try with value_statistics (newer API). If API rejects that field, retry once with legacy schema.
      let res = await executeWithLimiter(
        campaignValuesLimiter,
        () => fetch(url, { method: 'POST', headers, body: buildBody(true) }),
        `campaign-values ${campaignId}`,
        3,
        { maxRetryAfterSeconds: 60 }
      );
      if (!res.ok && res.status === 400) {
        const text = await res.text().catch(() => '');
        const mentionsValueStats = /value_statistics\'\s+is\s+not\s+a\s+valid|\"value_statistics\"\s+is\s+not\s+a\s+valid|value_statistics[^\n]*invalid/i.test(text);
        if (mentionsValueStats) {
          if (process.env.CAMPAIGN_LOG_TIMING === 'true') {
            try { console.warn(`[compat] Retrying campaign-values without value_statistics for ${campaignId}`); } catch {}
          }
          res = await executeWithLimiter(
            campaignValuesLimiter,
            () => fetch(url, { method: 'POST', headers, body: buildBody(false) }),
            `campaign-values ${campaignId}(compat)`,
            3,
            { maxRetryAfterSeconds: 60 }
          );
        } else {
          throw new Error(`Klaviyo campaign values fetch failed ${res.status}: ${text}`);
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Klaviyo campaign values fetch failed ${res.status}: ${text}`);
      }
      const json: any = await res.json().catch(() => ({}));
      const results = json?.data?.attributes?.results;
      if (!Array.isArray(results)) return [];
      return results.map((r: any) => ({ campaign_id: r?.groupings?.campaign_id || campaignId, statistics: r?.statistics || {} }));
    }));
    for (const arr of results) {
      out.push(...arr);
    }
    // No explicit delay; EndpointLimiter enforces min-interval and per-minute limits
  }
  return out;
}

export async function fetchCampaignTags(apiKey: string, campaignId: string, opts: { revision?: string } = {}) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = `https://a.klaviyo.com/api/campaigns/${encodeURIComponent(campaignId)}/tags`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
    const res = await executeWithLimiter(campaignTagsLimiter, () => fetch(url, { headers }), `campaign-tags ${campaignId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo campaign tags fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  return data.map(t => t?.attributes?.name).filter(Boolean);
}

// Fetch campaign audiences and return list names
export async function fetchCampaignAudiences(
  apiKey: string,
  campaignId: string,
  opts: { revision?: string } = {}
) : Promise<Array<{ id?: string; kind?: 'list' | 'segment'; name?: string }>> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = `https://a.klaviyo.com/api/campaigns/${encodeURIComponent(campaignId)}/audiences?include=list,segment`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo campaign audiences fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  const included: any[] = Array.isArray(json?.included) ? json.included : [];
  const listNames = new Map<string, string>();
  const segmentNames = new Map<string, string>();
  for (const inc of included) {
    const t = (inc?.type || '').toLowerCase();
    const name = inc?.attributes?.name;
    if (t === 'list' && inc?.id && name) listNames.set(inc.id, name);
    if (t === 'segment' && inc?.id && name) segmentNames.set(inc.id, name);
  }
  const out: Array<{ id?: string; kind?: 'list' | 'segment'; name?: string }> = [];
  for (const d of data) {
    const relListId = d?.relationships?.list?.data?.id;
    const relSegmentId = d?.relationships?.segment?.data?.id;
    if (relListId) {
      out.push({ id: relListId, kind: 'list', name: listNames.get(relListId) });
    } else if (relSegmentId) {
      out.push({ id: relSegmentId, kind: 'segment', name: segmentNames.get(relSegmentId) });
    } else {
      const name = d?.attributes?.name;
      const id = d?.id;
      if (name) out.push({ id, name });
    }
  }
  if (out.length === 0 && included.length > 0) {
    for (const inc of included) {
      const t = (inc?.type || '').toLowerCase();
      const id = inc?.id;
      const name = inc?.attributes?.name;
      if (t === 'list' && id) out.push({ id, kind: 'list', name });
      if (t === 'segment' && id) out.push({ id, kind: 'segment', name });
    }
  }
  return out;
}

export async function fetchListDetails(apiKey: string, listId: string, opts: { revision?: string } = {}) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = `https://a.klaviyo.com/api/lists/${encodeURIComponent(listId)}`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await executeWithLimiter(listsLimiter, () => fetch(url, { headers }), `list ${listId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo list fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  return { name: json?.data?.attributes?.name || listId };
}

export async function fetchSegmentDetails(apiKey: string, segmentId: string, opts: { revision?: string } = {}) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = `https://a.klaviyo.com/api/segments/${encodeURIComponent(segmentId)}`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await executeWithLimiter(segmentsLimiter, () => fetch(url, { headers }), `segment ${segmentId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo segment fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  return { name: json?.data?.attributes?.name || segmentId };
}

// Bulk fetch lists (id + name) for caching
export async function fetchAllLists(apiKey: string, opts: { revision?: string; maxPages?: number } = {}) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = 'https://a.klaviyo.com/api/lists';
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const out: Array<{ id: string; name: string }> = [];
  let url: string | undefined = base;
  let pages = 0;
  const maxPages = Math.min(Math.max(opts.maxPages ?? 50, 1), 1000);
  while (url && pages < maxPages) {
    const res = await executeWithLimiter(listsLimiter, () => fetch(url!, { headers }), 'lists');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo lists fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json().catch(() => ({}));
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const d of data) {
      const id = d?.id; const name = d?.attributes?.name;
      if (id && name) out.push({ id, name });
    }
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : undefined;
    pages++;
  }
  return out;
}

// Bulk fetch segments (id + name) for caching
export async function fetchAllSegments(apiKey: string, opts: { revision?: string; maxPages?: number } = {}) {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = 'https://a.klaviyo.com/api/segments';
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const out: Array<{ id: string; name: string }> = [];
  let url: string | undefined = base;
  let pages = 0;
  const maxPages = Math.min(Math.max(opts.maxPages ?? 50, 1), 1000);
  while (url && pages < maxPages) {
    const res = await executeWithLimiter(segmentsLimiter, () => fetch(url!, { headers }), 'segments');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo segments fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json().catch(() => ({}));
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const d of data) {
      const id = d?.id; const name = d?.attributes?.name;
      if (id && name) out.push({ id, name });
    }
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : undefined;
    pages++;
  }
  return out;
}

// Fallback: fetch campaign detail with audiences included and derive list/segment names from included
export async function fetchCampaignAudienceNamesViaCampaignDetail(
  apiKey: string,
  campaignId: string,
  opts: { revision?: string } = {}
): Promise<Array<{ id?: string; kind?: 'list' | 'segment'; name?: string }>> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = `https://a.klaviyo.com/api/campaigns/${encodeURIComponent(campaignId)}`;
  const url = `${base}?include=audiences.list,audiences.segment`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await executeWithLimiter(campaignsLimiter, () => fetch(url, { headers }), `campaign ${campaignId} include=audiences`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo campaign detail fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  const included: any[] = Array.isArray(json?.included) ? json.included : [];
  const out: Array<{ id?: string; kind?: 'list' | 'segment'; name?: string }>= [];
  for (const inc of included) {
    const t = (inc?.type || '').toLowerCase();
    const id = inc?.id;
    const name = inc?.attributes?.name;
    if (t === 'list' && id) out.push({ id, kind: 'list', name });
    if (t === 'segment' && id) out.push({ id, kind: 'segment', name });
  }
  return out;
}
// ------- Metrics helpers -------

export async function fetchMetricIds(apiKey: string, names: string[], opts: { revision?: string; preferredIntegrationName?: string } = {}) {
  const base = 'https://a.klaviyo.com/api/metrics';
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const fields = 'fields[metric]=name';
  // 'name' is not filterable per API; fetch pages and match locally by name.
  const url = `${base}?${fields}`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const wanted = new Set(names);
  // Track first-found per name and preferred-integration per name
  const out: Record<string, string> = {};
  const firstFound: Record<string, string> = {};
  const preferred = (opts.preferredIntegrationName || '').toLowerCase();
  let nextUrl: string | undefined = url;
  let pages = 0;
  while (nextUrl && pages < 10) { // hard cap
    const res = await fetch(nextUrl, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo metrics fetch failed ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const m of data) {
      const name = m?.attributes?.name;
      const id = m?.id;
      if (!name || !id || !wanted.has(name)) continue;
      const key = name as string;
      // Prefer preferredIntegrationName if provided; otherwise keep first-found
      if (preferred) {
        const integLower = (m?.attributes?.integration?.name || '').toLowerCase();
        if (integLower === preferred) {
          out[key] = id; // exact preferred match
        } else {
          // store firstFound if nothing stored yet
          if (!firstFound[key]) firstFound[key] = id;
          // only set out[key] if not already set to preferred match
          if (!out[key]) out[key] = firstFound[key];
        }
      } else {
        if (!out[key]) out[key] = id;
      }
    }
    // If we have preferred integration, we might still want to continue to find preferred matches; stop early if all names have an id and each is already a preferred match or we don't care.
    if (Object.keys(out).length === wanted.size) {
      if (!preferred) break;
      // If preferred is set, verify each chosen id corresponds to preferred integration; if any not preferred, keep paging in case preferred appears in next pages.
      let allPreferred = true;
      if (Array.isArray(data) && data.length > 0) {
        // We don't have a reverse map from id to integration for prior pages; be conservative and break after several pages anyway
        allPreferred = false;
      }
      if (allPreferred) break;
    }
    const next = json?.links?.next;
    nextUrl = typeof next === 'string' && next ? next : undefined;
    pages++;
  }
  // If preferred was requested and some names didn't land on preferred, fallback to firstFound for those
  if (preferred) {
    for (const n of names) {
      if (!out[n] && firstFound[n]) out[n] = firstFound[n];
    }
  }
  return out;
}

export async function fetchAccountTimezone(
  apiKey: string,
  opts: { revision?: string } = {}
): Promise<string | undefined> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = 'https://a.klaviyo.com/api/accounts';
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return undefined;
    const json: any = await res.json().catch(() => ({}));
    const tz = json?.data?.[0]?.attributes?.timezone;
    return typeof tz === 'string' && tz ? tz : undefined;
  } catch {
    return undefined;
  }
}

async function fetchFirstAndLastTimesForMetric(
  apiKey: string,
  profileId: string,
  metricId: string,
  opts: { pageSize?: number; maxPages?: number; revision?: string }
): Promise<{ first?: string; last?: string }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 3, 1), 20);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const base = 'https://a.klaviyo.com/api/events';
  const fieldsEvent = 'fields[event]=datetime';
  const rawPid = profileId;
  const rawMid = metricId;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const makeUrl = (sort: 'asc' | 'desc') => {
    const filter = `and(equals(profile_id,"${rawPid}"),equals(metric_id,"${rawMid}"))`;
    return `${base}?filter=${encodeURIComponent(filter)}&sort=${sort === 'asc' ? 'datetime' : '-datetime'}&page[size]=${pageSize}&${fieldsEvent}`;
  };
  // last = first item when sorted desc
  let last: string | undefined;
  let urlDesc = makeUrl('desc');
  let pages = 0;
  while (pages < maxPages && urlDesc) {
    const res = await fetch(urlDesc, { headers });
    if (!res.ok) break;
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    if (data.length > 0) {
      last = data[0]?.attributes?.datetime || last;
      break; // we only need the most recent
    }
    const next = json?.links?.next;
    urlDesc = typeof next === 'string' && next ? next : '';
    pages++;
  }
  // first = first item when sorted asc
  let first: string | undefined;
  let urlAsc = makeUrl('asc');
  pages = 0;
  while (pages < Math.max(2, maxPages) && urlAsc) {
    const res = await fetch(urlAsc, { headers });
    if (!res.ok) break;
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    if (data.length > 0) {
      first = data[0]?.attributes?.datetime || first;
      break; // earliest engagement for this metric
    }
    const next = json?.links?.next;
    urlAsc = typeof next === 'string' && next ? next : '';
    pages++;
  }
  return { first, last };
}

// Fetch a small sample of most recent events for specific metric names
export async function fetchEventsSampleForMetrics(
  apiKey: string,
  metricNames: string[],
  opts: { pageSize?: number; maxPages?: number; revision?: string; profileId?: string; since?: string }
) {
  const metrics = await fetchMetricIds(apiKey, metricNames, { revision: opts.revision });
  const metricIds = Object.values(metrics);
  const out: Array<{ time?: string; metric?: string; metric_id?: string; profile_id?: string; email?: string }> = [];
  for (const metricId of metricIds) {
    const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
    const maxPages = Math.min(Math.max(opts.maxPages ?? 1, 1), 5);
    const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
    const base = 'https://a.klaviyo.com/api/events';
    const fieldsEvent = 'fields[event]=datetime';
    const fieldsMetric = 'fields[metric]=name';
    const fieldsProfile = 'fields[profile]=email';
    const include = 'include=metric,profile';
  const rawMid = metricId;
  const rawPid = opts.profileId;
  const sinceClause = opts.since ? `,greater-or-equal(timestamp,'${opts.since}')` : '';
    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const makeUrl = (filterExpr: string, pageUrl?: string) => pageUrl || `${base}?filter=${encodeURIComponent(filterExpr)}&sort=-datetime&${fieldsEvent}&${fieldsMetric}&${fieldsProfile}&${include}&page[size]=${pageSize}`;
    let triedPersonFallback = false;
    let url = makeUrl(
      opts.profileId ? `and(equals(metric_id,"${rawMid}"),equals(profile_id,"${rawPid}")${sinceClause})` : `and(equals(metric_id,"${rawMid}")${sinceClause})`
    );
    let pages = 0;
    while (pages < maxPages && url) {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const json: any = await res.json();
      const included: (IncludedMetricRaw | IncludedProfileRaw)[] = Array.isArray(json?.included) ? json.included : [];
      const metricNameById = new Map<string, string>();
      const profileEmailById = new Map<string, string>();
      for (const inc of included) {
        if (inc.type === 'metric' && (inc as any)?.attributes?.name && inc.id) {
          metricNameById.set(inc.id, (inc as any).attributes.name);
        }
        if (inc.type === 'profile' && (inc as any)?.attributes?.email && inc.id) {
          profileEmailById.set(inc.id, (inc as any).attributes.email);
        }
      }
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const ev of data) {
        const metricRelId = ev?.relationships?.metric?.data?.id;
        const profileRelId = ev?.relationships?.profile?.data?.id;
        out.push({
          time: ev?.attributes?.datetime,
          metric_id: metricRelId,
          metric: metricRelId ? metricNameById.get(metricRelId) : undefined,
          profile_id: profileRelId,
          email: profileRelId ? profileEmailById.get(profileRelId) : undefined,
        });
      }
      const next = json?.links?.next;
      url = typeof next === 'string' && next ? next : '';
      pages++;
      if (pages === 1 && out.length === 0 && opts.profileId && !triedPersonFallback) {
        triedPersonFallback = true;
  url = makeUrl(`and(equals(metric_id,"${rawMid}"),equals(person_id,"${rawPid}")${sinceClause})`);
        pages = 0;
      }
    }
  }
  return out;
}

export async function fetchEventsSampleByMetricIds(
  apiKey: string,
  metricIds: string[],
  opts: { pageSize?: number; maxPages?: number; revision?: string; profileId?: string; since?: string }
) {
  const out: Array<{ time?: string; metric?: string; metric_id?: string; profile_id?: string; email?: string }> = [];
  for (const metricId of metricIds) {
    if (!metricId) continue;
    const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
    const maxPages = Math.min(Math.max(opts.maxPages ?? 1, 1), 5);
    const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
    const base = 'https://a.klaviyo.com/api/events';
    const fieldsEvent = 'fields[event]=datetime';
    const fieldsMetric = 'fields[metric]=name';
    const fieldsProfile = 'fields[profile]=email';
    const include = 'include=metric,profile';
    const encMid = encodeURIComponent(metricId);
    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const encPid = opts.profileId ? encodeURIComponent(opts.profileId) : undefined;
  const sinceClause = opts.since ? `,greater-or-equal(timestamp,'${opts.since}')` : '';
    const makeUrl = (filterExpr: string, pageUrl?: string) => pageUrl || `${base}?filter=${encodeURIComponent(filterExpr)}&sort=-datetime&${fieldsEvent}&${fieldsMetric}&${fieldsProfile}&${include}&page[size]=${pageSize}`;
    let triedPersonFallback = false;
    let url = makeUrl(
      opts.profileId ? `and(equals(metric_id,'${encMid}'),equals(profile_id,'${encPid}')${sinceClause})` : `and(equals(metric_id,'${encMid}')${sinceClause})`
    );
    let pages = 0;
    while (pages < maxPages && url) {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const json: any = await res.json();
      const included: (IncludedMetricRaw | IncludedProfileRaw)[] = Array.isArray(json?.included) ? json.included : [];
      const metricNameById = new Map<string, string>();
      const profileEmailById = new Map<string, string>();
      for (const inc of included) {
        if (inc.type === 'metric' && (inc as any)?.attributes?.name && (inc as any).id) {
          metricNameById.set((inc as any).id, (inc as any).attributes.name);
        }
        if (inc.type === 'profile' && (inc as any)?.attributes?.email && (inc as any).id) {
          profileEmailById.set((inc as any).id, (inc as any).attributes.email);
        }
      }
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const ev of data) {
        const metricRelId = ev?.relationships?.metric?.data?.id;
        const profileRelId = ev?.relationships?.profile?.data?.id;
        out.push({
          time: ev?.attributes?.datetime,
          metric_id: metricRelId,
          metric: metricRelId ? metricNameById.get(metricRelId) : undefined,
          profile_id: profileRelId,
          email: profileRelId ? profileEmailById.get(profileRelId) : undefined,
        });
      }
      const next = json?.links?.next;
      url = typeof next === 'string' && next ? next : '';
      pages++;
      if (pages === 1 && data.length === 0 && opts.profileId && !triedPersonFallback) {
        triedPersonFallback = true;
        // retry with person_id
        url = makeUrl(`and(equals(metric_id,'${encMid}'),equals(person_id,'${encPid}')${sinceClause})`);
        pages = 0;
      }
    }
  }
  return out;
}

// Flow interfaces
export interface KlaviyoFlowRaw {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    status?: string;
    created?: string;
    updated?: string;
    trigger_type?: string;
    archived?: boolean;
  };
}

export interface KlaviyoFlowActionRaw {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    action_type?: string;
    status?: string;
    created?: string;
    updated?: string;
    settings?: Record<string, any>;
    render_options?: Record<string, any>;
  };
}

export interface KlaviyoFlowMessageRaw {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    channel?: string;
    created?: string;
    updated?: string;
  };
  relationships?: {
    flow?: {
      data?: {
        id?: string;
        type?: string;
      };
    };
    flow_action?: {
      data?: {
        id?: string;
        type?: string;
      };
    };
  };
  flowActionId?: string; // populated client-side for convenience
}

export interface FlowAnalyticsRaw {
  id: string;
  type: string;
  attributes?: {
    send_time?: string;
    flow_message_id?: string;
    flow_id?: string;
    flow_name?: string;
    flow_message_name?: string;
    status?: string;
    delivered?: number;
    unique_opens?: number;
    open_rate?: number;
    unique_clicks?: number;
    click_rate?: number;
    placed_orders?: number;
    placed_order_rate?: number;
    revenue?: number;
    revenue_per_recipient?: number;
    unsubscribes?: number;
    unsubscribe_rate?: number;
    spam_complaints?: number;
    complaint_rate?: number;
    bounces?: number;
    bounce_rate?: number;
  };
}

export interface FlowAnalyticsEntry {
  day: string;
  flowId: string;
  flowName: string;
  flowMessageId: string;
  flowMessageName: string;
  channel: string;
  status: string;
  delivered: number;
  uniqueOpens: number;
  openRate: number;
  uniqueClicks: number;
  clickRate: number;
  placedOrders: number;
  placedOrderRate: number;
  revenue: number;
  revenuePerRecipient: number;
  unsubscribeRate: number;
  complaintRate: number;
  bounceRate: number;
  tags?: string;
}

// ----- Flow Report (Performance) -----
// The Klaviyo "flow-report" endpoint returns aggregated performance metrics for flows/messages
// over a specified timeframe. We query it day-by-day to build a daily time series.
// NOTE: Public docs are sparse; this implementation uses best-effort parameterization based on
// provided guidance. If the GET style query fails (404/400), callers should fall back to synthetic data.

export interface KlaviyoFlowReportParams {
  apiKey: string;
  start: string; // inclusive date (YYYY-MM-DD)
  end: string;   // inclusive date (YYYY-MM-DD)
  flowId?: string;
  flowMessageId?: string;
  flowActionId?: string;
  conversionMetricId?: string; // Placed Order metric id (optional)
  revision?: string;
  abortSignal?: AbortSignal;
}

export interface KlaviyoFlowReportMetrics {
  delivered?: number;
  opens_unique?: number;
  open_rate?: number;
  clicks_unique?: number;
  click_rate?: number;
  conversion_uniques?: number; // if conversion metric is Placed Order
  conversion_rate?: number;
  unsubscribe_rate?: number;
  spam_complaint_rate?: number;
  bounce_rate?: number;
  revenue?: number;
  revenue_per_recipient?: number;
}

interface FlowReportResponseRaw {
  data?: Array<{
    id?: string;
    type?: string;
    attributes?: KlaviyoFlowReportMetrics & { flow_id?: string; flow_message_id?: string };
  }>;
}

// New: broader flow-report grouped results (no filters) returning array entries with groupings
export interface FlowReportGroupedResult {
  flow_id?: string;
  flow_message_id?: string;
  flow_action_id?: string;
  flow_message_name?: string;
  send_channel?: string;
  // statistics
  delivered?: number;
  opens_unique?: number;
  open_rate?: number;
  clicks_unique?: number;
  click_rate?: number;
  conversion_uniques?: number;
  conversion_rate?: number;
  unsubscribe_rate?: number;
  spam_complaint_rate?: number;
  bounce_rate?: number;
  revenue?: number;
  conversion_value?: number;
  revenue_per_recipient?: number;
}

interface FlowReportBroadRaw {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      results?: Array<{
        groupings?: {
          flow_id?: string;
          flow_message_id?: string;
          send_channel?: string;
          flow_action_id?: string;
        };
        statistics?: Record<string, number | null>;
      }>;
    };
  };
}

// Fallback: Aggregate metrics via Events API when flow-report is unavailable
// This function fetches events for known metric categories in a timeframe, extracts
// flow identifiers from event properties, and aggregates counts and values per
// flow_message_id (and day). It returns per-day grouped results similar to flow-report.
export interface EventsAggregationOptions {
  apiKey: string;
  startISO: string; // inclusive timestamp (YYYY-MM-DDTHH:mm:ssZ)
  endISO: string;   // inclusive timestamp
  revision?: string;
  pageSize?: number; // per-page events
  maxPagesPerMetric?: number; // safety cap per metric category
  timeZone?: string; // account timezone for day bucketing
  dayWhitelist?: string[]; // optional set of allowed local days
}

type MetricCategory = 'delivered' | 'opened' | 'clicked' | 'unsubscribed' | 'spam' | 'bounced' | 'orders';

const METRIC_NAME_CANDIDATES: Record<MetricCategory, string[]> = {
  delivered: ['Delivered Email', 'Email Delivered', 'Sent Email', 'Received Email'],
  opened: ['Opened Email'],
  clicked: ['Clicked Email'],
  unsubscribed: ['Unsubscribed', 'Unsubscribe', 'Unsubscribed from Email Marketing'],
  spam: ['Marked Email as Spam', 'Spam Complaint', 'Spam Complaints'],
  bounced: ['Bounced Email', 'Email Bounced'],
  orders: ['Placed Order'],
};

function getProp(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function pickFlowIdsFromEventProps(props: any): { flow_id?: string; flow_message_id?: string; flow_action_id?: string } {
  const flow_id = getProp(props || {}, ['flow_id', '$flow_id', 'flow', '$flow']);
  // Klaviyo often uses flow_message_id or message_id; include common variants
  const flow_message_id = getProp(props || {}, ['flow_message_id', '$flow_message_id', 'message_id', '$message_id', 'flow_message', '$flow_message', 'message', '$message']);
  const flow_action_id = getProp(props || {}, ['flow_action_id', '$flow_action_id', 'action_id', '$action_id']);
  return {
    flow_id: typeof flow_id === 'string' || typeof flow_id === 'number' ? String(flow_id) : undefined,
    flow_message_id: typeof flow_message_id === 'string' || typeof flow_message_id === 'number' ? String(flow_message_id) : undefined,
    flow_action_id: typeof flow_action_id === 'string' || typeof flow_action_id === 'number' ? String(flow_action_id) : undefined,
  };
}

// Campaign identifiers picker from event properties
function pickCampaignIdsFromEventProps(props: any): { campaign_id?: string; campaign_message_id?: string } {
  const campaign_id = getProp(props || {}, ['campaign_id', '$campaign_id', 'campaign', '$campaign']);
  const campaign_message_id = getProp(props || {}, ['campaign_message_id', '$campaign_message_id', 'message_id', '$message_id', 'campaign_message', '$campaign_message']);
  return {
    campaign_id: typeof campaign_id === 'string' || typeof campaign_id === 'number' ? String(campaign_id) : undefined,
    campaign_message_id: typeof campaign_message_id === 'string' || typeof campaign_message_id === 'number' ? String(campaign_message_id) : undefined,
  };
}

function dayFromISO(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const i = iso.indexOf('T');
  return i > 0 ? iso.slice(0, i) : undefined;
}

export async function aggregateFlowMetricsViaEvents(opts: EventsAggregationOptions): Promise<Array<FlowReportGroupedResult & { day?: string }>> {
  const { apiKey, startISO, endISO, timeZone } = opts;
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const maxPagesPerMetric = Math.min(Math.max(opts.maxPagesPerMetric ?? 40, 1), 200);

  // Resolve metric IDs for each category using candidate names; pick the first found
  const allNames = Array.from(new Set(Object.values(METRIC_NAME_CANDIDATES).flat()));
  let metricIdByName: Record<string, string> = {};
  try {
    metricIdByName = await fetchMetricIds(apiKey, allNames, { revision });
  } catch {
    // proceed with what we have (possibly none)
  }
  const categoryMetricIds: Partial<Record<MetricCategory, string>> = {};
  for (const cat of Object.keys(METRIC_NAME_CANDIDATES) as MetricCategory[]) {
    const candidates = METRIC_NAME_CANDIDATES[cat];
    for (const n of candidates) {
      if (metricIdByName[n]) { categoryMetricIds[cat] = metricIdByName[n]; break; }
    }
  }

  // Internal aggregator: key by day+flow_message_id
  type Key = string; // `${day}|${flow_id}|${flow_message_id}`
  type Acc = FlowReportGroupedResult & {
    day?: string;
    deliveredRecipients?: Set<string>;
    openRecipients?: Set<string>;
    clickRecipients?: Set<string>;
    unsubscribeRecipients?: Set<string>;
    spamRecipients?: Set<string>;
    bounceRecipients?: Set<string>;
    conversionRecipients?: Set<string>;
  };
  const agg = new Map<Key, Acc>();

  const allowedDays = Array.isArray(opts.dayWhitelist) ? new Set(opts.dayWhitelist) : undefined;

  async function fetchAndAccumulate(cat: MetricCategory, metricId: string) {
    const base = 'https://a.klaviyo.com/api/events';
    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const fieldsEvent = 'fields[event]=datetime,event_properties';
    const startTs = dayjs(startISO).unix();
    const endTs = dayjs(endISO).unix();
    const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(timestamp,${startTs}),less-or-equal(timestamp,${endTs}))`;
    let url = `${base}?filter=${filter}&sort=-datetime&${fieldsEvent}&page%5Bsize%5D=${pageSize}`;
    let pages = 0;
    while (url && pages < maxPagesPerMetric) {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const json: any = await res.json();
      const items: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const it of items) {
        const attrs = it?.attributes || {};
        const props = attrs?.properties || attrs?.event_properties || {};
        const day = timeZone ? dayjs(attrs?.datetime).tz(timeZone).format('YYYY-MM-DD') : dayFromISO(attrs?.datetime);
        if (!day) continue;
        const ids = pickFlowIdsFromEventProps(props);
        if (!ids.flow_message_id) continue; // must attribute to a specific message
        if (allowedDays && !allowedDays.has(day)) continue;
        const k: Key = `${day}|${ids.flow_id || ''}|${ids.flow_message_id}`;
        let entry = agg.get(k);
        if (!entry) {
          const maybeName = getProp(props, ['$campaign_name', 'campaign_name', 'Campaign Name', '$message_name', 'message_name', '$subject', 'subject', 'Subject']);
          const maybeChannel = getProp(props, ['channel', '$channel', 'message_channel', '$message_channel']);
          entry = {
            day,
            flow_id: ids.flow_id,
            flow_message_id: ids.flow_message_id,
            flow_action_id: ids.flow_action_id,
            flow_message_name: maybeName !== undefined ? String(maybeName) : undefined,
            send_channel: maybeChannel !== undefined ? String(maybeChannel) : undefined,
            deliveredRecipients: new Set<string>(),
            openRecipients: new Set<string>(),
            clickRecipients: new Set<string>(),
            unsubscribeRecipients: new Set<string>(),
            spamRecipients: new Set<string>(),
            bounceRecipients: new Set<string>(),
            conversionRecipients: new Set<string>(),
          } as Acc;
          agg.set(k, entry);
        }
        if (!entry.flow_action_id && ids.flow_action_id) entry.flow_action_id = ids.flow_action_id;
        if (!entry.flow_message_name) {
          const maybeName = getProp(props, ['$campaign_name', 'campaign_name', 'Campaign Name', '$message_name', 'message_name', '$subject', 'subject', 'Subject']);
          if (maybeName) entry.flow_message_name = String(maybeName);
        }
        if (!entry.send_channel) {
          const maybeChannel = getProp(props, ['channel', '$channel', 'message_channel', '$message_channel']);
          if (maybeChannel) entry.send_channel = String(maybeChannel);
        }
        // Increment category-specific counters
        const cohort = getProp(props, ['$_cohort$message_send_cohort', '$message_send_cohort']);
        const email = getProp(props, ['Recipient Email Address', 'email', '$email']);
        const profile = getProp(props, ['profile', '$person']) ?? it?.relationships?.profile?.data?.id;
        const recipientStr = cohort ? `cohort:${cohort}`
          : email ? `email:${String(email).toLowerCase()}`
          : profile ? `profile:${String(profile).toLowerCase()}`
          : String(it?.id);
        switch (cat) {
          case 'delivered':
            entry.deliveredRecipients?.add(recipientStr);
            entry.delivered = entry.deliveredRecipients ? entry.deliveredRecipients.size : (entry.delivered || 0) + 1;
            break;
          case 'opened':
            entry.openRecipients?.add(recipientStr);
            entry.opens_unique = entry.openRecipients ? entry.openRecipients.size : (entry.opens_unique || 0) + 1;
            break;
          case 'clicked':
            entry.clickRecipients?.add(recipientStr);
            entry.clicks_unique = entry.clickRecipients ? entry.clickRecipients.size : (entry.clicks_unique || 0) + 1;
            break;
          case 'unsubscribed':
            entry.unsubscribeRecipients?.add(recipientStr);
            entry.unsubscribe_rate = entry.unsubscribeRecipients ? entry.unsubscribeRecipients.size : (entry.unsubscribe_rate || 0) + 1;
            break; // store raw count; rate computed by caller if needed
          case 'spam':
            entry.spamRecipients?.add(recipientStr);
            entry.spam_complaint_rate = entry.spamRecipients ? entry.spamRecipients.size : (entry.spam_complaint_rate || 0) + 1;
            break; // raw count
          case 'bounced':
            entry.bounceRecipients?.add(recipientStr);
            entry.bounce_rate = entry.bounceRecipients ? entry.bounceRecipients.size : (entry.bounce_rate || 0) + 1;
            break; // raw count
          case 'orders':
            entry.conversionRecipients?.add(recipientStr);
            entry.conversion_uniques = entry.conversionRecipients ? entry.conversionRecipients.size : (entry.conversion_uniques || 0) + 1;
            // Sum revenue
            const val = getProp(props, ['$value', 'value', 'revenue', '$revenue']);
            if (typeof val === 'number') {
              entry.conversion_value = (entry.conversion_value || 0) + (val || 0);
              entry.revenue = (entry.revenue || 0) + (val || 0);
            }
            break;
        }
      }
      const next = json?.links?.next;
      url = typeof next === 'string' && next ? next : '';
      pages++;
    }
  }

  // Fetch and accumulate for each available category in parallel so we stay responsive even when
  // Klaviyo responds slowly per metric. Individual errors are ignored to keep remaining metrics flowing.
  const tasks: Promise<void>[] = [];
  for (const cat of Object.keys(categoryMetricIds) as MetricCategory[]) {
    const mid = categoryMetricIds[cat];
    if (!mid) continue;
    tasks.push(fetchAndAccumulate(cat, mid).catch(() => {}));
  }
  if (tasks.length) await Promise.all(tasks);

  // Convert raw counts for unsubscribe/spam/bounce into rates later at the route level
  return Array.from(agg.values()).map(e => {
    delete e.deliveredRecipients;
    delete e.openRecipients;
    delete e.clickRecipients;
    delete e.unsubscribeRecipients;
    delete e.spamRecipients;
    delete e.bounceRecipients;
    delete e.conversionRecipients;
    return e;
  });
}

// Aggregate campaign metrics via Events API for a single campaign within a timeframe.
// Used as a fallback when campaign-values-reports returns no rows.
export async function aggregateCampaignMetricsViaEvents(opts: { apiKey: string; startISO: string; endISO: string; campaignId: string; campaignMessageId?: string; revision?: string; pageSize?: number; maxPagesPerMetric?: number }): Promise<{ statistics: Record<string, number> }> {
  const { apiKey, startISO, endISO, campaignId, campaignMessageId } = opts;
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const maxPagesPerMetric = Math.min(Math.max(opts.maxPagesPerMetric ?? 10, 1), 50);

  // Resolve metric IDs for each category using candidate names; pick the first found
  const allNames = Array.from(new Set(Object.values(METRIC_NAME_CANDIDATES).flat()));
  let metricIdByName: Record<string, string> = {};
  try {
    metricIdByName = await fetchMetricIds(apiKey, allNames, { revision });
  } catch {
    // proceed with what we have
  }
  const categoryMetricIds: Partial<Record<MetricCategory, string>> = {};
  for (const cat of Object.keys(METRIC_NAME_CANDIDATES) as MetricCategory[]) {
    const candidates = METRIC_NAME_CANDIDATES[cat];
    for (const n of candidates) {
      if (metricIdByName[n]) { categoryMetricIds[cat] = metricIdByName[n]; break; }
    }
  }

  type Acc = {
    deliveredRecipients?: Set<string>;
    openRecipients?: Set<string>;
    clickRecipients?: Set<string>;
    unsubscribeRecipients?: Set<string>;
    spamRecipients?: Set<string>;
    bounceRecipients?: Set<string>;
    conversionRecipients?: Set<string>;
    // totals
    delivered?: number;
    opens_unique?: number;
    clicks_unique?: number;
    unsubscribes?: number; // store raw count; caller can derive rates
    spam_complaints?: number;
    bounces?: number;
    conversion_uniques?: number;
    conversion_value?: number;
  };
  const acc: Acc = {};

  async function fetchAndAccumulate(cat: MetricCategory, metricId: string) {
    const base = 'https://a.klaviyo.com/api/events';
    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      revision,
    };
    const fieldsEvent = 'fields[event]=datetime,event_properties';
    const startTs = dayjs(startISO).unix();
    const endTs = dayjs(endISO).unix();
    const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(timestamp,${startTs}),less-or-equal(timestamp,${endTs}))`;
    let url = `${base}?filter=${filter}&sort=-datetime&${fieldsEvent}&page%5Bsize%5D=${pageSize}`;
    let pages = 0;
    while (url && pages < maxPagesPerMetric) {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const json: any = await res.json();
      const items: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const it of items) {
        const attrs = it?.attributes || {};
        const props = attrs?.properties || attrs?.event_properties || {};
        const ids = pickCampaignIdsFromEventProps(props);
        // Keep only events that match campaign_id or, as a fallback, the known campaign_message_id
        const matchesCampaign = (ids.campaign_id && String(ids.campaign_id) === String(campaignId))
          || (campaignMessageId && ids.campaign_message_id && String(ids.campaign_message_id) === String(campaignMessageId));
        if (!matchesCampaign) continue;
        // Recipient identity used for uniqueness per metric
        const cohort = getProp(props, ['$_cohort$message_send_cohort', '$message_send_cohort']);
        const email = getProp(props, ['Recipient Email Address', 'email', '$email']);
        const profile = getProp(props, ['profile', '$person']) ?? it?.relationships?.profile?.data?.id;
        const recipientStr = cohort ? `cohort:${cohort}`
          : email ? `email:${String(email).toLowerCase()}`
          : profile ? `profile:${String(profile).toLowerCase()}`
          : String(it?.id);
        switch (cat) {
          case 'delivered':
            if (!acc.deliveredRecipients) acc.deliveredRecipients = new Set();
            acc.deliveredRecipients.add(recipientStr);
            acc.delivered = acc.deliveredRecipients.size;
            break;
          case 'opened':
            if (!acc.openRecipients) acc.openRecipients = new Set();
            acc.openRecipients.add(recipientStr);
            acc.opens_unique = acc.openRecipients.size;
            break;
          case 'clicked':
            if (!acc.clickRecipients) acc.clickRecipients = new Set();
            acc.clickRecipients.add(recipientStr);
            acc.clicks_unique = acc.clickRecipients.size;
            break;
          case 'unsubscribed':
            if (!acc.unsubscribeRecipients) acc.unsubscribeRecipients = new Set();
            acc.unsubscribeRecipients.add(recipientStr);
            acc.unsubscribes = acc.unsubscribeRecipients.size;
            break;
          case 'spam':
            if (!acc.spamRecipients) acc.spamRecipients = new Set();
            acc.spamRecipients.add(recipientStr);
            acc.spam_complaints = acc.spamRecipients.size;
            break;
          case 'bounced':
            if (!acc.bounceRecipients) acc.bounceRecipients = new Set();
            acc.bounceRecipients.add(recipientStr);
            acc.bounces = acc.bounceRecipients.size;
            break;
          case 'orders':
            if (!acc.conversionRecipients) acc.conversionRecipients = new Set();
            acc.conversionRecipients.add(recipientStr);
            acc.conversion_uniques = acc.conversionRecipients.size;
            // Sum revenue
            const val = getProp(props, ['$value', 'value', 'revenue', '$revenue']);
            if (typeof val === 'number') {
              acc.conversion_value = (acc.conversion_value || 0) + (val || 0);
            }
            break;
        }
      }
      const next = json?.links?.next;
      url = typeof next === 'string' && next ? next : '';
      pages++;
    }
  }

  const tasks: Promise<void>[] = [];
  for (const cat of Object.keys(categoryMetricIds) as MetricCategory[]) {
    const mid = categoryMetricIds[cat];
    if (!mid) continue;
    tasks.push(fetchAndAccumulate(cat, mid).catch(() => {}));
  }
  if (tasks.length) await Promise.all(tasks);

  // Build statistics resembling campaign-values result structure
  const stats: Record<string, number> = {};
  if (typeof acc.delivered === 'number') { stats.delivered = acc.delivered; stats.recipients = acc.delivered; }
  if (typeof acc.opens_unique === 'number') { stats.opens_unique = acc.opens_unique; stats.opens = acc.opens_unique; }
  if (typeof acc.clicks_unique === 'number') { stats.clicks_unique = acc.clicks_unique; stats.clicks = acc.clicks_unique; }
  if (typeof acc.unsubscribes === 'number') stats.unsubscribes = acc.unsubscribes;
  if (typeof acc.spam_complaints === 'number') stats.spam_complaints = acc.spam_complaints;
  if (typeof acc.bounces === 'number') { stats.bounced = acc.bounces; stats.bounces = acc.bounces; }
  if (typeof acc.conversion_uniques === 'number') stats.conversion_uniques = acc.conversion_uniques;
  if (typeof acc.conversion_value === 'number') stats.conversion_value = acc.conversion_value;

  return { statistics: stats };
}

export async function fetchFlowReportResults(params: { apiKey: string; start?: string; end?: string; timeframeKey?: string; conversionMetricId?: string; revision?: string; valueStatistics?: string[]; statistics?: string[]; groupBy?: string[]; debugCallback?: (info: { phase: 'flow-report'; status: number; rawSnippet?: string; resultCount?: number }) => void }): Promise<FlowReportGroupedResult[]> {
  const { apiKey, start, end, timeframeKey, conversionMetricId, revision = process.env.KLAVIYO_API_REVISION || '2024-06-15' } = params;
  const statistics = params.statistics || [
    'recipients','delivered','opens_unique','open_rate','clicks_unique','click_rate','conversion_uniques','conversion_rate','unsubscribe_rate','spam_complaint_rate','bounce_rate'
  ];
  const valueStatistics = params.valueStatistics || ['conversion_value'];
  const combinedStats = Array.from(new Set([...statistics, ...valueStatistics]));
  const url = 'https://a.klaviyo.com/api/flow-values-reports';
  const headers: Record<string,string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  if (!conversionMetricId) {
    return [];
  }
  const attributes: any = {
    statistics: combinedStats,
    conversion_metric_id: conversionMetricId,
    timeframe: timeframeKey ? { key: timeframeKey } : { start, end },
  };
  const body = JSON.stringify({
    data: {
      type: 'flow-values-report',
      attributes,
    },
  });
  try {
    const res = await rateLimiter.run(() => fetch(url, { method: 'POST', headers, body }), 'flow-values');
    if (!res.ok) {
      let txt: string | undefined;
      try { txt = await res.text(); } catch {}
      if (process.env.FLOW_REPORT_DEBUG === 'true') {
        console.error('[flow-report] non-ok status', res.status, txt?.slice(0,500));
      }
      if (typeof params.debugCallback === 'function') {
        try {
          params.debugCallback({ phase: 'flow-report', status: res.status, rawSnippet: (txt || '').slice(0, 2000), resultCount: 0 });
        } catch {
          params.debugCallback({ phase: 'flow-report', status: res.status, resultCount: 0 });
        }
      }
      const err: any = new Error(`flow-values-reports failed ${res.status}: ${txt || ''}`);
      err.status = res.status;
      throw err;
    }
    const json: FlowReportBroadRaw = await res.json().catch(() => ({} as any));
    if (process.env.FLOW_REPORT_DEBUG === 'true' && (!json?.data?.attributes?.results || json.data.attributes.results.length === 0)) {
      console.error('[flow-report] empty results debug snippet:', JSON.stringify(json).slice(0,800));
    }
    const results = json?.data?.attributes?.results;
    if (!Array.isArray(results)) return [];
    if (typeof params.debugCallback === 'function') {
      try {
        params.debugCallback({ phase: 'flow-report', status: 200, rawSnippet: JSON.stringify(json).slice(0, 2000), resultCount: results.length });
      } catch {}
    }
    return results.map(r => {
      const g = r?.groupings || {};
      const s = r?.statistics || {};
      const delivered = Number((s as any).delivered ?? 0);
      const conversionValue = Number((s as any).conversion_value ?? 0);
      return {
        flow_id: g.flow_id,
        flow_message_id: g.flow_message_id,
        flow_action_id: g.flow_action_id,
        send_channel: g.send_channel,
        delivered,
        opens_unique: Number((s as any).opens_unique ?? 0),
        open_rate: Number((s as any).open_rate ?? 0),
        clicks_unique: Number((s as any).clicks_unique ?? 0),
        click_rate: Number((s as any).click_rate ?? 0),
        conversion_uniques: Number((s as any).conversion_uniques ?? 0),
        conversion_rate: Number((s as any).conversion_rate ?? 0),
        unsubscribe_rate: Number((s as any).unsubscribe_rate ?? 0),
        spam_complaint_rate: Number((s as any).spam_complaint_rate ?? 0),
        bounce_rate: Number((s as any).bounce_rate ?? 0),
        revenue: conversionValue,
        conversion_value: conversionValue,
        revenue_per_recipient: delivered ? conversionValue / delivered : 0,
      } as FlowReportGroupedResult;
    });
  } catch {
    return [];
  }
}

export async function fetchFlowReport(params: KlaviyoFlowReportParams): Promise<KlaviyoFlowReportMetrics | null> {
  const {
    apiKey,
    start,
    end,
    flowId,
    flowMessageId,
    flowActionId,
    conversionMetricId,
    revision = process.env.KLAVIYO_API_REVISION || '2024-06-15',
    abortSignal,
  } = params;

  // Build statistics lists (keep minimal set initially; can be expanded)
  const statistics = [
    'delivered',
    'opens_unique',
    'open_rate',
    'clicks_unique',
    'click_rate',
    'conversion_uniques',
    'conversion_rate',
    'unsubscribe_rate',
    'spam_complaint_rate',
    'bounce_rate',
  ];
  const valueStatistics = ['conversion_value'];
  const combinedStats = Array.from(new Set([...statistics, ...valueStatistics]));

  // Filters: we AND flow / message filters when provided
  const filters: string[] = [];
  if (flowId) filters.push(`equals(flow_id,"${flowId}")`);
  if (flowActionId) filters.push(`equals(flow_action_id,"${flowActionId}")`);
  if (flowMessageId) filters.push(`equals(flow_message_id,"${flowMessageId}")`);
  // Combine filters into and(...) expression if more than one
  const filterExpr = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : `and(${filters.join(',')})`;

  if (!conversionMetricId) return null;

  const url = 'https://a.klaviyo.com/api/flow-values-reports';

  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };

  try {
    const body = JSON.stringify({
      data: {
        type: 'flow-values-report',
        attributes: {
          statistics: combinedStats,
          conversion_metric_id: conversionMetricId,
          timeframe: { start, end },
          filter: filterExpr,
        },
      },
    });
    const res = await rateLimiter.run(() => fetch(url, { method: 'POST', headers, body, signal: abortSignal }), 'flow-values');
    if (!res.ok) {
      return null;
    }
    const json: FlowReportBroadRaw = await res.json().catch(() => ({} as any));
    const stats = json?.data?.attributes?.results?.[0]?.statistics || {};
    const delivered = Number((stats as any).delivered ?? 0);
    const conversionValue = Number((stats as any).conversion_value ?? 0);
    return {
      delivered,
      opens_unique: Number((stats as any).opens_unique ?? 0),
      open_rate: Number((stats as any).open_rate ?? 0),
      clicks_unique: Number((stats as any).clicks_unique ?? 0),
      click_rate: Number((stats as any).click_rate ?? 0),
      conversion_uniques: Number((stats as any).conversion_uniques ?? 0),
      conversion_rate: Number((stats as any).conversion_rate ?? 0),
      unsubscribe_rate: Number((stats as any).unsubscribe_rate ?? 0),
      spam_complaint_rate: Number((stats as any).spam_complaint_rate ?? 0),
      bounce_rate: Number((stats as any).bounce_rate ?? 0),
      revenue: conversionValue,
      revenue_per_recipient: delivered ? conversionValue / delivered : 0,
    } as KlaviyoFlowReportMetrics;
  } catch (_e) {
    return null; // swallow network errors; treat as missing
  }
}

// Fetch all flows from Klaviyo
export async function fetchFlows(
  apiKey: string, 
  opts: { pageSize?: number; maxPages?: number; revision?: string } = {}
): Promise<KlaviyoFlowRaw[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 50);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 10, 1), 100);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';

  const base = 'https://a.klaviyo.com/api/flows';
  const fields = 'fields[flow]=name,status,created,updated,trigger_type,archived';
  let url = `${base}?page[size]=${pageSize}&${fields}`;
  
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };

  const results: KlaviyoFlowRaw[] = [];
  let pages = 0;
  
  while (pages < maxPages && url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo flows fetch failed ${res.status}: ${text}`);
    }
    
    const json: any = await res.json();
    const data: KlaviyoFlowRaw[] = Array.isArray(json?.data) ? json.data : [];
    results.push(...data);
    
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
  }
  
  return results;
}

// Fetch single flow detail including actions to derive message IDs
export async function fetchFlowDetail(
  apiKey: string,
  flowId: string,
  opts: { revision?: string } = {}
): Promise<{ raw: any; messageIds: string[] }> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const url = `https://a.klaviyo.com/api/flows/${encodeURIComponent(flowId)}`;
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Klaviyo flow detail fetch failed ${res.status}: ${text}`);
  }
  const json: any = await res.json().catch(() => ({}));
  const msgs = await fetchFlowMessages(apiKey, flowId, { revision, pageSize: 50, maxPages: 5 });
  const messageIds = msgs.map(m => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  return { raw: json, messageIds };
}

export async function fetchFlowActions(
  apiKey: string,
  flowId: string,
  opts: { pageSize?: number; maxPages?: number; revision?: string } = {}
): Promise<KlaviyoFlowActionRaw[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 50);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 10, 1), 100);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';

  const base = `https://a.klaviyo.com/api/flows/${encodeURIComponent(flowId)}/flow-actions`;
  let url = `${base}?page[size]=${pageSize}`;

  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };

  const results: KlaviyoFlowActionRaw[] = [];
  let pages = 0;
  while (pages < maxPages && url) {
    const res = await rateLimiter.run(() => fetch(url, { headers }), `flow-actions ${flowId}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`Klaviyo flow actions fetch failed ${res.status}: ${text}`);
      err.status = res.status;
      err.headers = Object.fromEntries(res.headers.entries());
      throw err;
    }
    const json: any = await res.json();
    const data: KlaviyoFlowActionRaw[] = Array.isArray(json?.data) ? json.data : [];
    results.push(...data);
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
  }

  return results;
}

async function fetchFlowMessagesForAction(
  apiKey: string,
  actionId: string,
  opts: { pageSize?: number; maxPages?: number; revision?: string } = {}
): Promise<KlaviyoFlowMessageRaw[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 50);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 3, 1), 100);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';

  const base = `https://a.klaviyo.com/api/flow-actions/${encodeURIComponent(actionId)}/flow-messages`;
  const fields = 'fields[flow-message]=name,channel,created,updated';
  let url = `${base}?page[size]=${pageSize}&${fields}`;

  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };

  const results: KlaviyoFlowMessageRaw[] = [];
  let pages = 0;
  while (pages < maxPages && url) {
    const res = await rateLimiter.run(() => fetch(url, { headers }), `flow-messages ${actionId}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`Klaviyo flow messages fetch failed ${res.status}: ${text}`);
      err.status = res.status;
      err.headers = Object.fromEntries(res.headers.entries());
      throw err;
    }
    const json: any = await res.json();
    const data: KlaviyoFlowMessageRaw[] = Array.isArray(json?.data) ? json.data : [];
    results.push(...data);
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
  }
  return results;
}

// Fetch flow messages for a specific flow via flow-actions relationship
export async function fetchFlowMessages(
  apiKey: string,
  flowId: string,
  opts: { pageSize?: number; maxPages?: number; revision?: string } = {}
): Promise<KlaviyoFlowMessageRaw[]> {
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';
  const actions = await fetchFlowActions(apiKey, flowId, {
    pageSize: opts.pageSize,
    maxPages: opts.maxPages,
    revision,
  });

  const results: KlaviyoFlowMessageRaw[] = [];
  const MESSAGE_ACTION_TYPES = new Set([
    'SEND_EMAIL',
    'SEND_SMS',
    'SEND_PUSH_NOTIFICATION',
    'SEND_NOTIFICATION_MESSAGE',
  ]);

  const deriveActionName = (action: KlaviyoFlowActionRaw): string | undefined => {
    const direct = action?.attributes?.name;
    if (direct) return direct;
    const settings = action?.attributes?.settings;
    if (settings) {
      if (typeof settings.name === 'string' && settings.name) return settings.name;
      if (typeof settings.subject === 'string' && settings.subject) return settings.subject;
      if (typeof settings.label === 'string' && settings.label) return settings.label;
    }
    const render = action?.attributes?.render_options;
    if (render && typeof render.component_name === 'string' && render.component_name) return render.component_name;
    return undefined;
  };

  const channelFromType = (actionType: string): string => {
    if (!actionType) return 'Email';
    if (actionType.includes('SMS')) return 'SMS';
    if (actionType.includes('PUSH')) return 'Push';
    return 'Email';
  };

  for (const action of actions) {
    const actionId = action?.id;
    if (!actionId) continue;
    const type = String(action?.attributes?.action_type || '').toUpperCase();
    if (MESSAGE_ACTION_TYPES.size && !MESSAGE_ACTION_TYPES.has(type)) continue;
    const messages = await fetchFlowMessagesForAction(apiKey, actionId, {
      revision,
      pageSize: opts.pageSize,
      maxPages: opts.maxPages,
    });
    if (messages.length === 0) {
      // Provide a stub entry tied to the action so downstream mapping can still resolve metadata
      results.push({
        id: actionId,
        type: 'flow-message',
        attributes: { name: deriveActionName(action), channel: channelFromType(type).toLowerCase() },
        relationships: {
          flow: { data: { id: flowId, type: 'flow' } },
          flow_action: { data: { id: actionId, type: action?.type || 'flow-action' } },
        },
        flowActionId: actionId,
      });
      continue;
    }
    for (const msg of messages) {
      if (!msg.relationships) msg.relationships = {};
      if (!msg.relationships.flow) {
        msg.relationships.flow = { data: { id: flowId, type: 'flow' } };
      }
      msg.relationships.flow_action = { data: { id: actionId, type: action?.type || 'flow-action' } };
      if (!msg.attributes) msg.attributes = {};
      if (!msg.attributes.name) {
        const fallbackName = deriveActionName(action);
        if (fallbackName) msg.attributes.name = fallbackName;
      }
      if (!msg.attributes.channel) {
        msg.attributes.channel = channelFromType(type).toLowerCase();
      }
      msg.flowActionId = actionId;
      results.push(msg);
    }
  }

  return results;
}

// Fetch flow analytics data with comprehensive metrics
export async function fetchFlowAnalytics(
  apiKey: string,
  opts: { 
    pageSize?: number; 
    maxPages?: number; 
    revision?: string; 
    flowId?: string;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<FlowAnalyticsEntry[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 50);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 20, 1), 100);
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';

  const base = 'https://a.klaviyo.com/api/flow-message-analytics';
  const fields = [
    'fields[flow-message-analytic]=send_time,flow_message_id,flow_id,flow_name,flow_message_name',
    'delivered,unique_opens,open_rate,unique_clicks,click_rate',
    'placed_orders,placed_order_rate,revenue,revenue_per_recipient',
    'unsubscribes,unsubscribe_rate,spam_complaints,complaint_rate,bounces,bounce_rate'
  ].join(',');

  const filters: string[] = [];
  if (opts.flowId) {
    filters.push(`equals(flow_id,"${opts.flowId}")`);
  }
  if (opts.startDate) {
    filters.push(`greater-or-equal(send_time,"${opts.startDate}")`);
  }
  if (opts.endDate) {
    filters.push(`less-or-equal(send_time,"${opts.endDate}")`);
  }
  
  const filterParam = filters.length > 0 ? `&filter=${encodeURIComponent(filters.length > 1 ? `and(${filters.join(',')})` : filters[0])}` : '';
  let url = `${base}?page[size]=${pageSize}&${fields}&sort=-send_time${filterParam}`;
  
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision,
  };

  const results: FlowAnalyticsEntry[] = [];
  let pages = 0;
  
  while (pages < maxPages && url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Klaviyo flow analytics fetch failed ${res.status}: ${text}`);
    }
    
    const json: any = await res.json();
    const data: FlowAnalyticsRaw[] = Array.isArray(json?.data) ? json.data : [];
    
    for (const item of data) {
      const attrs = item.attributes || {};
      const sendTime = attrs.send_time || '';
      const day = sendTime ? sendTime.split('T')[0] : '';
      
      results.push({
        day,
        flowId: attrs.flow_id || '',
        flowName: attrs.flow_name || '',
        flowMessageId: attrs.flow_message_id || '',
        flowMessageName: attrs.flow_message_name || '',
        channel: 'Email', // Most flow messages are email
        status: 'live', // Default status
        delivered: attrs.delivered || 0,
        uniqueOpens: attrs.unique_opens || 0,
        openRate: attrs.open_rate || 0,
        uniqueClicks: attrs.unique_clicks || 0,
        clickRate: attrs.click_rate || 0,
        placedOrders: attrs.placed_orders || 0,
        placedOrderRate: attrs.placed_order_rate || 0,
        revenue: attrs.revenue || 0,
        revenuePerRecipient: attrs.revenue_per_recipient || 0,
        unsubscribeRate: attrs.unsubscribe_rate || 0,
        complaintRate: attrs.complaint_rate || 0,
        bounceRate: attrs.bounce_rate || 0,
      });
    }
    
    const next = json?.links?.next;
    url = typeof next === 'string' && next ? next : '';
    pages++;
  }
  
  return results;
}
