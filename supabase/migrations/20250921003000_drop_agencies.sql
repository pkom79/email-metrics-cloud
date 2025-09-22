-- Decommission Agencies: drop related tables, functions, and policies.
-- Keeps notifications types and outbox table intact (agency topics remain but unused).

begin;

-- Drop triggers that reference agency helpers
drop trigger if exists trg_before_agency_users_insert_quota on public.agency_users;
drop trigger if exists trg_before_agency_accounts_insert_quota on public.agency_accounts;

-- Drop policies
drop policy if exists agencies_owner_or_admin on public.agencies;
drop policy if exists agency_users_manage on public.agency_users;
drop policy if exists agency_accounts_manage on public.agency_accounts;
drop policy if exists agency_user_accounts_manage on public.agency_user_accounts;
drop policy if exists link_requests_owner_or_admin on public.link_requests;

-- Drop access helpers
drop function if exists public.is_agency_user_of_account(uuid);

-- Restore is_account_member() without agency inclusion
create or replace function public.is_account_member(p_account uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account and a.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.account_users au
    where au.account_id = p_account and au.user_id = auth.uid()
  );
$$;

-- Drop tables (order respects FKs)
drop table if exists public.agency_user_accounts cascade;
drop table if exists public.agency_accounts cascade;
drop table if exists public.agency_users cascade;
drop table if exists public.link_requests cascade;
drop table if exists public.agencies cascade;

-- Note: keep enum types to avoid dependency breakage in historical data or code; optional cleanup later.

commit;

