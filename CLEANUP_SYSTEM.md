# Email Metrics Cloud - Data Cleanup System

This document describes the comprehensive data cleanup system implemented to manage storage costs and prevent data bloat in the Email Metrics Cloud application.

## Overview

The cleanup system manages three types of data:

1. **Expired preauth uploads** - Files uploaded before account creation that weren't linked
2. **Old uploads for active accounts** - Historical uploads beyond the retention limit
3. **Soft-deleted accounts** - Accounts marked for deletion beyond the retention period

## Cleanup Endpoints

### Master Cleanup Endpoint
- **URL**: `POST /api/cleanup`
- **Purpose**: Orchestrates all cleanup operations in a single call
- **Usage**: Ideal for cron jobs and scheduled maintenance
- **Configuration**:
  ```json
  {
    "skipExpiredPreauth": false,
    "skipOldUploads": false, 
    "skipDeletedAccounts": false,
    "retentionDays": 30
  }
  ```

### Individual Cleanup Endpoints

#### 1. Expired Preauth Uploads
- **URL**: `POST /api/preauth/cleanup-batch`
- **Purpose**: Removes preauth uploads older than their TTL (24 hours)
- **What it cleans**:
  - Storage files in `preauth-uploads` bucket
  - Upload records marked as `preauth` and expired
- **Safety**: Only touches `preauth` status uploads

#### 2. Old Uploads for Active Accounts  
- **URL**: `POST /api/uploads/cleanup-old`
- **Purpose**: Keeps only the most recent uploads per active account
- **What it cleans**:
  - Storage files for old uploads
  - Snapshot records and related data
  - Upload records beyond the retention limit
- **Safety**: Only affects active accounts, preserves most recent data

#### 3. Soft-Deleted Accounts
- **URL**: `POST /api/accounts/cleanup-deleted`
- **Purpose**: Permanently removes accounts soft-deleted beyond retention period
- **What it cleans**:
  - All storage files for the account
  - All database records (accounts, uploads, snapshots, etc.)
  - Associated auth users
- **Safety**: Only affects accounts with `deleted_at` timestamp older than retention period

## Environment Variables

Configure the cleanup behavior using these environment variables:

```bash
# How many uploads to keep per active account (default: 1)
MAX_UPLOADS_PER_ACCOUNT=1

# How many days to retain soft-deleted accounts (default: 30)
DELETED_ACCOUNT_RETENTION_DAYS=30

# Storage bucket for preauth uploads
PREAUTH_BUCKET=preauth-uploads
```

## Data Flow and Storage Locations

### Storage Locations
- **`preauth-uploads` bucket**: Temporary storage for CSV files before account creation
- **`accounts` table**: Account metadata
- **`uploads` table**: Upload tracking with status (`preauth` → `bound` → `processing` → `processed`)
- **`snapshots` table**: Processed data snapshots
- **`snapshot_totals` & `snapshot_series` tables**: Derived metrics

### Status Flow
1. **Pre-auth upload**: Files → `preauth-uploads` bucket, upload status = `preauth`
2. **Email confirmation**: Status changes to `bound`, snapshot created  
3. **Processing**: Status changes to `processing` then `processed`
4. **Cleanup**: Old uploads removed, only most recent kept per account

## Scheduled Cleanup Recommendations

### Daily Cleanup (High Frequency)
```bash
# Clean expired preauth uploads (safe, removes abandoned uploads)
curl -X POST https://your-domain.com/api/preauth/cleanup-batch
```

### Weekly Cleanup (Medium Frequency)  
```bash
# Clean old uploads for active accounts
curl -X POST https://your-domain.com/api/uploads/cleanup-old
```

### Monthly Cleanup (Low Frequency)
```bash
# Clean soft-deleted accounts (30+ days old)
curl -X POST https://your-domain.com/api/accounts/cleanup-deleted
```

### All-in-One (Recommended for Cron)
```bash
# Master cleanup - handles everything
curl -X POST https://your-domain.com/api/cleanup \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Cron Job Examples

### Vercel Cron (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cleanup",
      "schedule": "0 2 * * *"
    }
  ]
}
```

### Traditional Cron
```bash
# Daily at 2 AM UTC
0 2 * * * curl -X POST https://your-domain.com/api/cleanup
```

## Security and Access Control

- All cleanup endpoints require admin privileges or anonymous access (for cron jobs)
- If a user is authenticated, they must have `app_metadata.role === 'admin'`
- Anonymous requests are allowed to support serverless cron jobs

## Monitoring and Logging

Each cleanup operation returns detailed results:

```json
{
  "ok": true,
  "summary": {
    "totalExpiredPreauth": 5,
    "totalOldUploads": 12,
    "totalDeletedAccounts": 2,
    "totalErrors": []
  },
  "details": {
    "operations": {
      "expiredPreauth": { "expiredPreauth": 5, "errors": [] },
      "oldUploads": { "removedUploads": 12, "errors": [] },
      "deletedAccounts": { "removedAccounts": 2, "errors": [] }
    }
  }
}
```

Monitor these endpoints and set up alerts for:
- High error counts
- Cleanup failures
- Unexpected data growth

## Safety Features

1. **Batch Limits**: Operations process limited batches (50-100 records) to prevent timeouts
2. **Error Isolation**: Failure in one operation doesn't stop others
3. **Status Checks**: Only processes records in appropriate states
4. **Retention Periods**: Configurable grace periods before permanent deletion
5. **Comprehensive Logging**: Detailed logs for audit and debugging

## Troubleshooting

### Common Issues

1. **High Storage Costs**: 
   - Check if cleanup jobs are running
   - Verify environment variables are set correctly
   - Monitor upload volumes vs. cleanup frequency

2. **Missing Data**:
   - Check retention settings
   - Verify cleanup isn't too aggressive
   - Review logs for unexpected deletions

3. **Cleanup Failures**:
   - Check admin permissions
   - Verify database connectivity
   - Review storage bucket permissions

### Debug Commands

```bash
# Check service status
curl https://your-domain.com/api/cleanup

# Run cleanup with verbose output
curl -X POST https://your-domain.com/api/cleanup \
  -H "Content-Type: application/json" \
  -d '{"skipExpiredPreauth": false}'
```
