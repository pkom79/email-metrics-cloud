-- Continuity Gate support tables

begin;

create table if not exists public.accounts_fingerprint (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last10_profiles jsonb not null default '[]'::jsonb,
  last10_campaigns jsonb not null default '[]'::jsonb,
  last10_flows jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.accounts_fingerprint enable row level security;
drop policy if exists accounts_fingerprint_member on public.accounts_fingerprint;
create policy accounts_fingerprint_member on public.accounts_fingerprint for all to authenticated
using (public.is_account_member(account_id))
with check (public.is_account_member(account_id));

create table if not exists public.account_ingests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  result text not null check (result in ('accept','fail')),
  matches jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists account_ingests_account_id_idx on public.account_ingests(account_id);
alter table public.account_ingests enable row level security;
drop policy if exists account_ingests_member on public.account_ingests;
create policy account_ingests_member on public.account_ingests for select to authenticated
using (public.is_account_member(account_id));

commit;

