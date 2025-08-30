-- Baseline schema & policies (post snapshot-sharing purge)
-- Generated: 2025-08-29
-- Consolidates prior migrations:
-- 20250815000000_schema.sql
-- 20250815000100_rls.sql
-- 20250815000200_account_soft_delete.sql
-- 20250824000000_account_autocreate_and_backfill.sql
-- 20250825000000_rls_account_claim_removal.sql
-- 20250828000000_storage_bucket_policies.sql
-- 20250829001000_cleanup_remove_snapshot_sharing_artifacts.sql

begin;

create extension if not exists pgcrypto;
create extension if not exists pgjwt;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null,
  company text,
  country text,
  store_url text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists accounts_deleted_at_idx on public.accounts (deleted_at);

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  status text not null check (status in ('preauth','bound','processing','processed','error','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  error text
);
create index if not exists uploads_account_id_idx on public.uploads (account_id);
create index if not exists uploads_status_idx on public.uploads (status);
create index if not exists uploads_status_idx2 on public.uploads (status);
create index if not exists uploads_account_id_idx2 on public.uploads (account_id);
create index if not exists uploads_expires_at_idx on public.uploads (expires_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'upload_kind' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.upload_kind AS ENUM ('subscribers','flows','campaigns');
  END IF;
END $$;

create table if not exists public.upload_files (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.uploads(id) on delete cascade,
  kind public.upload_kind not null,
  storage_path text not null,
  bytes bigint not null,
  checksum text,
  created_at timestamptz not null default now(),
  unique (upload_id, kind)
);
create index if not exists upload_files_upload_id_idx on public.upload_files (upload_id);

create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  upload_id uuid references public.uploads(id) on delete set null,
  label text not null,
  last_email_date date,
  status text not null check (status in ('ready','error')) default 'ready',
  created_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);
create index if not exists snapshots_account_id_idx on public.snapshots (account_id);
create index if not exists snapshots_account_id_idx2 on public.snapshots (account_id);
create index if not exists snapshots_created_at_desc_idx on public.snapshots (created_at desc);

create table if not exists public.snapshot_totals (
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  metric_key text not null,
  value numeric not null,
  primary key (snapshot_id, metric_key)
);

create table if not exists public.snapshot_series (
  id bigserial primary key,
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  metric_key text not null,
  date date not null,
  value numeric not null,
  unique (snapshot_id, metric_key, date)
);
create index if not exists snapshot_series_idx on public.snapshot_series (snapshot_id, metric_key, date);

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin', false)
$$;

create or replace function public.current_account_id()
returns uuid language sql stable as $$
  select (current_setting('request.jwt.claims', true)::jsonb ->> 'account_id')::uuid
$$;

create or replace function public.purge_account_children(p_account_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from public.snapshots where account_id = p_account_id;
  delete from public.uploads where account_id = p_account_id;
end;$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_business_name text;
  v_name text;
  v_country text;
  v_store_url text;
begin
  v_business_name := nullif(trim(new.raw_user_meta_data->>'businessName'), '');
  v_country := nullif(trim(new.raw_user_meta_data->>'country'), '');
  v_store_url := nullif(trim(new.raw_user_meta_data->>'storeUrl'), '');
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), new.email, 'Account');
  if not exists (select 1 from public.accounts a where a.owner_user_id = new.id) then
    insert into public.accounts (owner_user_id, name, company, country, store_url)
    values (new.id, v_name, v_business_name, v_country, v_store_url);
  end if;
  return new;
end;$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.accounts enable row level security;
alter table public.uploads enable row level security;
alter table public.upload_files enable row level security;
alter table public.snapshots enable row level security;
alter table public.snapshot_totals enable row level security;
alter table public.snapshot_series enable row level security;

drop policy if exists "accounts_owner_or_admin" on public.accounts;
create policy "accounts_owner_or_admin" on public.accounts for select using (public.is_admin() or owner_user_id = auth.uid());
drop policy if exists "accounts_owner_insert" on public.accounts;
create policy "accounts_owner_insert" on public.accounts for insert with check (owner_user_id = auth.uid());
drop policy if exists "accounts_owner_update" on public.accounts;
create policy "accounts_owner_update" on public.accounts for update using (public.is_admin() or owner_user_id = auth.uid()) with check (public.is_admin() or owner_user_id = auth.uid());
drop policy if exists "accounts_owner_delete" on public.accounts;
create policy "accounts_owner_delete" on public.accounts for delete using (public.is_admin() or owner_user_id = auth.uid());

