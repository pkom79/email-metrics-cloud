-- Fix storage bucket policies for csv-uploads bucket
-- This ensures the service role can access the bucket in production

-- Create RLS policies for storage objects table
-- Allow service role to read from csv-uploads bucket
CREATE POLICY "service_role_read_csv_uploads" ON storage.objects
FOR SELECT USING (bucket_id = 'csv-uploads');

-- Allow service role to insert into csv-uploads bucket
CREATE POLICY "service_role_insert_csv_uploads" ON storage.objects  
FOR INSERT WITH CHECK (bucket_id = 'csv-uploads');

-- Allow service role to update csv-uploads bucket
CREATE POLICY "service_role_update_csv_uploads" ON storage.objects
FOR UPDATE USING (bucket_id = 'csv-uploads') 
WITH CHECK (bucket_id = 'csv-uploads');

-- Allow service role to delete from csv-uploads bucket
CREATE POLICY "service_role_delete_csv_uploads" ON storage.objects
FOR DELETE USING (bucket_id = 'csv-uploads');

-- Also ensure uploads bucket has service role policies (fallback bucket)
CREATE POLICY "service_role_read_uploads" ON storage.objects
FOR SELECT USING (bucket_id = 'uploads');

CREATE POLICY "service_role_insert_uploads" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "service_role_update_uploads" ON storage.objects
FOR UPDATE USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "service_role_delete_uploads" ON storage.objects
FOR DELETE USING (bucket_id = 'uploads');

-- Enable RLS on storage.objects table if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
