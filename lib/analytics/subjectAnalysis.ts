import type { ProcessedCampaign } from "../data/dataTypes";

export type SubjectMetricKey = 'openRate' | 'clickToOpenRate' | 'clickRate' | 'revenuePerEmail';

export interface MetricAggregate {
  countCampaigns: number;
  totalEmails: number;
  totalOpens: number;
  totalClicks: number;
  totalRevenue: number;
  value: number; // computed metric value for the aggregate
}

export interface FeatureStat extends MetricAggregate {
  key: string;
  label: string;
  liftVsBaseline: number; // value - baseline (pp for rates, absolute for currency)
  examples?: string[]; // sample subjects included in this feature
}

export interface LengthBinStat extends FeatureStat {
  range: [number, number] | [number, null];
}

export interface ReuseStat {
  subject: string;
  occurrences: number;
  firstValue: number;
  lastValue: number;
  change: number; // last - first
  totalEmails: number;
}

export interface SubjectAnalysisResult {
  baseline: MetricAggregate;
  lengthBins: LengthBinStat[];
  keywordEmojis: FeatureStat[];
  punctuationCasing: FeatureStat[];
  deadlines: FeatureStat[];
  personalization: FeatureStat[];
  priceAnchoring: FeatureStat[];
  imperativeStart: FeatureStat[];
  reuse: ReuseStat[];
}

// --- Helpers ---

function getMetricParts(c: ProcessedCampaign, metric: SubjectMetricKey) {
  switch (metric) {
    case 'openRate':
      return { numerator: c.uniqueOpens, denom: c.emailsSent };
    case 'clickRate':
      return { numerator: c.uniqueClicks, denom: c.emailsSent };
    case 'clickToOpenRate':
      return { numerator: c.uniqueClicks, denom: c.uniqueOpens };
    case 'revenuePerEmail':
      return { numerator: c.revenue, denom: c.emailsSent };
  }
}

function computeAggregate(campaigns: ProcessedCampaign[], metric: SubjectMetricKey): MetricAggregate {
  let num = 0, den = 0, emails = 0, opens = 0, clicks = 0, rev = 0;
  for (const c of campaigns) {
    const { numerator, denom } = getMetricParts(c, metric);
    num += numerator || 0;
    den += denom || 0;
    emails += c.emailsSent || 0;
    opens += c.uniqueOpens || 0;
    clicks += c.uniqueClicks || 0;
    rev += c.revenue || 0;
  }
  const value = den > 0 ? (num / den) * (metric === 'revenuePerEmail' ? 1 : 100) : 0;
  return { countCampaigns: campaigns.length, totalEmails: emails, totalOpens: opens, totalClicks: clicks, totalRevenue: rev, value };
}

function toLengthBin(len: number): { key: string; label: string; range: [number, number] | [number, null] } {
  if (len <= 30) return { key: '0-30', label: '0–30', range: [0, 30] };
  if (len <= 50) return { key: '31-50', label: '31–50', range: [31, 50] };
  if (len <= 70) return { key: '51-70', label: '51–70', range: [51, 70] };
  return { key: '71+', label: '71+', range: [71, null] };
}

// Simple emoji presence detection; modern Node supports Extended_Pictographic
const EMOJI_RE = /\p{Extended_Pictographic}/u;

// Lexicons
const DEADLINE_WORDS = [
  'today', 'tonight', 'now', 'ends', 'expires', 'last chance', 'final', 'hours', 'left', 'midnight', '24 hours', 'ending', 'deadline'
];

const IMPERATIVE_START = [
  'shop', 'save', 'get', 'discover', 'buy', 'grab', 'claim', 'enjoy', 'see', 'explore', 'find', 'unlock', 'upgrade', 'try'
];

const KEYWORD_TOKENS = [
  // Discounts / offer
  'sale', 'deal', 'offer', 'discount', '% off', 'off', 'free', 'save', 'new', 'bestseller', 'best seller', 'just in', 'limited', 'exclusive'
];

function normalize(s: string): string { return (s || '').toString().trim(); }

function includesWord(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (n.includes(' ')) return h.includes(n);
  return new RegExp(`(^|[^a-zA-Z])${n}([^a-zA-Z]|$)`).test(h);
}

