import type { ProcessedCampaign } from "../data/dataTypes";
import { twoProportionZTest, fishersExactTwoSided, benjaminiHochberg, bootstrapDiffCI, winsorize } from "./stats";

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
  liftVsBaseline: number; // relative % change vs baseline: (value - baseline) / baseline * 100
  examples?: string[]; // sample subjects included in this feature
  // Top matched phrases for this category in the selected window (campaign-level presence counts)
  usedTerms?: Array<{ term: string; count: number }>;
  // Reliability fields (optional; when significance gating is applied)
  reliable?: boolean;
  method?: 'z' | 'fisher' | 'bootstrap' | 'none';
  pAdj?: number; // adjusted p-value for rate metrics
  ci95?: { lo: number; hi: number } | null; // for RPE
}

export interface LengthBinStat extends FeatureStat {
  range: [number, number] | [number, null];
}

export interface ReuseStat {
  subject: string;
  occurrences: number;
  firstValue: number;
  lastValue: number;
  change: number; // relative % change: (last - first) / first * 100
  totalEmails: number;
}

export interface SubjectAnalysisResult {
  baseline: MetricAggregate;
  lengthBins: LengthBinStat[];
  // Category-level groups (each item is a category entry)
  categories: FeatureStat[];
  // Legacy groups below kept for compatibility with existing UI (will be derived from categories when needed)
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
  // Legacy tokens retained for backwards compatibility with UI mapping; categories will supersede
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
function hasCurrency(subject: string): boolean { return /[$£€]/.test(subject); }

// Has number (exclude currency & %, exclude alphanumeric mixes like 4Runner; keep years)
function hasStandaloneNumber(subject: string): boolean {
  const s = subject || '';
  const re = /\d+[\d.,]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const prev = start > 0 ? s[start - 1] : '';
    const next = end < s.length ? s[end] : '';
    // Exclude if adjacent to a letter (alphanumeric like 4Runner)
    if ((/[A-Za-z]/.test(prev)) || (/[A-Za-z]/.test(next))) continue;
    // Exclude if currency symbol immediately before
    if (prev && /[$£€]/.test(prev)) continue;
    // Exclude if followed by % (allow whitespace)
    const afterSlice = s.slice(end).trimStart();
    if (afterSlice.startsWith('%')) continue;
    // Looks like a standalone number
    return true;
  }
  return false;
}

