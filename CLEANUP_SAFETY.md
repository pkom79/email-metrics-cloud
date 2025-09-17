# Safe Data Cleanup System

This system provides automated data cleanup with robust guardrails to protect vital user data while removing unnecessary files.

## Safety Guardrails

The cleanup system follows strict safety rules to prevent accidental data loss:

### NEVER DELETE:
- ✅ Uploads that have associated snapshots (processed user data)
- ✅ Bound/processing/processed uploads for active accounts
- ✅ The only upload with snapshots for an account
- ✅ Recent uploads (within retention period)

### SAFE TO DELETE:
- ❌ Preauth uploads that expired and were never linked to accounts
- ❌ Old uploads for active accounts (keeping most recent with snapshots)
- ❌ All data for accounts deleted past retention period
- ❌ Orphaned snapshots (upload no longer exists)

## Cleanup Operations

### 1. Orphaned Preauth Cleanup
- **Target**: Uploads with status `preauth`, no `account_id`, past `expires_at`
- **Safety**: Double-checks no snapshots exist before deletion
- **Action**: Remove files, mark as `expired` (keep record for audit)

### 2. Old Uploads for Active Accounts
- **Target**: Multiple uploads per account, keeping most recent with snapshots
- **Safety**: Verifies account is active, ensures at least one upload with snapshots remains
- **Action**: Remove old upload files, snapshots, and records

### 3. Permanently Deleted Accounts
- **Target**: Accounts soft-deleted > retention period (default 30 days)
- **Safety**: Only processes accounts past retention cutoff
- **Action**: Remove all storage, use RPC to purge related data, hard delete account

### 4. Orphaned Snapshots
- **Target**: Snapshots pointing to non-existent uploads
- **Safety**: Double-checks upload doesn't exist before deletion
- **Action**: Remove orphaned snapshot records

## Environment Variables

```bash
# Retention period for soft-deleted accounts (days)
ACCOUNT_RETENTION_DAYS=30

# Ingest uploads bucket name (fallback to PREAUTH_BUCKET if unset)
DATA_INGEST_BUCKET=preauth-uploads
```

## API Endpoints

### Master Cleanup
`POST /api/cleanup`
- Orchestrates all cleanup operations
- Returns summary with protection stats
- Can be called by cron jobs

### Individual Operations
- `POST /api/preauth/cleanup-batch` - Preauth and snapshot cleanup
- `POST /api/uploads/cleanup-old` - Old uploads for active accounts  
- `POST /api/accounts/cleanup-deleted` - Permanently deleted accounts

## Response Format

```json
{
  "ok": true,
  "summary": {
    "totalExpiredPreauth": 0,
    "totalOldUploads": 0, 
    "totalDeletedAccounts": 0,
    "totalOrphanedSnapshots": 0,
    "totalProtected": 5,
    "totalErrors": []
  },
  "details": {
    "operations": {
      "expiredPreauth": {
        "orphanedPreauth": 0,
        "protected": 3,
        "errors": []
      }
    }
  }
}
```

## Protection Stats

The `totalProtected` field shows how many uploads were protected by safety guardrails:
- Uploads with snapshots (vital data)
- Only upload with snapshots for an account
- Active account verification failures

## Monitoring

- All operations are logged with detailed reasoning
- Protection events are logged as "PROTECTED" with explanation
- Error tracking for failed operations
- Audit trail maintained for compliance

## Cron Job Setup

For automated daily cleanup at 2 AM EST:
```bash
0 7 * * * curl -X POST https://your-domain.com/api/cleanup
```

The system is designed to be fail-safe - when in doubt, it protects the data rather than deleting it.
