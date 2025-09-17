// Minimal Klaviyo → subscribers.csv mapping for Audience (all_subscribers segment)
// This file is intentionally small and self-contained. It does not fetch data.
// It only maps already-fetched Klaviyo Profiles into our canonical CSV row shape
// that is compatible with parseSubscribers() in lib/snapshotBuilder.ts.

export interface KlaviyoProfileMinimal {
  id: string;
  email: string;
  created?: string; // ISO 8601
  first_name?: string | null;
  last_name?: string | null;
  // Extended optional fields
  updated?: string | null;
  last_event_date?: string | null;
  first_active?: string | null;
  last_open?: string | null;
  last_click?: string | null;
  external_id?: string | null;
  phone_number?: string | null;
  locale?: string | null;
  organization?: string | null;
  title?: string | null;
  image?: string | null;
  location?: any | null;
  subscriptions?: any | null;
  properties?: any | null;
  predictive_analytics?: any | null;
}

// Canonical subscribers.csv headers we support today
// - Email
// - Email Marketing Consent
// - Created At
// - Klaviyo ID (optional but helpful)
// - First Name (optional)
// - Last Name (optional)

export type SubscribersCsvRow = {
  Email: string;
  'Email Marketing Consent': string; // e.g., "Subscribed" (for all_subscribers), "Unsubscribed"
  'Created At'?: string;
  'Klaviyo ID'?: string;
  'First Name'?: string;
  'Last Name'?: string;
};

// Extended CSV row shape including more Klaviyo attributes
export type SubscribersCsvRowExtended = SubscribersCsvRow & {
  'Updated At'?: string;
  'Last Event Date'?: string;
  'External ID'?: string;
  'Phone Number'?: string;
  Locale?: string;
  Organization?: string;
  Title?: string;
  Image?: string;
  Location?: string;
  'Email Subscription Status'?: string;
  'Email Subscription Method'?: string;
  'Email Subscription Timestamp'?: string;
  'SMS Subscription Status'?: string;
  'SMS Subscription Method'?: string;
  'SMS Subscription Timestamp'?: string;
  'Properties JSON'?: string;
  'Predictive Analytics JSON'?: string;
};

// Exact required columns per user request
export type RequiredCsvRow = {
  Email: string;
  'Klaviyo ID': string;
  'First Name'?: string;
  'Last Name'?: string;
  'Email Marketing Consent'?: string;
  'Email Suppressions'?: string;
  'Email Suppressions Timestamp'?: string;
  'First Active'?: string;
  'Last Active'?: string;
  'Profile Created On'?: string;
  'Last Open'?: string;
  'Last Click'?: string;
  'Total Customer Lifetime Value'?: string | number;
  'Predicted Customer Lifetime Value'?: string | number;
  'Predicted Number Of Orders'?: string | number;
  'Average Order Value'?: string | number;
  'Average Days Between Orders'?: string | number;
  'Historic Customer Lifetime Value'?: string | number;
  'Historic Number Of Orders'?: string | number;
  'Expected Date Of Next Order'?: string;
};

export function mapProfilesToRequiredCsvRows(profiles: KlaviyoProfileMinimal[]): RequiredCsvRow[] {
  const getEmail = (p: any) => p?.subscriptions?.email?.marketing || p?.subscriptions?.email || {};
  const getNumber = (v: any) => (v === undefined || v === null ? undefined : Number(v));
  return profiles
    .filter((p) => !!p?.email)
    .map((p) => {
      const email = getEmail(p);
      const pa = p?.predictive_analytics || {};
      // Build suppression tokens and timestamp only when suppressions array exists
      let suppressionTokens: string[] | undefined = undefined;
      let suppressionTimestamp: string | undefined = undefined;
      if (Array.isArray((email as any)?.suppressions) && (email as any).suppressions.length > 0) {
        const arr = (email as any).suppressions;
        suppressionTokens = arr
          .map((x: any) => (typeof x === 'string' ? x : (x?.reason || 'SUPPRESSED')))
          .map((s: string) => s.toUpperCase())
          .filter(Boolean);
        const ts = arr
          .map((x: any) => x?.timestamp)
          .filter((t: any) => !!t)
          .sort()
          .pop();
        suppressionTimestamp = ts || undefined;
      }
      const row: RequiredCsvRow = {
        Email: p.email,
        'Klaviyo ID': p.id,
        'First Name': p.first_name ?? undefined,
        'Last Name': p.last_name ?? undefined,
  // Prefer explicit consent if provided; fallback to status (e.g., NEVER_SUBSCRIBED).
  'Email Marketing Consent': (email?.consent || email?.status) ?? undefined,
  'Email Suppressions': suppressionTokens ? JSON.stringify(suppressionTokens) : undefined,
  'Email Suppressions Timestamp': suppressionTimestamp || undefined,
        'First Active': p.first_active || undefined,
        'Last Active': p.last_event_date || undefined,
        'Profile Created On': p.created || undefined,
        'Last Open': p.last_open || undefined,
        'Last Click': p.last_click || undefined,
        'Total Customer Lifetime Value': getNumber(pa?.total_clv),
        'Predicted Customer Lifetime Value': getNumber(pa?.predicted_clv),
        'Predicted Number Of Orders': getNumber(pa?.predicted_number_of_orders),
        'Average Order Value': getNumber(pa?.average_order_value),
        'Average Days Between Orders': getNumber(pa?.average_days_between_orders),
        'Historic Customer Lifetime Value': getNumber(pa?.historic_clv),
        'Historic Number Of Orders': getNumber(pa?.historic_number_of_orders),
        'Expected Date Of Next Order': pa?.expected_date_of_next_order || undefined,
      };
      return row;
    });
}

