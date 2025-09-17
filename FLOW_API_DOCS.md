# Klaviyo Flow Analytics API Documentation

This documentation covers the new Klaviyo Flow APIs that provide comprehensive flow analytics data, matching the format you specified in your requirements.

## Overview

The new flow endpoints provide access to:
- **Flows**: List all flows in your Klaviyo account
- **Flow Messages**: Get messages within specific flows  
- **Flow Analytics**: Comprehensive analytics data including metrics, performance, and revenue data

All message lookups now traverse Klaviyo's `/api/flows/{id}/flow-actions` endpoints, and analytics results are grouped by the underlying `flow_action_id`. The API includes this identifier in responses so you can cross-reference raw `flow-report` output directly.

## Authentication

All endpoints require:
- `x-admin-job-secret` header with your admin secret
- `klaviyoApiKey` parameter with your Klaviyo API key
- `KLAVIYO_ENABLE=true` environment variable

## API Endpoints

### 1. Get All Flows
```
GET /api/klaviyo/flows
```

**Parameters:**
- `klaviyoApiKey` (required): Your Klaviyo API key
- `pageSize` (optional, default: 50): Number of flows per page (1-100)  
- `maxPages` (optional, default: 10): Maximum pages to fetch (1-100)
- `revision` (optional): Klaviyo API revision

**Response:**
```json
{
  "ok": true,
  "count": 5,
  "flows": [
    {
      "id": "Sz4yWQ",
      "name": "ec-welcome_flow",
      "status": "live",
      "created": "2024-01-15T10:30:00Z",
      "updated": "2024-09-01T14:20:00Z",
      "trigger_type": "signup",
      "archived": false
    }
  ]
}
```

### 2. Get Flow Messages
```
GET /api/klaviyo/flow-messages
```

**Parameters:**
- `klaviyoApiKey` (required): Your Klaviyo API key
- `flowId` (required): The flow ID to get messages for
- `pageSize` (optional, default: 50): Number of messages per page
- `maxPages` (optional, default: 10): Maximum pages to fetch

**Response:**
```json
{
  "ok": true,
  "flowId": "Sz4yWQ",
  "count": 3,
  "flowMessages": [
    {
      "id": "UtqWST",
      "name": "ec-welcome_flow-email3", 
      "channel": "email",
      "created": "2024-01-15T11:00:00Z",
      "flowId": "Sz4yWQ",
      "flowActionId": "UtqWST-action"
    }
  ]
}
```

### 3. Get Flow Analytics
```
GET /api/klaviyo/flow-analytics
```

**Parameters:**
- `klaviyoApiKey` (required): Your Klaviyo API key
- `pageSize` (optional, default: 50): Number of analytics records per page
- `maxPages` (optional, default: 20): Maximum pages to fetch  
- `flowId` (optional): Filter by specific flow ID
- `startDate` (optional): Filter by start date (ISO format: YYYY-MM-DD)
- `endDate` (optional): Filter by end date (ISO format: YYYY-MM-DD)
- `format` (optional): Response format ('json' or 'csv', default: 'json')

**JSON Response:**
```json
{
  "ok": true,
  "count": 1,
  "params": {
    "flowId": "Sz4yWQ",
    "startDate": "2025-09-01", 
    "endDate": "2025-09-30"
  },
  "flowAnalytics": [
    {
      "day": "2025-09-04",
      "flowId": "Sz4yWQ",
      "flowName": "ec-welcome_flow",
      "flowMessageId": "UtqWST", 
      "flowMessageName": "ec-welcome_flow-email3",
      "channel": "Email",
      "status": "live",
      "delivered": 6.0,
      "uniqueOpens": 3.0,
      "openRate": 0.5,
      "uniqueClicks": 0.0,
      "clickRate": 0.0,
      "placedOrders": 0.0,
      "placedOrderRate": 0.0,
      "revenue": 0.0,
      "revenuePerRecipient": 0.0,
      "unsubscribeRate": 0.0,
      "complaintRate": 0.0,
      "bounceRate": 0.0,
      "tags": ""
    }
  ]
}
```

**CSV Response (format=csv):**
The CSV format exactly matches your requirements:

