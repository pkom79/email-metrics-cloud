-- Storage RLS for csv-uploads bucket using account_id_from_path + is_account_member()
-- Enables agency-entitled users to read/write CSVs for linked brands, while keeping bucket private.

begin;

-- Helper: extract account_id (uuid) from first path segment of object name
create or replace function public.account_id_from_path(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  seg text;
  out_id uuid;
begin
  seg := split_part(coalesce(p_name, ''), '/', 1);
  begin
    out_id := seg::uuid;
  exception when others then
    return null;
  end;
  return out_id;
end $$;

-- Enable RLS if possible; ignore insufficient privilege
do $$ begin
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then null; end;
end $$;

-- Authenticated users: allow read/write in csv-uploads for brand owners/members OR agency-entitled users
drop policy if exists "authenticated_csv_uploads_member_or_agency" on storage.objects;
create policy "authenticated_csv_uploads_member_or_agency" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'csv-uploads'
    and (
      public.is_admin()
      or public.is_account_member(public.account_id_from_path(name))
    )
  )
  with check (
    bucket_id = 'csv-uploads'
    and (
      public.is_admin()
      or public.is_account_member(public.account_id_from_path(name))
    )
  );

-- Ensure service role policy exists (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'service_role_csv_uploads_access'
  ) then
    execute $p$create policy "service_role_csv_uploads_access" on storage.objects
      for all to service_role using (bucket_id = 'csv-uploads') with check (bucket_id = 'csv-uploads')$p$;
  end if;
end $$;

-- Optionally ensure bucket exists
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'csv-uploads') then
    insert into storage.buckets (id, name, public) values ('csv-uploads', 'csv-uploads', false);
  end if;
end $$;

commit;