export function toCsvWithHeaders(rows: any[], headers: string[]): string {
  const escape = (v: any) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape((row as any)[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Map Klaviyo Profiles belonging to the all_subscribers segment into
 * subscribers.csv-compatible rows. For this initial audience-only sync,
 * we mark consent as "Subscribed" for all provided profiles.
 */
export function mapProfilesToSubscribersCsvRows(
  profiles: KlaviyoProfileMinimal[]
): SubscribersCsvRow[] {
  return profiles
    .filter((p) => !!p?.email)
    .map((p) => ({
      Email: p.email,
      'Email Marketing Consent': 'Subscribed',
      'Created At': p.created,
      'Klaviyo ID': p.id,
      'First Name': p.first_name ?? undefined,
      'Last Name': p.last_name ?? undefined,
    }));
}

// Extended mapping capturing more fields; JSON-serialize complex objects for safety
export function mapProfilesToSubscribersCsvRowsExtended(
  profiles: KlaviyoProfileMinimal[]
): SubscribersCsvRowExtended[] {
  const safe = (v: any) => (v === undefined || v === null ? undefined : String(v));
  const getEmailStatus = (p: any): { status?: string; method?: string; timestamp?: string } => {
    const m = p?.subscriptions?.email?.marketing || p?.subscriptions?.email;
    return {
      status: m?.status,
      method: m?.method,
      timestamp: m?.timestamp,
    };
  };
  const getSmsStatus = (p: any): { status?: string; method?: string; timestamp?: string } => {
    const m = p?.subscriptions?.sms?.marketing || p?.subscriptions?.sms;
    return {
      status: m?.status,
      method: m?.method,
      timestamp: m?.timestamp,
    };
  };
  return profiles
    .filter((p) => !!p?.email)
    .map((p) => {
      const email = getEmailStatus(p);
      const sms = getSmsStatus(p);
      return {
        Email: p.email,
        'Email Marketing Consent': 'Subscribed',
        'Created At': p.created,
        'Klaviyo ID': p.id,
        'First Name': p.first_name ?? undefined,
        'Last Name': p.last_name ?? undefined,
        'Updated At': safe(p.updated),
        'Last Event Date': safe(p.last_event_date),
        'External ID': safe(p.external_id),
        'Phone Number': safe(p.phone_number),
        Locale: safe(p.locale),
        Organization: safe(p.organization),
        Title: safe(p.title),
        Image: safe(p.image),
        Location: p.location ? JSON.stringify(p.location) : undefined,
        'Email Subscription Status': safe(email.status),
        'Email Subscription Method': safe(email.method),
        'Email Subscription Timestamp': safe(email.timestamp),
        'SMS Subscription Status': safe(sms.status),
        'SMS Subscription Method': safe(sms.method),
        'SMS Subscription Timestamp': safe(sms.timestamp),
        'Properties JSON': p.properties ? JSON.stringify(p.properties) : undefined,
        'Predictive Analytics JSON': p.predictive_analytics ? JSON.stringify(p.predictive_analytics) : undefined,
      };
    });
}

/**
 * Generate a CSV string from mapped subscriber rows using a minimal
 * header-first approach (no external dependency). Values are escaped
 * with double quotes when they contain commas, quotes, or newlines.
 */
export function toCsv(rows: (SubscribersCsvRow | SubscribersCsvRowExtended)[], extended = false): string {
  const headers: string[] = extended
    ? [
        'Email',
        'Email Marketing Consent',
        'Created At',
        'Klaviyo ID',
        'First Name',
        'Last Name',
        'Updated At',
        'Last Event Date',
        'External ID',
        'Phone Number',
        'Locale',
        'Organization',
        'Title',
        'Image',
        'Location',
        'Email Subscription Status',
        'Email Subscription Method',
        'Email Subscription Timestamp',
        'SMS Subscription Status',
        'SMS Subscription Method',
        'SMS Subscription Timestamp',
        'Properties JSON',
        'Predictive Analytics JSON',
      ]
    : [
        'Email',
        'Email Marketing Consent',
        'Created At',
        'Klaviyo ID',
        'First Name',
        'Last Name',
      ];

  const escape = (v: any) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape((row as any)[h])).join(','));
  }
  return lines.join('\n') + '\n';
}
