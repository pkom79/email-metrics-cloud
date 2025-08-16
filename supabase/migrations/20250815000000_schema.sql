-- Schema for Account Module (cloud)
-- Apply in the new Supabase project

create extension if not exists pgcrypto;
create extension if not exists pgjwt;

-- accounts: single-user workspace
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null, -- auth.users.id
  name text not null,
  company text,
  country text,
  created_at timestamptz not null default now()
);

-- uploads: may start pre-auth (account_id null) then bind
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
create index if not exists uploads_expires_at_idx on public.uploads (expires_at);

-- upload files: three kinds
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
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

-- snapshots: immutable derived data created from an upload
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  upload_id uuid references public.uploads(id) on delete set null,
  label text not null, -- e.g., last email activity date
  last_email_date date,
  status text not null check (status in ('ready','error')) default 'ready',
  created_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);
create index if not exists snapshots_account_id_idx on public.snapshots (account_id);
create index if not exists snapshots_created_at_desc_idx on public.snapshots (created_at desc);

-- totals per snapshot
create table if not exists public.snapshot_totals (
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  metric_key text not null,
  value numeric not null,
  primary key (snapshot_id, metric_key)
);

-- daily series per snapshot (to support various date ranges/granularity)
create table if not exists public.snapshot_series (
  id bigserial primary key,
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  metric_key text not null,
  date date not null,
  value numeric not null,
  unique (snapshot_id, metric_key, date)
);
create index if not exists snapshot_series_idx on public.snapshot_series (snapshot_id, metric_key, date);

-- helper: simple admin flag via JWT claim; service_role bypasses policies
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin', false)
$$;

-- helper: current account id pulled from JWT claim (set at login)
create or replace function public.current_account_id()
returns uuid language sql stable as $$
  select (current_setting('request.jwt.claims', true)::jsonb ->> 'account_id')::uuid
$$;
