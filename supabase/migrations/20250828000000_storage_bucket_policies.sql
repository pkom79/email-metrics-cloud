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

-- (Removed anonymous_shared_access policy referencing snapshot_shares)
