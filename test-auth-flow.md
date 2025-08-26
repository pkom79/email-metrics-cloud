# Email Confirmation & Data Linking Debug Guide

## Summary of Changes Made

1. **Enhanced auth callback error handling** (`/app/auth/callback/route.ts`):
   - Added proper error handling and logging for link-pending-uploads call
   - Redirect to dashboard with error parameters when linking fails
   - No longer silently swallow errors

2. **Improved link-pending-uploads logging** (`/app/api/auth/link-pending-uploads/route.ts`):
   - Added comprehensive console logging at each step
   - Better error messages and status tracking
   - Logs account creation, file verification, upload binding, and snapshot creation

3. **Enhanced link-upload logging** (`/app/api/auth/link-upload/route.ts`):
   - Added logging for single upload linking (used by client-side retry mechanism)

4. **Dashboard debug panel** (`/components/dashboard/DashboardHeavy.tsx`):
   - Added URL parameter checking for `link_error` and `status`
   - Shows debug warning when linking fails
   - Provides user feedback on linking issues

## Testing the Flow

### 1. Upload Files (Pre-auth)
- Visit homepage and upload CSV files
- Check browser console for upload IDs being stored in cookies
- Verify files appear in `preauth-uploads` bucket

### 2. Create Account & Confirm Email
- Complete signup form
- Check email for confirmation link
- Click confirmation link

### 3. Monitor the Linking Process
Check server logs for the following sequence:

```
Auth callback: Attempting to link pending uploads...
link-pending-uploads: Starting process
link-pending-uploads: User authenticated: [user-id]
link-pending-uploads: Raw cookie value: ["upload-id"]
link-pending-uploads: Parsed upload IDs: ["upload-id"]
link-pending-uploads: Looking for existing account for user: [user-id]
link-pending-uploads: Found existing account: [account-id] OR Creating new account
link-pending-uploads: Processing upload ID: [upload-id]
link-pending-uploads: Found files for [upload-id]: ["campaigns.csv", "flows.csv", "subscribers.csv"]
link-pending-uploads: Binding upload [upload-id] to account [account-id]
link-pending-uploads: Creating snapshot for upload [upload-id]
link-pending-uploads: Successfully processed [upload-id], snapshot: [snapshot-id]
link-pending-uploads: Triggering processing for upload [upload-id]
link-pending-uploads: Clearing pending-upload-ids cookie
link-pending-uploads: Final result: { processedCount: 1, totalCount: 1, results: [...] }
```

### 4. Check Dashboard
- Should redirect to `/dashboard` after email confirmation
- If linking failed, you'll see a debug warning panel
- Check browser console for any client-side errors

## Diagnostic SQL Queries

Run these in your Supabase SQL editor to check data flow:

```sql
-- Check upload status
SELECT id, status, account_id, created_at, error 
FROM uploads 
WHERE status IN ('preauth', 'bound', 'processing', 'processed')
ORDER BY created_at DESC LIMIT 10;

-- Check snapshots created
SELECT s.id, s.account_id, s.upload_id, s.label, s.status, 
       a.owner_user_id, a.name as account_name
FROM snapshots s
LEFT JOIN accounts a ON s.account_id = a.id
ORDER BY s.created_at DESC LIMIT 10;

-- Check processed data
SELECT COUNT(*) as total_metrics
FROM snapshot_totals st
JOIN snapshots s ON st.snapshot_id = s.id
WHERE s.created_at > NOW() - INTERVAL '1 day';

-- Check daily series data
SELECT COUNT(*) as total_series_points
FROM snapshot_series ss
JOIN snapshots s ON ss.snapshot_id = s.id
WHERE s.created_at > NOW() - INTERVAL '1 day';
```

## Common Issues & Solutions

### Issue: "No pending uploads" message
- **Cause**: Cookie not set or cleared prematurely
- **Check**: Browser dev tools > Application > Cookies for `pending-upload-ids`
- **Solution**: Ensure upload completes before account creation

### Issue: "Missing required files" error
- **Cause**: Upload incomplete or files not in preauth-uploads bucket
- **Check**: Supabase Storage > preauth-uploads bucket
- **Solution**: Re-upload files ensuring all 3 CSVs are present

### Issue: Dashboard shows no data after confirmation
- **Check**: Server logs for linking errors
- **Check**: URL for `?link_error=` parameters
- **Solution**: Check database tables and storage consistency

### Issue: Account not created
- **Cause**: Database constraint or user metadata issues
- **Check**: Server logs during account creation step
- **Solution**: Verify user metadata and database permissions

## Next Steps

If issues persist:
1. Check server logs during the email confirmation process
2. Run diagnostic SQL queries to trace data flow
3. Verify Supabase RLS policies and permissions
4. Test with a fresh browser session to avoid cookie conflicts
