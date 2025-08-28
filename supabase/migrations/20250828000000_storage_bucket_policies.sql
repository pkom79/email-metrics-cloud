-- Create proper RLS policies for storage access
-- This ensures proper security while allowing legitimate access

-- First, ensure RLS is enabled on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow service role full access to csv-uploads bucket
CREATE POLICY "service_role_csv_uploads_access" ON storage.objects
FOR ALL 
TO service_role
USING (bucket_id = 'csv-uploads')
WITH CHECK (bucket_id = 'csv-uploads');

-- Policy 2: Allow service role full access to uploads bucket  
CREATE POLICY "service_role_uploads_access" ON storage.objects
FOR ALL
TO service_role  
USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

-- Policy 3: Allow authenticated users to access their own files in csv-uploads
CREATE POLICY "authenticated_csv_uploads_access" ON storage.objects
FOR ALL
TO authenticated
USING (
    bucket_id = 'csv-uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
)
WITH CHECK (
    bucket_id = 'csv-uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
);

-- Policy 4: Allow authenticated users to access their own files in uploads
CREATE POLICY "authenticated_uploads_access" ON storage.objects
FOR ALL
TO authenticated
USING (
    bucket_id = 'uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
)
WITH CHECK (
    bucket_id = 'uploads' AND 
    (storage.foldername(name))[1] IN (
        SELECT account_id::text 
        FROM accounts 
        WHERE owner_user_id = auth.uid()
    )
);

-- Policy 5: Allow anonymous access to shared files via valid share tokens
-- This is for the shared dashboard functionality
CREATE POLICY "anonymous_shared_access" ON storage.objects
FOR SELECT
TO anon
USING (
    bucket_id IN ('csv-uploads', 'uploads') AND
    EXISTS (
        SELECT 1 
        FROM snapshot_shares ss
        JOIN snapshots s ON ss.snapshot_id = s.id
        WHERE ss.is_active = true
        AND (ss.expires_at IS NULL OR ss.expires_at > now())
        AND (
            -- Match by account_id/upload_id pattern
            (s.upload_id IS NOT NULL AND (storage.foldername(name))[1] = s.account_id::text AND (storage.foldername(name))[2] = s.upload_id::text)
            OR
            -- Match by account_id/snapshot_id pattern  
            ((storage.foldername(name))[1] = s.account_id::text AND (storage.foldername(name))[2] = s.id::text)
        )
    )
);
