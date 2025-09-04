export const METRIC_DEFINITIONS: Record<string,string> = {
  revenue: 'Total gross revenue attributed to selected email sends in the period.',
  totalOrders: 'Number of orders attributed to email sends (all conversion events).',
  avgOrderValue: 'Average revenue per order (total revenue / total orders).',
  emailsSent: 'Total number of emails sent (campaign + flow) in the selected period.',
  revenuePerEmail: 'Revenue divided by emails sent for the selected period.',
  openRate: 'Unique opens divided by emails sent (%).',
  clickRate: 'Unique clicks divided by emails sent (%).',
  clickToOpenRate: 'Unique clicks divided by unique opens (%).',
  conversionRate: 'Orders divided by unique clicks (%).',
  unsubscribeRate: 'Unsubscribes divided by emails sent (%). Lower is better.',
  spamRate: 'Spam complaints divided by emails sent (%). Lower is better.',
  bounceRate: 'Bounces divided by emails sent (%). Lower is better.'
};

export function getMetricDefinition(key?: string){
  if(!key) return '';
  return METRIC_DEFINITIONS[key] || '';
}