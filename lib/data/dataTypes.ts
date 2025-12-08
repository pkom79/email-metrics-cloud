// Data types for the Cloud app (self-contained copy)

// Processed data interfaces with all calculated metrics
export interface ProcessedCampaign {
    id: number;
    campaignName: string;
    subject: string;
    sentDate: Date;
    // Original raw timestamp string from CSV (for audit / reprocessing)
    rawSentDateString?: string;
    dayOfWeek: number;
    hourOfDay: number;
    // Segment/list names used for the send (parsed from CSV "Lists"/"List")
    segmentsUsed: string[];
    emailsSent: number;
    uniqueOpens: number;
    uniqueClicks: number;
    totalOrders: number;
    revenue: number;
    unsubscribesCount: number;
    spamComplaintsCount: number;
    bouncesCount: number;
    // Calculated rates
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    revenuePerEmail: number;
    unsubscribeRate: number;
    spamRate: number;
    bounceRate: number;
    avgOrderValue: number;
}

export interface ProcessedFlowEmail {
    id: number;
    flowId: string;
    flowName: string;
    flowMessageId: string;
    emailName: string;
    sequencePosition: number;
    sentDate: Date;
    // Original raw timestamp string from CSV (for audit / reprocessing)
    rawSentDateString?: string;
    status: string;
    emailsSent: number;
    uniqueOpens: number;
    uniqueClicks: number;
    totalOrders: number;
    revenue: number;
    unsubscribesCount: number;
    spamComplaintsCount: number;
    bouncesCount: number;
    // Calculated rates
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    revenuePerEmail: number;
    unsubscribeRate: number;
    spamRate: number;
    bounceRate: number;
    avgOrderValue: number;
}

export interface ProcessedSubscriber {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    source: string;
    emailConsent: boolean;
    // Preserve raw consent to compute opt-in rate rules like NEVER_SUBSCRIBED
    emailConsentRaw?: string;
    // Parsed consent timestamp (if provided) to distinguish organic subscription timing
    emailConsentTimestamp?: Date | null;
    totalClv: number;
    historicClv?: number;
    predictedClv: number;
    avgOrderValue: number;
    totalOrders: number;
    firstActive: Date;
    lastActive: Date | null;
    profileCreated: Date;
    isBuyer: boolean;
    lifetimeInDays: number;
    // New fields from CSV for segment analysis
    emailSuppressions?: string[];
    canReceiveEmail?: boolean;
    avgDaysBetweenOrders?: number | null;
    // New activity fields
    lastOpen?: Date | null;
    lastClick?: Date | null;
    firstActiveRaw?: Date | null;
}

// Raw CSV interfaces
export interface RawCampaignCSV {
    'Campaign Name': string;
    'Tags'?: string | number;
    'Subject': string;
    'List': string;
    'Send Time': string;
    'Send Weekday': string;
    'Total Recipients': string | number;
    'Unique Placed Order'?: string | number;
    'Unique Ordered Product'?: string | number;
    'Placed Order Rate'?: string | number;
    'Ordered Product Rate'?: string | number;
    'Total Placed Orders'?: string | number;
    'Placed Orders'?: string | number;
    'Ordered Product'?: string | number;
    'Revenue'?: string | number;
    'Ordered Product Value'?: string | number;
    'Revenue per Recipient'?: string | number;
    'Ordered Product Value per Recipient'?: string | number;
    'Unique Opens': string | number;
    'Open Rate': string;
    'Total Opens': string | number;
    'Unique Clicks': string | number;
    'Click Rate': string;
    'Total Clicks': string | number;
    'Unsubscribes': string | number;
    'Spam Complaints': string | number;
    'Spam Complaints Rate': string;
    'Successful Deliveries': string | number;
    'Bounces': string | number;
    'Bounce Rate': string;
    'Campaign ID': string;
    'Campaign Channel': string;
}

