-- Revert database to single-account owner model.

begin;

-- Drop triggers and functions introduced for multi-user support
drop trigger if exists trg_accounts_owner_membership on public.accounts;
drop trigger if exists trg_before_account_users_insert_quota on public.account_users;
drop trigger if exists trg_before_account_users_update_quota on public.account_users;
drop trigger if exists trg_before_invitations_insert_quota on public.invitations;

drop function if exists public.ensure_account_owner_membership();
drop function if exists public.account_role_for_user(uuid, uuid);
drop function if exists public.is_account_owner(uuid, uuid);
drop function if exists public.is_account_member(uuid, uuid);
drop function if exists public.active_member_count(uuid);
drop function if exists public.pending_invite_count(uuid);
drop function if exists public.assert_member_quota(uuid);
drop function if exists public.assert_invite_quota(uuid);
drop function if exists public.trg_account_users_enforce_member_quota();
drop function if exists public.trg_invitations_enforce_invite_quota();

-- Drop unused tables
drop table if exists public.invitations cascade;
drop table if exists public.account_users cascade;

-- Drop enum types if they still exist
do $$
begin
  if exists (select 1 from pg_type where typname = 'invite_status' and typnamespace = 'public'::regnamespace) then
    execute 'drop type public.invite_status';
  end if;
  if exists (select 1 from pg_type where typname = 'account_role' and typnamespace = 'public'::regnamespace) then
    execute 'drop type public.account_role';
  end if;
end$$;

-- Replace helper functions with single-owner implementations
create or replace function public.is_account_member(p_account uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account and a.owner_user_id = auth.uid()
  );
$$;

create or replace function public.is_account_owner(p_account uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account and a.owner_user_id = auth.uid()
  );
$$;

commit;
