-- Per-account integrations storage (Klaviyo API keys)
-- Adds table with owner/admin RLS and service-role full access

begin;

create table if not exists public.account_integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('klaviyo')),
  -- Encrypted API key blob (base64 or json containing iv/tag/ciphertext)
  encrypted_api_key text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider)
);

alter table public.account_integrations enable row level security;

-- RLS: owners can select/insert/update their rows; admins can access; service_role bypasses RLS.
drop policy if exists "ai_owner_or_admin_select" on public.account_integrations;
create policy "ai_owner_or_admin_select" on public.account_integrations
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.accounts a where a.id = account_integrations.account_id and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists "ai_owner_insert" on public.account_integrations;
create policy "ai_owner_insert" on public.account_integrations
  for insert to authenticated
  with check (
    public.is_admin() or exists (
      select 1 from public.accounts a where a.id = account_integrations.account_id and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists "ai_owner_update" on public.account_integrations;
create policy "ai_owner_update" on public.account_integrations
  for update to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.accounts a where a.id = account_integrations.account_id and a.owner_user_id = auth.uid()
    )
  )
  with check (
    public.is_admin() or exists (
      select 1 from public.accounts a where a.id = account_integrations.account_id and a.owner_user_id = auth.uid()
    )
  );

commit;

