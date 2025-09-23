-- Consolidate account role handling and remove unused CSV metadata table.

begin;

-- Drop legacy CSV metadata table (files now live exclusively in Storage).
drop table if exists public.csv_files cascade;

-- Ensure every existing account has a corresponding owner row in account_users.
insert into public.account_users (account_id, user_id, role)
select a.id, a.owner_user_id, 'owner'::public.account_role
from public.accounts a
left join public.account_users au
  on au.account_id = a.id and au.role = 'owner'
where a.owner_user_id is not null
  and au.account_id is null;

-- Helper function to compute a user's role for an account.
create or replace function public.account_role_for_user(
  p_account uuid,
  p_user uuid default auth.uid()
) returns public.account_role
language sql
stable as $$
  select case
    when p_account is null or p_user is null then null
    when exists (
      select 1 from public.accounts a
      where a.id = p_account and a.owner_user_id = p_user
    ) then 'owner'::public.account_role
    when exists (
      select 1 from public.account_users au
      where au.account_id = p_account and au.user_id = p_user and au.role = 'owner'
    ) then 'owner'::public.account_role
    when exists (
      select 1 from public.account_users au
      where au.account_id = p_account and au.user_id = p_user and au.role in ('manager','member')
    ) then 'manager'::public.account_role
    else null
  end;
$$;

-- Rewrite owner/member helpers to use the consolidated role logic.
create or replace function public.is_account_owner(
  p_account uuid,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable as $$
  select public.account_role_for_user(p_account, p_user) = 'owner';
$$;

create or replace function public.is_account_member(
  p_account uuid,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable as $$
  select public.account_role_for_user(p_account, p_user) is not null;
$$;

-- Trigger to keep owner membership row in sync with accounts.owner_user_id.
create or replace function public.ensure_account_owner_membership()
returns trigger language plpgsql as $$
begin
  if new.owner_user_id is null then
    -- If owner cleared, remove explicit owner row.
    delete from public.account_users
    where account_id = new.id and role = 'owner';
  else
    insert into public.account_users (account_id, user_id, role)
    values (new.id, new.owner_user_id, 'owner')
    on conflict (account_id, user_id) do update set role = excluded.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounts_owner_membership on public.accounts;
create trigger trg_accounts_owner_membership
after insert or update of owner_user_id on public.accounts
for each row execute procedure public.ensure_account_owner_membership();

commit;
