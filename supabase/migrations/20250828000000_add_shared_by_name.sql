-- Add name field to snapshot_shares table to store the name of the person sharing

alter table public.snapshot_shares 
add column if not exists shared_by_name text;

-- Add comment for documentation
comment on column public.snapshot_shares.shared_by_name is 'Name of the person sharing the dashboard';
