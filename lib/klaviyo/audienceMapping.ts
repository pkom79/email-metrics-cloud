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

/**
 * Generate a CSV string from mapped subscriber rows using a minimal
 * header-first approach (no external dependency). Values are escaped
 * with double quotes when they contain commas, quotes, or newlines.
 */
export function toCsv(rows: SubscribersCsvRow[]): string {
  const headers: (keyof SubscribersCsvRow)[] = [
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
