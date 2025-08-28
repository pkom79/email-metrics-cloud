-- Enable anonymous users to access shared snapshots and their CSV data

-- Allow anonymous users to read shared snapshots
create policy "Anonymous users can read shared snapshots"
on snapshots for select
to authenticated
using (
  -- Check if this snapshot has an active share
  exists (
    select 1 from snapshot_shares 
    where snapshot_id = snapshots.id 
    and is_active = true 
    and (expires_at is null or expires_at > now())
  )
  -- Only allow anonymous users (not regular authenticated users via this policy)
  and (auth.jwt()->>'is_anonymous')::boolean is true
);

-- Allow anonymous users to read storage files for shared snapshots
-- Note: This policy needs to be added to the storage.objects table in the Supabase dashboard
-- under Storage > Settings > Policies, not through SQL migration

-- For now, we'll update the existing RLS policy in the CSV download API to handle anonymous users