```csv
"Day","Flow ID","Flow Name","Flow Message ID","Flow Message Name","Flow Message Channel","Status","Delivered","Unique Opens","Open Rate","Unique Clicks","Click Rate","Placed Order","Placed Order Rate","Revenue","Revenue per Recipient","Unsub Rate","Complaint Rate","Bounce Rate","Tags"
"2025-09-04","Sz4yWQ","ec-welcome_flow","UtqWST","ec-welcome_flow-email3","Email","live","6.0","3.0","0.500","0.0","0.000","0.0","0.000","0.00","0.00","0.000","0.000","0.000",""
```

## Usage Examples

### Using cURL

**Get flows:**
```bash
curl -H "x-admin-job-secret: your-secret" \
  "http://localhost:3000/api/klaviyo/flows?klaviyoApiKey=your-api-key&pageSize=10"
```

**Get flow analytics as CSV:**
```bash
curl -H "x-admin-job-secret: your-secret" \
  "http://localhost:3000/api/klaviyo/flow-analytics?klaviyoApiKey=your-api-key&format=csv&startDate=2025-09-01&endDate=2025-09-30" \
  -o flow_analytics.csv
```

### Using Node.js/JavaScript

```javascript
const ADMIN_SECRET = process.env.ADMIN_JOB_SECRET;
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;

async function getFlowAnalytics() {
  const url = new URL('/api/klaviyo/flow-analytics', 'http://localhost:3000');
  url.searchParams.set('klaviyoApiKey', KLAVIYO_API_KEY);
  url.searchParams.set('format', 'csv');
  url.searchParams.set('startDate', '2025-09-01');
  url.searchParams.set('endDate', '2025-09-30');
  
  const response = await fetch(url.toString(), {
    headers: {
      'x-admin-job-secret': ADMIN_SECRET,
    },
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return response.text(); // Returns CSV string
}
```

## Field Mappings

The API output maps to your required CSV format as follows:

| Your Requirement | API Field | Description |
|------------------|-----------|-------------|
| Day | `day` | Date in YYYY-MM-DD format |
| Flow ID | `flowId` | Unique flow identifier |
| Flow Name | `flowName` | Human-readable flow name |
| Flow Message ID | `flowMessageId` | Unique message identifier |
| Flow Message Name | `flowMessageName` | Human-readable message name |
| Flow Message Channel | `channel` | Usually "Email" |
| Status | `status` | Flow status ("live", "draft", etc.) |
| Delivered | `delivered` | Number of delivered messages |
| Unique Opens | `uniqueOpens` | Number of unique opens |
| Open Rate | `openRate` | Open rate as decimal (0.5 = 50%) |
| Unique Clicks | `uniqueClicks` | Number of unique clicks |
| Click Rate | `clickRate` | Click rate as decimal |
| Placed Order | `placedOrders` | Number of orders placed |
| Placed Order Rate | `placedOrderRate` | Order rate as decimal |
| Revenue | `revenue` | Total revenue amount |
| Revenue per Recipient | `revenuePerRecipient` | Average revenue per recipient |
| Unsub Rate | `unsubscribeRate` | Unsubscribe rate as decimal |
| Complaint Rate | `complaintRate` | Spam complaint rate as decimal |
| Bounce Rate | `bounceRate` | Bounce rate as decimal |
| Tags | `tags` | Optional tags (empty by default) |

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "details": "Detailed error message"
}
```

Common error codes:
- `401`: Missing or invalid admin secret
- `400`: Missing required parameters (like klaviyoApiKey)
- `500`: Unexpected server or Klaviyo API error
- `501`: Klaviyo integration disabled (KLAVIYO_ENABLE != 'true')

## Testing

Run the test script to verify all endpoints work:

```bash
node test-flow-apis.js
```

Make sure your environment variables are set:
- `KLAVIYO_API_KEY`: Your Klaviyo API key
- `ADMIN_JOB_SECRET`: Your admin secret
- `KLAVIYO_ENABLE=true`: Enable Klaviyo integration

## Notes

1. **Rate Limits**: Klaviyo has API rate limits. The endpoints include pagination controls to manage this.

2. **Date Ranges**: When using date filters, use ISO format (YYYY-MM-DD).

3. **Pagination**: Large accounts may have many flows/messages. Use `pageSize` and `maxPages` to control data volume.

4. **CSV Format**: The CSV output exactly matches your specified format with proper quoting and decimal precision.

5. **Performance**: Flow analytics queries can be resource-intensive. Consider using date ranges to limit data scope for better performance.