drop policy if exists "uploads_select_owner_or_admin" on public.uploads;
create policy "uploads_select_owner_or_admin" on public.uploads for select using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()));
drop policy if exists "uploads_insert_owner_or_admin" on public.uploads;
create policy "uploads_insert_owner_or_admin" on public.uploads for insert with check (public.is_admin() OR (account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid())) OR status = 'preauth');
drop policy if exists "uploads_update_owner_or_admin" on public.uploads;
create policy "uploads_update_owner_or_admin" on public.uploads for update using (public.is_admin() OR (account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid())) OR status = 'preauth') with check (public.is_admin() OR (account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid())) OR status = 'preauth');
drop policy if exists "uploads_delete_owner_or_admin" on public.uploads;
create policy "uploads_delete_owner_or_admin" on public.uploads for delete using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()));

drop policy if exists "upload_files_select_owner_or_admin" on public.upload_files;
create policy "upload_files_select_owner_or_admin" on public.upload_files for select using (public.is_admin() OR EXISTS (SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()));
drop policy if exists "upload_files_insert_owner_or_admin" on public.upload_files;
create policy "upload_files_insert_owner_or_admin" on public.upload_files for insert with check (public.is_admin() OR EXISTS (SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()));
drop policy if exists "upload_files_delete_owner_or_admin" on public.upload_files;
create policy "upload_files_delete_owner_or_admin" on public.upload_files for delete using (public.is_admin() OR EXISTS (SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()));

drop policy if exists "snapshots_select_owner_or_admin" on public.snapshots;
create policy "snapshots_select_owner_or_admin" on public.snapshots for select using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = snapshots.account_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshots_delete_owner_or_admin" on public.snapshots;
create policy "snapshots_delete_owner_or_admin" on public.snapshots for delete using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = snapshots.account_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshot_totals_select_owner_or_admin" on public.snapshot_totals;
create policy "snapshot_totals_select_owner_or_admin" on public.snapshot_totals for select using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_totals.snapshot_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshot_totals_delete_owner_or_admin" on public.snapshot_totals;
create policy "snapshot_totals_delete_owner_or_admin" on public.snapshot_totals for delete using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_totals.snapshot_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshot_series_select_owner_or_admin" on public.snapshot_series;
create policy "snapshot_series_select_owner_or_admin" on public.snapshot_series for select using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_series.snapshot_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshot_series_delete_owner_or_admin" on public.snapshot_series;
create policy "snapshot_series_delete_owner_or_admin" on public.snapshot_series for delete using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_series.snapshot_id AND a.owner_user_id = auth.uid()));

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_csv_uploads_access" ON storage.objects;
CREATE POLICY "service_role_csv_uploads_access" ON storage.objects FOR ALL TO service_role USING (bucket_id = 'csv-uploads') WITH CHECK (bucket_id = 'csv-uploads');
DROP POLICY IF EXISTS "service_role_uploads_access" ON storage.objects;
CREATE POLICY "service_role_uploads_access" ON storage.objects FOR ALL TO service_role USING (bucket_id = 'uploads') WITH CHECK (bucket_id = 'uploads');
DROP POLICY IF EXISTS "authenticated_csv_uploads_access" ON storage.objects;
CREATE POLICY "authenticated_csv_uploads_access" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'csv-uploads' AND (storage.foldername(name))[1] IN (SELECT account_id::text FROM accounts WHERE owner_user_id = auth.uid())) WITH CHECK (bucket_id = 'csv-uploads' AND (storage.foldername(name))[1] IN (SELECT account_id::text FROM accounts WHERE owner_user_id = auth.uid()));
DROP POLICY IF EXISTS "authenticated_uploads_access" ON storage.objects;
CREATE POLICY "authenticated_uploads_access" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] IN (SELECT account_id::text FROM accounts WHERE owner_user_id = auth.uid())) WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[1] IN (SELECT account_id::text FROM accounts WHERE owner_user_id = auth.uid()));

-- Defensive cleanup (old sharing artifacts)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='snapshot_shares') THEN
    EXECUTE 'drop table public.snapshot_shares cascade';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='snapshots' AND column_name='range_start') THEN
    EXECUTE 'alter table public.snapshots drop column if exists range_start';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='snapshots' AND column_name='range_end') THEN
    EXECUTE 'alter table public.snapshots drop column if exists range_end';
  END IF;
  EXECUTE 'drop index if exists public.snapshots_range_start_end_idx';
END $$;

commit;

comment on schema public is 'Baseline after snapshot sharing removal (2025-08-29)';
