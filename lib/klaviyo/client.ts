export interface KlaviyoApiProfileRaw {
  id: string;
  type?: string;
  attributes?: any;
}

export interface FetchProfilesOptions {
  pageSize?: number; // default 100
  maxPages?: number; // safety cap
  revision?: string; // Klaviyo API revision header
}

export interface SubscribedProfileMinimal {
  id: string;
  email: string;
  created?: string;
  first_name?: string | null;
  last_name?: string | null;
}

function isSuppressedOrUnsubscribed(attrs: any): boolean {
  if (!attrs) return false; // default to not suppressed when unknown
  // Explicit suppression indicators
  if (attrs?.email_suppressed === true) return true;
  const sup = attrs?.suppressions;
  if (Array.isArray(sup) && sup.length > 0) return true;
  const status = attrs?.subscriptions?.email?.marketing?.status || attrs?.email_marketing_consent || attrs?.subscriptions?.email?.marketing?.consent;
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
  return {
    id: p.id,
    email,
    created: a?.created || a?.created_at || a?.profile_created || undefined,
    first_name: a?.first_name ?? a?.firstName ?? null,
    last_name: a?.last_name ?? a?.lastName ?? null,
  };
}

export async function fetchAllSubscribedProfiles(apiKey: string, opts: FetchProfilesOptions = {}): Promise<SubscribedProfileMinimal[]> {
  // Klaviyo enforces page size between 1 and 100
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 100, 1), 1000); // hard safety cap
  const revision = opts.revision || process.env.KLAVIYO_API_REVISION || '2024-06-15';

  // Base URL for Klaviyo Profiles API (JSON:API). We ask for only the fields we need.
  const base = 'https://a.klaviyo.com/api/profiles';
  // Request only valid fields per Klaviyo Profiles JSON:API
  // Allowed examples: email, first_name, last_name, created, subscriptions, etc.
  const fields = 'fields[profile]=email,first_name,last_name,created,subscriptions';
  // No server-side filter: we include all and filter client-side to remove suppressed/unsubscribed.

  const additional = 'additional-fields[profile]=subscriptions';
  let url = `${base}?page[size]=${pageSize}&${fields}&${additional}`;
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
