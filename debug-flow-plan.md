# Email Metrics Upload Linking Debug Plan

## The Complete Flow
1. **Upload Files** → `upload/init` sets `pending-upload-ids` cookie
2. **Create Account** → Supabase sends confirmation email  
3. **Confirm Email** → `auth/callback` calls `link-pending-uploads`
4. **Link Uploads** → `link-pending-uploads` reads cookie and binds uploads to account
5. **Dashboard** → Should show metrics from linked uploads

## Debug Steps

### Step 1: Check Cookie Setting
```bash
# Test upload initialization
curl -X POST http://localhost:3000/api/upload/init -H "Content-Type: application/json" -v
```
**Expected**: Should see `Set-Cookie: pending-upload-ids=[...]`

### Step 2: Check Auth Callback Cookie Forwarding
Add logging to auth callback to see:
- Original cookies received
- Whether pending-upload-ids is present
- What cookies are forwarded to link-pending-uploads

### Step 3: Check Link Pending Uploads
Add logging to link-pending-uploads to see:
- What cookies are received
- Whether pending-upload-ids is found
- Upload IDs being processed
- Account linking results

### Step 4: Check Database State
```sql
-- Check uploads table
SELECT id, status, account_id, created_at, expires_at FROM uploads ORDER BY created_at DESC LIMIT 10;

-- Check accounts table  
SELECT id, email, created_at FROM accounts ORDER BY created_at DESC LIMIT 5;

-- Check snapshots table
SELECT id, account_id, upload_id, created_at FROM snapshots ORDER BY created_at DESC LIMIT 5;
```

### Step 5: Check Dashboard Data Loading
Add logging to dashboard to see:
- What user ID is being used
- What snapshots are found for the user
- Whether data is being loaded properly

## Current Test Scenario
User uploads files → creates account → confirms email → dashboard shows no metrics

## Next Steps
1. Add comprehensive logging to all endpoints
2. Test the complete flow with logging
3. Identify where the chain breaks
4. Fix the specific issue
