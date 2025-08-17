-- Create preauth-uploads bucket if missing (safe via CLI)
insert into storage.buckets (id, name, public)
values ('preauth-uploads', 'preauth-uploads', false)
on conflict (id) do nothing;

-- Switch to storage owner to manage policies
set role supabase_admin;

-- Ensure RLS is enabled on storage.objects
alter table storage.objects enable row level security;

-- Reset policies to avoid conflicts
drop policy if exists "service_role_all" on storage.objects;
drop policy if exists "account_read_bound_objects" on storage.objects;
drop policy if exists "account_manage_bound_objects" on storage.objects;

-- SERVICE ROLE full access
create policy "service_role_all" on storage.objects
as permissive for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Account-scoped read for bound objects
create policy "account_read_bound_objects" on storage.objects
for select to authenticated
using (
  bucket_id = 'preauth-uploads'
  and (name like ('accounts/' || public.current_account_id()::text || '/%'))
);

-- Account-scoped insert/update/delete
create policy "account_manage_bound_objects" on storage.objects
for all to authenticated
using (
  bucket_id = 'preauth-uploads'
  and (name like ('accounts/' || public.current_account_id()::text || '/%'))
)
with check (
  bucket_id = 'preauth-uploads'
  and (name like ('accounts/' || public.current_account_id()::text || '/%'))
);

reset role;
