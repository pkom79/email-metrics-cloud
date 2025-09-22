-- Rename team role from 'member' to 'manager' across DB logic and data.
-- Keeps enum value 'member' for compatibility (cannot drop enum value safely),
-- but updates rows and policies to use 'manager' going forward.

begin;

-- Ensure enum includes 'manager'
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'account_role' and e.enumlabel = 'manager'
  ) then
    alter type public.account_role add value 'manager';
  end if;
end $$;

-- Update existing rows
update public.account_users set role = 'manager' where role = 'member';

-- Quota helpers: count managers (include legacy 'member' values defensively)
create or replace function public.active_member_count(p_account uuid)
returns integer language sql stable as $$
  select count(*)::int
  from public.account_users au
  where au.account_id = p_account and au.role in ('manager','member');
$$;

create or replace function public.trg_account_users_enforce_member_quota()
returns trigger language plpgsql as $$
begin
  if new.role in ('manager','member') then
    perform public.assert_member_quota(new.account_id);
  end if;
  return new;
end $$;

-- Policies: owner may add/remove managers (legacy 'member' accepted for delete paths)
drop policy if exists "account_users_insert_owner_or_admin" on public.account_users;
create policy "account_users_insert_owner_or_admin" on public.account_users
  for insert to authenticated with check (
    public.is_admin()
    or (
      user_id = auth.uid() and role = 'owner'
      and not exists (
        select 1 from public.account_users ou where ou.account_id = account_id and ou.role = 'owner'
      )
    )
    or (
      public.is_account_owner(account_id) and role = 'manager'
    )
  );

drop policy if exists "account_users_delete_owner_or_admin" on public.account_users;
create policy "account_users_delete_owner_or_admin" on public.account_users
  for delete to authenticated using (
    public.is_admin() or (public.is_account_owner(account_users.account_id) and account_users.role in ('manager','member'))
  );

commit;