export interface RawFlowCSV {
    'Day': string;
    'Flow ID': string;
    'Flow Name': string;
    'Flow Message ID': string;
    'Flow Message Name': string;
    'Flow Message Channel'?: string;
    'Status': string;
    'Delivered': string | number;
    'Bounced': string | number;
    'Bounce Rate': string | number;
    'Unique Opens': string | number;
    'Open Rate': string | number;
    'Total Opens': string | number;
    'Unique Clicks': string | number;
    'Click Rate': string | number;
    'Total Clicks': string | number;
    'Unique Placed Order'?: string | number;
    'Unique Ordered Product'?: string | number;
    'Placed Order'?: string | number;
    'Ordered Product'?: string | number;
    'Placed Order Rate'?: string | number;
    'Ordered Product Rate'?: string | number;
    'Revenue'?: string | number;
    'Ordered Product Value'?: string | number;
    'Revenue per Recipient'?: string | number;
    'Ordered Product Value per Recipient'?: string | number;
    'Unsubscribes'?: string | number;
    'Unsubscribe Rate'?: string | number;
    'Unsub Rate'?: string | number;
    'Spam'?: string | number;
    'Spam Rate'?: string | number;
    'Complaint Rate'?: string | number;
}

export interface RawSubscriberCSV {
    'Email': string;
    'Klaviyo ID': string;
    'First Name': string;
    'Last Name': string;
    'Organization'?: string;
    'Title'?: string;
    'Phone Number'?: string;
    'Address'?: string;
    'Address 2'?: string;
    'City': string;
    'State / Region': string;
    'Country': string;
    'Zip Code': string;
    'Latitude'?: string | number;
    'Longitude'?: string | number;
    'Source': string;
    'IP Address'?: string;
    'Email Marketing Consent': string;
    'Email Marketing Consent Timestamp'?: string;
    'Historic Customer Lifetime Value'?: string | number;
    'Total Customer Lifetime Value'?: string | number;
    'Predicted Customer Lifetime Value'?: string | number;
    'Average Order Value'?: string | number;
    'Historic Number Of Orders'?: string | number;
    'First Active'?: string;
    'Last Active'?: string;
    'Profile Created On': string;
    'Date Added': string;
    'Last Open'?: string;
    'Last Click'?: string;
    'Average Days Between Orders'?: string | number;
    'Email Suppressions'?: string;
    [key: string]: string | number | undefined;
}

// Aggregation interfaces
export interface FlowSequenceInfo {
    flowId: string;
    messageIds: string[];
    emailNames: string[];
    sequenceLength: number;
}

export interface DayOfWeekPerformanceData {
    day: string;
    dayIndex: number;
    value: number;
    campaignCount: number;
}

export interface HourOfDayPerformanceData {
    hour: number;
    hourLabel: string;
    value: number;
    campaignCount: number;
    percentageOfTotal: number;
}

export interface AggregatedMetrics {
    totalRevenue: number;
    emailsSent: number;
    totalOrders: number;
    openRate: number;
    clickRate: number;
    conversionRate: number;
    unsubscribeRate: number;
    spamRate: number;
    bounceRate: number;
    avgOrderValue: number;
    revenuePerEmail: number;
    clickToOpenRate: number;
    emailCount: number;
    // Raw counts for contribution analysis
    spamComplaintsCount: number;
    bouncesCount: number;
}

export interface AudienceInsights {
    totalSubscribers: number;
    buyerCount: number;
    nonBuyerCount: number;
    buyerPercentage: number;
    avgClvAll: number;
    avgClvBuyers: number;
    purchaseFrequency: {
        never: number;
        oneOrder: number;
        twoOrders: number;
        threeTo5: number;
        sixPlus: number;
    };
    lifetimeDistribution: {
        zeroTo3Months: number;
        threeTo6Months: number;
        sixTo12Months: number;
        oneToTwoYears: number;
        twoYearsPlus: number;
    };
}

// Parsing result interfaces
export interface ParseResult<T> {
    success: boolean;
    data?: T[];
    error?: string;
}

export interface ValidationError {
    row: number;
    field: string;
    message: string;
}