function isImperativeStart(subject: string): boolean {
  const s = subject.trim().replace(/^\W+/, '');
  const first = s.split(/\s+/)[0] || '';
  return IMPERATIVE_START.includes(first.toLowerCase());
}

function hasAllCapsWord(subject: string): boolean {
  return /\b[A-Z]{2,}\b/.test(subject.replace(/[A-Z]{2,}\d+/g, 'X')); // crude, ignore hex codes etc.
}

function hasPercent(subject: string): boolean { return subject.includes('%'); }
function hasNumber(subject: string): boolean { return /\d/.test(subject); }
function hasCurrency(subject: string): boolean { return /[$£€]/.test(subject); }
function hasPriceNumber(subject: string): boolean { return /[$£€]\s?\d|\d+(?:\.\d{2})?/.test(subject); }

function hasPersonalization(subject: string): { youYour: boolean; firstNameToken: boolean } {
  const s = subject.toLowerCase();
  const youYour = /\b(you|your|you’re|you're)\b/.test(s);
  const firstNameToken = /\{\s*first\s*name\s*\}|\{\s*first[_\s-]?name\s*\}|%first_name%|\*\|first_name\|\*/i.test(subject);
  return { youYour, firstNameToken };
}

function computeFeatureGroup(
  campaigns: ProcessedCampaign[],
  metric: SubjectMetricKey,
  label: string,
  predicate: (subject: string) => boolean,
  key: string = label
): FeatureStat {
  const subset: ProcessedCampaign[] = [];
  for (const c of campaigns) { if (predicate(c.subject || c.campaignName || '')) subset.push(c); }
  const agg = computeAggregate(subset, metric);
  const baseline = computeAggregate(campaigns, metric);
  const examples = subset
    .slice()
    .sort((a, b) => (b.emailsSent || 0) - (a.emailsSent || 0))
    .map(c => normalize(c.subject || c.campaignName || ''))
    .filter(Boolean)
    .slice(0, 5);
  return { key, label, countCampaigns: agg.countCampaigns, totalEmails: agg.totalEmails, totalOpens: agg.totalOpens, totalClicks: agg.totalClicks, totalRevenue: agg.totalRevenue, value: agg.value, liftVsBaseline: agg.value - baseline.value, examples };
}

export function filterBySegment(campaigns: ProcessedCampaign[], segment?: string | null): ProcessedCampaign[] {
  if (!segment || segment === 'ALL_SEGMENTS') return campaigns;
  return campaigns.filter(c => Array.isArray(c.segmentsUsed) && c.segmentsUsed.some(s => s === segment));
}

export function computeSubjectAnalysis(
  campaignsIn: ProcessedCampaign[],
  metric: SubjectMetricKey,
  segment?: string | null
): SubjectAnalysisResult {
  const campaigns = filterBySegment(campaignsIn, segment);

  const baseline = computeAggregate(campaigns, metric);

  // Length bins
  const byBin = new Map<string, ProcessedCampaign[]>();
  const binInfo = new Map<string, ReturnType<typeof toLengthBin>>();
  for (const c of campaigns) {
    const s = normalize(c.subject || c.campaignName || '');
    const b = toLengthBin(s.length);
    binInfo.set(b.key, b);
    const arr = byBin.get(b.key) || [];
    arr.push(c);
    byBin.set(b.key, arr);
  }
  const lengthBins: LengthBinStat[] = Array.from(byBin.entries()).map(([key, list]) => {
    const agg = computeAggregate(list, metric);
    const info = binInfo.get(key)!;
    const examples = list
      .slice()
      .sort((a, b) => (b.emailsSent || 0) - (a.emailsSent || 0))
      .map(c => normalize(c.subject || c.campaignName || ''))
      .filter(Boolean)
      .slice(0, 5);
    return { key, label: info.label, range: info.range, countCampaigns: agg.countCampaigns, totalEmails: agg.totalEmails, totalOpens: agg.totalOpens, totalClicks: agg.totalClicks, totalRevenue: agg.totalRevenue, value: agg.value, liftVsBaseline: agg.value - baseline.value, examples };
  }).sort((a, b) => a.label.localeCompare(b.label));

  // Keyword & emoji presence (curated tokens)
  const keywordEmojis: FeatureStat[] = [
    computeFeatureGroup(campaigns, metric, 'Emoji present', (s) => EMOJI_RE.test(s), 'emoji'),
    ...KEYWORD_TOKENS.map(tok => computeFeatureGroup(campaigns, metric, tok, (s) => includesWord(s, tok), `kw:${tok}`)),
  ]
    .filter(f => f.countCampaigns > 0)
    .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline) || (b.totalEmails - a.totalEmails));

  // Punctuation & casing
  const punctuationCasing: FeatureStat[] = [
    computeFeatureGroup(campaigns, metric, 'Has question mark (?)', s => s.includes('?'), 'qmark'),
    computeFeatureGroup(campaigns, metric, 'Has exclamation (!)', s => s.includes('!'), 'exclaim'),
    computeFeatureGroup(campaigns, metric, 'Has ALL CAPS word', hasAllCapsWord, 'allcaps'),
    computeFeatureGroup(campaigns, metric, 'Has number', hasNumber, 'number'),
    computeFeatureGroup(campaigns, metric, 'Has %', hasPercent, 'percent'),
    computeFeatureGroup(campaigns, metric, 'Has brackets/parentheses', s => /[\[\](){}]/.test(s), 'brackets'),
  ]
    .filter(f => f.countCampaigns > 0)
    .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline) || (b.totalEmails - a.totalEmails));

  // Deadlines
  const deadlines: FeatureStat[] = DEADLINE_WORDS
    .map(w => computeFeatureGroup(campaigns, metric, w, s => includesWord(s, w), `deadline:${w}`))
    .filter(f => f.countCampaigns > 0)
    .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline) || (b.totalEmails - a.totalEmails));

  // Personalization
  const personalization: FeatureStat[] = [
    computeFeatureGroup(campaigns, metric, 'Contains “you/your”', s => hasPersonalization(s).youYour, 'p:you'),
    computeFeatureGroup(campaigns, metric, 'Has first-name token', s => hasPersonalization(s).firstNameToken, 'p:first'),
  ]
    .filter(f => f.countCampaigns > 0)
    .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline) || (b.totalEmails - a.totalEmails));

  // Price anchoring
  const priceAnchoring: FeatureStat[] = [
    computeFeatureGroup(campaigns, metric, 'Has currency ($/£/€)', hasCurrency, 'cur'),
    computeFeatureGroup(campaigns, metric, 'Has numeric price', hasPriceNumber, 'price'),
    computeFeatureGroup(campaigns, metric, 'Has % discount', hasPercent, 'pct'),
  ]
    .filter(f => f.countCampaigns > 0)
    .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline) || (b.totalEmails - a.totalEmails));

  // Imperative start
  const imperativeStart: FeatureStat[] = [
    computeFeatureGroup(campaigns, metric, 'Starts with a verb (Shop/Save/Get…)', isImperativeStart, 'imperative')
  ];

  // Reuse fatigue — exact match only
  const bySubject = new Map<string, ProcessedCampaign[]>();
  for (const c of campaigns) {
    const key = normalize(c.subject || c.campaignName || '');
    const arr = bySubject.get(key) || [];
    arr.push(c);
    bySubject.set(key, arr);
  }
  const reuse: ReuseStat[] = [];
  for (const [subj, list] of bySubject.entries()) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => a.sentDate.getTime() - b.sentDate.getTime());
    const firstAgg = computeAggregate([sorted[0]], metric);
    const lastAgg = computeAggregate([sorted[sorted.length - 1]], metric);
    const totalEmails = sorted.reduce((s, c) => s + (c.emailsSent || 0), 0);
    reuse.push({ subject: subj, occurrences: sorted.length, firstValue: firstAgg.value, lastValue: lastAgg.value, change: lastAgg.value - firstAgg.value, totalEmails });
  }
  reuse.sort((a, b) => b.totalEmails - a.totalEmails);

  return { baseline, lengthBins, keywordEmojis, punctuationCasing, deadlines, personalization, priceAnchoring, imperativeStart, reuse };
}

export function uniqueSegmentsFromCampaigns(campaigns: ProcessedCampaign[]): string[] {
  const set = new Set<string>();
  for (const c of campaigns) {
    for (const s of c.segmentsUsed || []) { if (s && s.trim()) set.add(s); }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