// Has $ discount (e.g., Save $100, $100 off, Get $20 back)
function hasDollarDiscount(subject: string): boolean {
  const s = subject || '';
  const pat1 = /(save|get|take)\s+\$\s?\d[\d,]*(?:[.\,]\d{2})?/i;
  const pat2 = /\$\s?\d[\d,]*(?:[.\,]\d{2})?\s*(off|back|rebate|credit|discount|savings)/i;
  return pat1.test(s) || pat2.test(s);
}

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
  const lift = baseline.value > 0 ? ((agg.value - baseline.value) / baseline.value) * 100 : 0;
  return { key, label, countCampaigns: agg.countCampaigns, totalEmails: agg.totalEmails, totalOpens: agg.totalOpens, totalClicks: agg.totalClicks, totalRevenue: agg.totalRevenue, value: agg.value, liftVsBaseline: lift, examples };
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
  const lift = baseline.value > 0 ? ((agg.value - baseline.value) / baseline.value) * 100 : 0;
  return { key, label: info.label, range: info.range, countCampaigns: agg.countCampaigns, totalEmails: agg.totalEmails, totalOpens: agg.totalOpens, totalClicks: agg.totalClicks, totalRevenue: agg.totalRevenue, value: agg.value, liftVsBaseline: lift, examples };
  }).sort((a, b) => a.label.localeCompare(b.label));

  // Build category predicates with explicit term lists (multi-category allowed)
  type CategoryDef = { key: string; label: string; terms?: string[]; match: (s: string) => boolean };
  const escapeRegex = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchTerm = (s: string, term: string): boolean => {
    if (!term) return false;
    const subj = (s || '').toLowerCase();
    const t = term.toLowerCase();
    // Allow flexible whitespace inside the term
    const body = escapeRegex(t).replace(/\s+/g, '\\s+');
    // Word boundary by non-alphanumeric guards at both ends
    const re = new RegExp(`(^|[^A-Za-z0-9])(${body})(?=[^A-Za-z0-9]|$)`, 'i');
    return re.test(subj);
  };
  const mkMatcher = (terms: string[]) => (s: string) => terms.some(t => matchTerm(s, t));
  const CATEGORY_DEFS: Array<CategoryDef> = [
    { key: 'emoji', label: 'Emojis', terms: [], match: (s) => EMOJI_RE.test(s) },
    { key: 'deadline', label: 'Deadline & Urgency', terms: ['today','tonight','now','hurry','last chance','ends','ending','final','final hours','final call','deadline','expires','expiring','closing','countdown','one day only','24 hours','48 hours','through friday','ends sunday','by midnight','by eod','time is running out','act now','don’t wait','dont wait','window closes','last window','almost over','today only','this weekend only','ends tonight','last day','last chance to shop','offer ends','closing soon','limited hours','hours left','minutes left','going fast','ends in','final countdown','cut-off tonight','wraps up soon'], match: mkMatcher(['today','tonight','now','hurry','last chance','ends','ending','final','final hours','final call','deadline','expires','expiring','closing','countdown','one day only','24 hours','48 hours','through friday','ends sunday','by midnight','by eod','time is running out','act now','don’t wait','dont wait','window closes','last window','almost over','today only','this weekend only','ends tonight','last day','last chance to shop','offer ends','closing soon','limited hours','hours left','minutes left','going fast','ends in','final countdown','cut-off tonight','wraps up soon']) },
    { key: 'scarcity', label: 'Scarcity & Low Stock', terms: ['limited','limited time','limited supply','few left','almost gone','only','while supplies last','going fast','selling fast','low stock','final units','final drop','last sizes','last colors','final run','short supply','small batch','scarce','rare find','hard to get','back soon','won’t be restocked','wont be restocked','once it’s gone','once its gone','tiny batch','micro drop','limited batch','capped quantity','allocation','reserved stock','low inventory','only a handful','last call on sizes'], match: mkMatcher(['limited','limited time','limited supply','few left','almost gone','only','while supplies last','going fast','selling fast','low stock','final units','final drop','last sizes','last colors','final run','short supply','small batch','scarce','rare find','hard to get','back soon','won’t be restocked','wont be restocked','once it’s gone','once its gone','tiny batch','micro drop','limited batch','capped quantity','allocation','reserved stock','low inventory','only a handful','last call on sizes']) },
    { key: 'savings', label: 'Savings & Offers', terms: ['sale','save','savings','discount','deal','offer','promo','promo code','coupon','voucher','markdown','price drop','reduced','clearance','outlet','flash sale','bogo','buy one get one','bundle','kit deal','multi-buy','lowest price','under $','from $','spend and save','gift with purchase','rebate','price match','doorbuster','sitewide','storewide','extra','% off','off','limited time offer','weekend sale','payday sale','semi-annual sale','mid-season sale','warehouse sale','private sale','friends and family','hot buys','red tag','final markdowns'], match: mkMatcher(['sale','save','savings','discount','deal','offer','promo','promo code','coupon','voucher','markdown','price drop','reduced','clearance','outlet','flash sale','bogo','buy one get one','bundle','kit deal','multi-buy','lowest price','under $','from $','spend and save','gift with purchase','rebate','price match','doorbuster','sitewide','storewide','extra','% off','off','limited time offer','weekend sale','payday sale','semi-annual sale','mid-season sale','warehouse sale','private sale','friends and family','hot buys','red tag','final markdowns']) },
    { key: 'free', label: 'Free & Perks', terms: ['free','freebie','complimentary','on us','gift','bonus','perk','free shipping','ships free','free returns','free exchanges','free upgrade','free sample','free trial','no fees','no minimum','extended trial','on the house','free gift inside','free gift at checkout','complimentary gift wrap','free personalization','no restocking fee','no commitment','no credit card required'], match: mkMatcher(['free','freebie','complimentary','on us','gift','bonus','perk','free shipping','ships free','free returns','free exchanges','free upgrade','free sample','free trial','no fees','no minimum','extended trial','on the house','free gift inside','free gift at checkout','complimentary gift wrap','free personalization','no restocking fee','no commitment','no credit card required']) },
    { key: 'shipping', label: 'Shipping & Delivery Incentives', terms: ['free shipping','fast shipping','express','priority','2 day','next day','same day','arrives by','delivery by','guaranteed delivery','rush','holiday delivery','order by','cut-off','hassle-free returns','easy exchanges','free expedited','ship now','upgraded shipping','extended returns','curbside pickup','in-store pickup','buy online pick up in store','local delivery','ship to store','delivery date promise'], match: mkMatcher(['free shipping','fast shipping','express','priority','2 day','next day','same day','arrives by','delivery by','guaranteed delivery','rush','holiday delivery','order by','cut-off','hassle-free returns','easy exchanges','free expedited','ship now','upgraded shipping','extended returns','curbside pickup','in-store pickup','buy online pick up in store','local delivery','ship to store','delivery date promise']) },
    { key: 'newness', label: 'Newness & Launch', terms: ['new','just dropped','just in','now live','introducing','meet','now available','launch','release','first look','latest','new arrivals','new collection','fresh','just landed','new flavors','new colors','new sizes','updated','version','reissue','debut','premiere','first drop','new drop','refreshed','rebooted','reimagined','sneak release','early drop','soft launch'], match: mkMatcher(['new','just dropped','just in','now live','introducing','meet','now available','launch','release','first look','latest','new arrivals','new collection','fresh','just landed','new flavors','new colors','new sizes','updated','version','reissue','debut','premiere','first drop','new drop','refreshed','rebooted','reimagined','sneak release','early drop','soft launch']) },
    { key: 'exclusive', label: 'Exclusivity & Access', terms: ['exclusive','members only','vip','insider','early access','access granted','invite only','private','reserved','whitelist','waitlist access','first dibs','priority access','secret sale','unlocked for you','founders club','inner circle','limited access','passholder','premium access','by invitation','whitelist open','access code inside'], match: mkMatcher(['exclusive','members only','vip','insider','early access','access granted','invite only','private','reserved','whitelist','waitlist access','first dibs','priority access','secret sale','unlocked for you','founders club','inner circle','limited access','passholder','premium access','by invitation','whitelist open','access code inside']) },
    { key: 'personalization', label: 'Personalization & Identity', terms: ['you','your','just for you','picked for you','your picks','your size','your style','your shade','your order history','recommended','tailored','made for you','because you viewed','based on your favorites','your wishlist','your past purchases','curated for you','handpicked','your fit','your routine','your essentials','your room','your bundle','we thought of you'], match: mkMatcher(['you','your','just for you','picked for you','your picks','your size','your style','your shade','your order history','recommended','tailored','made for you','because you viewed','based on your favorites','your wishlist','your past purchases','curated for you','handpicked','your fit','your routine','your essentials','your room','your bundle','we thought of you']) },
    { key: 'social', label: 'Social Proof & Community', terms: ['best seller','top rated','customer favorite','fan favorite','trending','most loved','cult favorite','internet famous','as seen on','featured in','thousands of reviews','5 star','back by demand','staff picks','community picks','most wished for','most gifted','top pick','editor’s pick','editors pick','viral','hot right now','tiktok favorite','instagram famous','press favorite','award winning','people are raving'], match: mkMatcher(['best seller','top rated','customer favorite','fan favorite','trending','most loved','cult favorite','internet famous','as seen on','featured in','thousands of reviews','5 star','back by demand','staff picks','community picks','most wished for','most gifted','top pick','editor’s pick','editors pick','viral','hot right now','tiktok favorite','instagram famous','press favorite','award winning','people are raving']) },
    { key: 'benefits', label: 'Benefits & Outcomes', terms: ['results','instant','long-lasting','proven','visible','fast acting','lightweight','durable','waterproof','stain resistant','wrinkle free','breathable','non-toxic','organic','vegan','cruelty free','hypoallergenic','sustainable','eco','recyclable','fast charging','all-day comfort','better sleep','clearer skin','more energy','pain relief','saves time','saves money','clutter free','odor resistant','moisture wicking','spf','quick dry','zero-waste','ergonomic','multi-use','space saving','packable','travel ready','easy care','gentle','dermatologist tested','lab tested'], match: mkMatcher(['results','instant','long-lasting','proven','visible','fast acting','lightweight','durable','waterproof','stain resistant','wrinkle free','breathable','non-toxic','organic','vegan','cruelty free','hypoallergenic','sustainable','eco','recyclable','fast charging','all-day comfort','better sleep','clearer skin','more energy','pain relief','saves time','saves money','clutter free','odor resistant','moisture wicking','spf','quick dry','zero-waste','ergonomic','multi-use','space saving','packable','travel ready','easy care','gentle','dermatologist tested','lab tested']) },
    { key: 'pains', label: 'Pain Points & Objections', terms: ['fix','solve','end','avoid','prevent','protect','relief','reduce','eliminate','no hassle','no mess','no guesswork','no compromises','no more waste','no more breakouts','no more frizz','no more spills','no itch','no redness','no slipping','no wires','no pinching','no plastics','no toxins','zero hassle','risk free','headache free','sweat proof','leak proof','pet safe','kid safe'], match: mkMatcher(['fix','solve','end','avoid','prevent','protect','relief','reduce','eliminate','no hassle','no mess','no guesswork','no compromises','no more waste','no more breakouts','no more frizz','no more spills','no itch','no redness','no slipping','no wires','no pinching','no plastics','no toxins','zero hassle','risk free','headache free','sweat proof','leak proof','pet safe','kid safe']) },
    { key: 'curiosity', label: 'Curiosity & Teaser', terms: ['secret','revealed','the truth','surprising','unexpected','guess what','did you know','inside','behind the scenes','story','case study','before and after','sneak peek','preview','unlock','open to see','unbox','hint','spoiler','leak','peek inside','big reveal','early peek','what’s coming','whats coming','something new is brewing','can you guess'], match: mkMatcher(['secret','revealed','the truth','surprising','unexpected','guess what','did you know','inside','behind the scenes','story','case study','before and after','sneak peek','preview','unlock','open to see','unbox','hint','spoiler','leak','peek inside','big reveal','early peek','what’s coming','whats coming','something new is brewing','can you guess']) },
    { key: 'content', label: 'Content & Education', terms: ['guide','how to','tutorial','tips','tricks','checklist','playbook','template','workbook','cheat sheet','lookbook','style guide','buyer’s guide','buyers guide','sizing guide','recipe','routine','regimen','regimen builder','compare','versus','myths','mistakes','faqs','expert advice','behind the brand','care guide','materials 101','fit guide','starter guide','planner','inspiration','hacks','lessons','masterclass'], match: mkMatcher(['guide','how to','tutorial','tips','tricks','checklist','playbook','template','workbook','cheat sheet','lookbook','style guide','buyer’s guide','buyers guide','sizing guide','recipe','routine','regimen','regimen builder','compare','versus','myths','mistakes','faqs','expert advice','behind the brand','care guide','materials 101','fit guide','starter guide','planner','inspiration','hacks','lessons','masterclass']) },
    { key: 'seasonal', label: 'Seasonal & Calendar Moments', terms: ['spring','summer','fall','winter','weekend','long weekend','sunday reset','monday start','midweek','black friday','cyber monday','holiday','gifting season','new year','valentine’s day','valentines day','mother’s day','mothers day','father’s day','fathers day','back to school','labor day','memorial day','halloween','festival season','travel season','wedding season','spring cleaning','summer fridays','beach season','ski season','pride','earth day','small business saturday','singles’ day','singles day','boxing day','lunar new year','diwali','eid','hanukkah'], match: mkMatcher(['spring','summer','fall','winter','weekend','long weekend','sunday reset','monday start','midweek','black friday','cyber monday','holiday','gifting season','new year','valentine’s day','valentines day','mother’s day','mothers day','father’s day','fathers day','back to school','labor day','memorial day','halloween','festival season','travel season','wedding season','spring cleaning','summer fridays','beach season','ski season','pride','earth day','small business saturday','singles’ day','singles day','boxing day','lunar new year','diwali','eid','hanukkah']) },
    { key: 'bundles', label: 'Bundles & Kits', terms: ['bundle','kit','set','starter kit','deluxe kit','discovery set','value set','build your own','curated set','try-me set','family pack','duo','trio','multi-pack','refill bundle','routine set','gift set','starter bundle','complete kit','essentials set'], match: mkMatcher(['bundle','kit','set','starter kit','deluxe kit','discovery set','value set','build your own','curated set','try-me set','family pack','duo','trio','multi-pack','refill bundle','routine set','gift set','starter bundle','complete kit','essentials set']) },
    { key: 'loyalty', label: 'Loyalty & Referrals', terms: ['points','rewards','redeem','double points','bonus points','tier','status','silver','gold','platinum','anniversary','milestone','streak','early unlock','refer','referral','give','get','ambassador','store credit','birthday gift','member pricing','vip tier','unlock benefits','insider rewards','referral credit','perk unlocked'], match: mkMatcher(['points','rewards','redeem','double points','bonus points','tier','status','silver','gold','platinum','anniversary','milestone','streak','early unlock','refer','referral','give','get','ambassador','store credit','birthday gift','member pricing','vip tier','unlock benefits','insider rewards','referral credit','perk unlocked']) },
    { key: 'winback', label: 'Re‑engagement & Win‑back', terms: ['we miss you','it’s been a while','its been a while','come back','return','welcome back','take another look','try again','still interested','still want these','open your gift','your coupon is waiting','your picks are back','we saved these for you','let’s reconnect','lets reconnect','your favorites await','your offer is back','see what’s new since you left'], match: mkMatcher(['we miss you','it’s been a while','its been a while','come back','return','welcome back','take another look','try again','still interested','still want these','open your gift','your coupon is waiting','your picks are back','we saved these for you','let’s reconnect','lets reconnect','your favorites await','your offer is back','see what’s new since you left']) },
    { key: 'quiz', label: 'Preference & Quiz Invites', terms: ['take the quiz','find your fit','find your shade','match me','personalize','build your routine','tell us your size','help us tailor','style quiz','fit finder','pick your plan','choose your scent','choose your roast','dial in your routine','map your size'], match: mkMatcher(['take the quiz','find your fit','find your shade','match me','personalize','build your routine','tell us your size','help us tailor','style quiz','fit finder','pick your plan','choose your scent','choose your roast','dial in your routine','map your size']) },
    { key: 'ugc', label: 'UGC, Reviews & Feedback', terms: ['feedback','survey','tell us','rate us','review','vote','quick question','help us improve','poll','share your look','tag us','show us','upload your photo','photo review','video review','customer stories','testimonial','before and after','featured review','community gallery'], match: mkMatcher(['feedback','survey','tell us','rate us','review','vote','quick question','help us improve','poll','share your look','tag us','show us','upload your photo','photo review','video review','customer stories','testimonial','before and after','featured review','community gallery']) },
    { key: 'sweepstakes', label: 'Sweepstakes & Contests', terms: ['giveaway','enter to win','sweepstakes','contest','challenge','win','prize','grand prize','winners announced','finalist','runner-up','bonus entries','instant win','limited entries','countdown to close','prize pack','entry closes soon'], match: mkMatcher(['giveaway','enter to win','sweepstakes','contest','challenge','win','prize','grand prize','winners announced','finalist','runner-up','bonus entries','instant win','limited entries','countdown to close','prize pack','entry closes soon']) },
    { key: 'sustainability', label: 'Sustainability & Cause', terms: ['sustainable','eco','recycled','circular','repair','refill','reusable','carbon neutral','plastic free','cruelty free','ethical','fair trade','b corp','give back','donate','proceeds go to','support the cause','responsible','compostable','biodegradable','ocean-bound plastic','climate neutral','made to last','buy less choose well','trade-in','take-back','offset included'], match: mkMatcher(['sustainable','eco','recycled','circular','repair','refill','reusable','carbon neutral','plastic free','cruelty free','ethical','fair trade','b corp','give back','donate','proceeds go to','support the cause','responsible','compostable','biodegradable','ocean-bound plastic','climate neutral','made to last','buy less choose well','trade-in','take-back','offset included']) },
    { key: 'brandstory', label: 'Brand Story & BTS', terms: ['founder note','our story','why we made this','handcrafted','small batch','made in','design notes','materials','sourcing','atelier','studio','limited run','meet the maker','workshop','craft','heritage','archive','from sketch to shelf','blueprint','process','behind the craft'], match: mkMatcher(['founder note','our story','why we made this','handcrafted','small batch','made in','design notes','materials','sourcing','atelier','studio','limited run','meet the maker','workshop','craft','heritage','archive','from sketch to shelf','blueprint','process','behind the craft']) },
    { key: 'collab', label: 'Collaborations & Limited Editions', terms: ['collab','collaboration','capsule','drop','limited edition','special edition','co-create','partner','guest designer','artist series','crossover','co-branded','joint drop','pop-up collab','collector’s edition','collectors edition'], match: mkMatcher(['collab','collaboration','capsule','drop','limited edition','special edition','co-create','partner','guest designer','artist series','crossover','co-branded','joint drop','pop-up collab','collector’s edition','collectors edition']) },
    { key: 'crosssell', label: 'Cross‑sell & Complements', terms: ['complete the set','pairs with','goes with','wear it with','layer it with','recommended with','works with','customers also bought','upgrade your setup','finish the look','outfit builder','shop the set','add the matching piece','perfect pairing'], match: mkMatcher(['complete the set','pairs with','goes with','wear it with','layer it with','recommended with','works with','customers also bought','upgrade your setup','finish the look','outfit builder','shop the set','add the matching piece','perfect pairing']) },
    { key: 'pricing', label: 'Price Positioning & Financing', terms: ['price drop','new price','now $','from $','under $','best value','value pick','subscribe and save','subscribe','cancel anytime','pay over time','pay later','klarna','afterpay','0% apr','lock in savings','price freeze','member price','value bundle','auto-delivery','subscription pricing'], match: mkMatcher(['price drop','new price','now $','from $','under $','best value','value pick','subscribe and save','subscribe','cancel anytime','pay over time','pay later','klarna','afterpay','0% apr','lock in savings','price freeze','member price','value bundle','auto-delivery','subscription pricing']) },
    { key: 'earlybird', label: 'Early‑bird & Waitlist', terms: ['early-bird','first access','first 100','join the waitlist','waitlist now open','reserve your spot','claim your spot','secure yours','be first in line','get on the list','pre-reserve','priority line','queue jump','early rsvp'], match: mkMatcher(['early-bird','first access','first 100','join the waitlist','waitlist now open','reserve your spot','claim your spot','secure yours','be first in line','get on the list','pre-reserve','priority line','queue jump','early rsvp']) },
    { key: 'gifting', label: 'Gifting & Gift Guides', terms: ['gift','gifting made easy','gift ideas','gift guide','for her','for him','for them','gifts under','last-minute gifts','gift cards','wrap it up','stocking stuffers','secret santa','white elephant','hostess gifts','housewarming','for mom','for dad','for kids','for best friend','for the bride','for the groom'], match: mkMatcher(['gift','gifting made easy','gift ideas','gift guide','for her','for him','for them','gifts under','last-minute gifts','gift cards','wrap it up','stocking stuffers','secret santa','white elephant','hostess gifts','housewarming','for mom','for dad','for kids','for best friend','for the bride','for the groom']) },
    { key: 'trybefore', label: 'Try‑before‑you‑buy & Samples', terms: ['try at home','try before you buy','sample','mini','travel size','starter size','trial size','home try-on','risk free','fit guarantee','30-day trial','100-night trial','satisfaction guaranteed','swatches','test drive','shade match kit'], match: mkMatcher(['try at home','try before you buy','sample','mini','travel size','starter size','trial size','home try-on','risk free','fit guarantee','30-day trial','100-night trial','satisfaction guaranteed','swatches','test drive','shade match kit']) },
    { key: 'care', label: 'Care, Maintenance & Refills', terms: ['care guide','cleaning tips','how to wash','how to store','extend the life','refill','restock','reorder','top up','re-ink','replace filters','replenish','autoship refills','maintenance tips','protect','refresh','revive','renew'], match: mkMatcher(['care guide','cleaning tips','how to wash','how to store','extend the life','refill','restock','reorder','top up','re-ink','replace filters','replenish','autoship refills','maintenance tips','protect','refresh','revive','renew']) },
    { key: 'geo', label: 'Localization & Geo Cues', terms: ['near you','in your area','local','now in','now shipping to','us only','canada only','international','worldwide','regional favorites','ships from usa','ships from eu','duty free','no customs','local pickup','same-day pickup','now in stores'], match: mkMatcher(['near you','in your area','local','now in','now shipping to','us only','canada only','international','worldwide','regional favorites','ships from usa','ships from eu','duty free','no customs','local pickup','same-day pickup','now in stores']) },
    { key: 'timewindows', label: 'Time Windows & Countdowns', terms: ['24 hours','48 hours','weekend only','ends sunday','midnight tonight','through friday','today only','this week','this weekend','by eod','72 hours','happy hour','limited window','early access ends','flash window','countdown sale','weekend drop'], match: mkMatcher(['24 hours','48 hours','weekend only','ends sunday','midnight tonight','through friday','today only','this week','this weekend','by eod','72 hours','happy hour','limited window','early access ends','flash window','countdown sale','weekend drop']) },
  ];

  // Compute categories
  const categoriesRaw: FeatureStat[] = CATEGORY_DEFS.map(def => computeFeatureGroup(campaigns, metric, def.label, s => def.match(s), def.key))
    .filter(f => f.countCampaigns > 0)
    .sort((a, b) => (b.liftVsBaseline - a.liftVsBaseline) || (b.totalEmails - a.totalEmails));

  // Compute top used terms (campaign-level presence) per category; only within the category subset
  const defByKey = new Map(CATEGORY_DEFS.map(d => [d.key, d] as const));
  for (const cat of categoriesRaw) {
    const def = defByKey.get(cat.key);
    const terms = def?.terms || [];
    if (terms.length === 0) {
      // For categories without explicit terms (e.g., Emojis), we skip usedTerms
      cat.usedTerms = [];
      continue;
    }
    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, 0);
    // Only count terms in campaigns that belong to this category
    const subset = campaigns.filter(c => def!.match(c.subject || c.campaignName || ''));
    for (const c of subset) {
      const s = (c.subject || c.campaignName || '');
      for (const t of terms) {
        if (matchTerm(s, t)) counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    const list = Array.from(counts.entries())
      .filter(([, n]) => (n || 0) > 0)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([term, count]) => ({ term, count }));
    cat.usedTerms = list;
  }

  // Apply reliability gating per selected metric
  const totalEmailsAll = campaigns.reduce((s, c) => s + (c.emailsSent || 0), 0);
  const minCampaigns = 5;
  const minEmailsPct = 0.02; // 2%
  const categories: FeatureStat[] = categoriesRaw.map(cat => ({ ...cat }));
  if (metric === 'openRate' || metric === 'clickRate' || metric === 'clickToOpenRate') {
    // Compute raw p-values only for categories that pass volume gate; then BH-adjust
    const testedIdx: number[] = [];
    const pVals: number[] = [];
    const tables: Array<{ idx: number; useFisher: boolean; p: number }> = [];
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const volOk = (cat.countCampaigns >= minCampaigns) && (cat.totalEmails >= Math.ceil(totalEmailsAll * minEmailsPct));
      if (!volOk) continue;
      const def = CATEGORY_DEFS.find(d => d.key === cat.key)!;
      const subset = campaigns.filter(c => def.match(c.subject || c.campaignName || ''));
      const rest = campaigns.filter(c => !def.match(c.subject || c.campaignName || ''));
      const aggA = computeAggregate(subset, metric);
      const aggB = computeAggregate(rest, metric);
      // For rates, numerator/denominator based on metric
      let aSucc = metric === 'openRate' ? aggA.totalOpens : metric === 'clickRate' ? aggA.totalClicks : aggA.totalClicks;
      const aTot = metric === 'clickToOpenRate' ? aggA.totalOpens : aggA.totalEmails;
      let bSucc = metric === 'openRate' ? aggB.totalOpens : metric === 'clickRate' ? aggB.totalClicks : aggB.totalClicks;
      const bTot = metric === 'clickToOpenRate' ? aggB.totalOpens : aggB.totalEmails;
      // Clamp successes to totals to avoid negative failures from noisy data
      aSucc = Math.min(aSucc, aTot);
      bSucc = Math.min(bSucc, bTot);
      const { p, valid } = twoProportionZTest({ success: aSucc, total: aTot }, { success: bSucc, total: bTot });
      const useFisher = !valid;
      const pUse = useFisher ? fishersExactTwoSided(aSucc, Math.max(0, aTot - aSucc), bSucc, Math.max(0, bTot - bSucc)) : p;
      testedIdx.push(i);
      tables.push({ idx: i, useFisher, p: pUse });
      pVals.push(pUse);
    }
    const adj = benjaminiHochberg(pVals);
    // Initialize defaults for all categories
    for (const cat of categories) { cat.reliable = false; cat.pAdj = undefined; cat.method = 'none'; cat.ci95 = null; }
    // Apply adjusted p-values to tested categories
    for (let j = 0; j < tables.length; j++) {
      const { idx, useFisher } = tables[j];
      const cat = categories[idx];
      const passed = adj[j] < 0.05;
      cat.reliable = passed;
      cat.pAdj = adj[j];
      cat.method = useFisher ? 'fisher' : 'z';
      cat.ci95 = null;
    }
  } else if (metric === 'revenuePerEmail') {
    // RPE bootstrap on per-campaign RPE values; only compute for volume-qualified categories
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const volOk = (cat.countCampaigns >= minCampaigns) && (cat.totalEmails >= Math.ceil(totalEmailsAll * minEmailsPct));
      cat.method = 'bootstrap';
      cat.pAdj = undefined;
      if (!volOk) { cat.reliable = false; cat.ci95 = null; continue; }
      const def = CATEGORY_DEFS.find(d => d.key === cat.key)!;
      const subset = campaigns.filter(c => def.match(c.subject || c.campaignName || ''));
      const rest = campaigns.filter(c => !def.match(c.subject || c.campaignName || ''));
      const rpe = (c: ProcessedCampaign) => (c.emailsSent || 0) > 0 ? (c.revenue || 0) / (c.emailsSent || 1) : 0;
      const A = subset.map(rpe).filter(v => isFinite(v));
      const B = rest.map(rpe).filter(v => isFinite(v));
      // Winsorize then log1p transform for stability in bootstrap mean difference
      const transform = (xs: number[]) => xs.length ? winsorize(xs, 0.99).map(v => Math.log1p(v)) : xs;
      const { lo, hi, passed } = bootstrapDiffCI(A, B, 1000, transform);
      cat.reliable = passed;
      cat.ci95 = { lo, hi };
    }
  }

  // Legacy groups removed per new spec; keep empty arrays for compatibility where referenced
  const keywordEmojis: FeatureStat[] = [];
  const punctuationCasing: FeatureStat[] = [];
  const deadlines: FeatureStat[] = [];
  const personalization: FeatureStat[] = [];
  const priceAnchoring: FeatureStat[] = [];
  const imperativeStart: FeatureStat[] = [];

  // Reuse fatigue — exact match only
  const bySubject = new Map<string, ProcessedCampaign[]>();
  for (const c of campaigns) {
    const key = normalize(c.subject || c.campaignName || '');
    if (/\[MULTIPLE VARIATIONS\]/i.test(key)) continue; // exclude A/B test tag subjects
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
  const deltaPct = firstAgg.value > 0 ? ((lastAgg.value - firstAgg.value) / firstAgg.value) * 100 : 0;
  reuse.push({ subject: subj, occurrences: sorted.length, firstValue: firstAgg.value, lastValue: lastAgg.value, change: deltaPct, totalEmails });
  }
  reuse.sort((a, b) => b.totalEmails - a.totalEmails);

  return { baseline, lengthBins, categories, keywordEmojis, punctuationCasing, deadlines, personalization, priceAnchoring, imperativeStart, reuse };
}

export function uniqueSegmentsFromCampaigns(campaigns: ProcessedCampaign[]): string[] {
  const set = new Set<string>();
  for (const c of campaigns) {
    for (const s of c.segmentsUsed || []) { if (s && s.trim()) set.add(s); }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
