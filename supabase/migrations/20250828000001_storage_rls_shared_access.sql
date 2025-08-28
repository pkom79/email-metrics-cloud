-- Create RLS policies for storage buckets to allow shared access
-- This migration creates bucket-specific policies for shared CSV access

-- First, ensure RLS is enabled on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow public read access to csv-uploads bucket (for shared dashboards)
DROP POLICY IF EXISTS "public_csv_uploads_read" ON storage.objects;
CREATE POLICY "public_csv_uploads_read" ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'csv-uploads');

-- Policy 2: Allow authenticated users to access their own files in uploads bucket
DROP POLICY IF EXISTS "authenticated_uploads_select" ON storage.objects;
CREATE POLICY "authenticated_uploads_select" ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
);

-- Policy 3: Allow authenticated users to access their own files in csv-uploads bucket
DROP POLICY IF EXISTS "authenticated_csv_uploads_select" ON storage.objects;
CREATE POLICY "authenticated_csv_uploads_select" ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'csv-uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
);

-- Policy 4: Allow shared access to csv-uploads via valid share tokens
DROP POLICY IF EXISTS "shared_csv_uploads_access" ON storage.objects;
CREATE POLICY "shared_csv_uploads_access" ON storage.objects
FOR SELECT
TO public
USING (
    bucket_id = 'csv-uploads' AND
    (storage.foldername(name))[1] IN (
        SELECT s.account_id::text 
        FROM snapshots s
        JOIN snapshot_shares ss ON s.id = ss.snapshot_id
        WHERE ss.is_active = true
        AND (ss.expires_at IS NULL OR ss.expires_at > NOW())
    )
);

-- Policy 5: Allow shared access to uploads bucket via valid share tokens  
DROP POLICY IF EXISTS "shared_uploads_access" ON storage.objects;
CREATE POLICY "shared_uploads_access" ON storage.objects
FOR SELECT
TO public
USING (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] IN (
        SELECT s.account_id::text 
        FROM snapshots s
        JOIN snapshot_shares ss ON s.id = ss.snapshot_id
        WHERE ss.is_active = true
        AND (ss.expires_at IS NULL OR ss.expires_at > NOW())
    )
);

-- Policy 6: Allow service role to manage all files (for backend operations)
DROP POLICY IF EXISTS "service_role_all_access" ON storage.objects;
CREATE POLICY "service_role_all_access" ON storage.objects
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy 7: Allow authenticated users to insert/update their own files in uploads
DROP POLICY IF EXISTS "authenticated_uploads_insert" ON storage.objects;
CREATE POLICY "authenticated_uploads_insert" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
);

-- Policy 8: Allow authenticated users to insert/update their own files in csv-uploads
DROP POLICY IF EXISTS "authenticated_csv_uploads_insert" ON storage.objects;
CREATE POLICY "authenticated_csv_uploads_insert" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'csv-uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
);

-- Policy 9: Allow anonymous access to preauth-uploads (for file uploads before auth)
DROP POLICY IF EXISTS "anonymous_preauth_uploads" ON storage.objects;
CREATE POLICY "anonymous_preauth_uploads" ON storage.objects
FOR ALL
TO anon
USING (bucket_id = 'preauth-uploads')
WITH CHECK (bucket_id = 'preauth-uploads');
