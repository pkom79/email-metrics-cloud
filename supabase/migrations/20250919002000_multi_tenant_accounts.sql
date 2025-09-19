-- Multi-tenant accounts: memberships, invitations, CSV metadata, and audit log
-- Adds new tables and policies without changing existing accounts/flows.

begin;

-- Extensions needed
create extension if not exists citext;

-- Types
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='account_role') then
    create type public.account_role as enum ('owner','member');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='invite_status') then
    create type public.invite_status as enum ('pending','accepted','revoked','expired');
  end if;
end $$;

-- Account membership (in addition to accounts.owner_user_id)
create table if not exists public.account_users (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.account_role not null,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- Ensure at most one explicit owner row per account (owner also represented in accounts.owner_user_id)
create unique index if not exists account_users_one_owner_per_account
  on public.account_users (account_id)
  where (role = 'owner');

-- Invitations
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  email citext not null,
  token_hash text not null,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  invited_by uuid not null references auth.users(id) on delete restrict,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists invitations_unique_pending_email
  on public.invitations (account_id, email)
  where (status = 'pending');
create unique index if not exists invitations_token_hash_unique
  on public.invitations (token_hash);

-- CSV metadata (file bytes live in Storage; path convention accountId/*)
create table if not exists public.csv_files (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  byte_size bigint not null check (byte_size >= 0),
  checksum text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists csv_files_account_id_idx on public.csv_files(account_id);

-- Audit log
create table if not exists public.audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  details jsonb
);
create index if not exists audit_log_account_id_idx on public.audit_log(account_id);
create index if not exists audit_log_actor_idx on public.audit_log(actor_user_id);

-- Quota helpers
create or replace function public.active_member_count(p_account uuid)
returns integer language sql stable as $$
  select count(*)::int
  from public.account_users au
  where au.account_id = p_account and au.role = 'member';
$$;

create or replace function public.pending_invite_count(p_account uuid)
returns integer language sql stable as $$
  select count(*)::int
  from public.invitations i
  where i.account_id = p_account and i.status = 'pending' and i.expires_at > now();
$$;

create or replace function public.assert_member_quota(p_account uuid)
returns void language plpgsql as $$
declare member_count int; begin
  select public.active_member_count(p_account) into member_count;
  if member_count >= 5 then
    raise exception 'Member limit reached (max 5) for account %', p_account;
  end if;
end $$;

create or replace function public.assert_invite_quota(p_account uuid)
returns void language plpgsql as $$
declare member_count int; pending_count int; begin
  select public.active_member_count(p_account), public.pending_invite_count(p_account)
    into member_count, pending_count;
  if (member_count + pending_count) >= 5 then
    raise exception 'Invite limit reached: members(%) + pending(%) >= 5 for account %', member_count, pending_count, p_account;
  end if;
end $$;

-- Triggers enforcing quotas
create or replace function public.trg_account_users_enforce_member_quota()
returns trigger language plpgsql as $$
begin
  if new.role = 'member' then
    perform public.assert_member_quota(new.account_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_before_account_users_insert_quota on public.account_users;
create trigger trg_before_account_users_insert_quota
  before insert on public.account_users
  for each row execute function public.trg_account_users_enforce_member_quota();

drop trigger if exists trg_before_account_users_update_quota on public.account_users;
create trigger trg_before_account_users_update_quota
  before update of role on public.account_users
  for each row when (new.role = 'member')
  execute function public.trg_account_users_enforce_member_quota();

create or replace function public.trg_invitations_enforce_invite_quota()
returns trigger language plpgsql as $$
begin
  if new.status = 'pending' then
    perform public.assert_invite_quota(new.account_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_before_invitations_insert_quota on public.invitations;
create trigger trg_before_invitations_insert_quota
  before insert on public.invitations
  for each row execute function public.trg_invitations_enforce_invite_quota();

-- Role helpers (integrate with existing accounts.owner_user_id)
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

create or replace function public.is_account_owner(p_account uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account and a.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.account_users au
    where au.account_id = p_account and au.user_id = auth.uid() and au.role = 'owner'
  );
$$;

-- Audit RPC helper
create or replace function public.audit_log_event(
  p_action text,
  p_target_table text,
  p_target_id uuid,
  p_account_id uuid,
  p_details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_user_id, account_id, action, target_table, target_id, details)
  values (auth.uid(), p_account_id, p_action, p_target_table, p_target_id, p_details);
$$;

-- RLS enablement
alter table public.account_users enable row level security;
alter table public.invitations enable row level security;
alter table public.csv_files enable row level security;
alter table public.audit_log enable row level security;

-- Policies: restrict to authenticated; allow is_admin() bypass

-- account_users
drop policy if exists "account_users_select_member_or_admin" on public.account_users;
create policy "account_users_select_member_or_admin" on public.account_users
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.account_users me
      where me.account_id = account_users.account_id and me.user_id = auth.uid()
    ) or exists (
      select 1 from public.accounts a where a.id = account_users.account_id and a.owner_user_id = auth.uid()
    )
  );

drop policy if exists "account_users_insert_owner_or_admin" on public.account_users;
create policy "account_users_insert_owner_or_admin" on public.account_users
  for insert to authenticated with check (
    public.is_admin()
    or (
      -- Allow inserting yourself as owner (optional future path) if no owner row exists
      user_id = auth.uid() and role = 'owner'
      and not exists (
        select 1 from public.account_users ou where ou.account_id = account_id and ou.role = 'owner'
      )
    )
    or (
      -- Owner adds a member (commonly via invite acceptance handled server-side)
      public.is_account_owner(account_id) and role = 'member'
    )
  );

drop policy if exists "account_users_delete_owner_or_admin" on public.account_users;
create policy "account_users_delete_owner_or_admin" on public.account_users
  for delete to authenticated using (
    public.is_admin() or (public.is_account_owner(account_users.account_id) and account_users.role = 'member')
  );

-- invitations
drop policy if exists "invitations_select_owner_or_admin" on public.invitations;
create policy "invitations_select_owner_or_admin" on public.invitations
  for select to authenticated using (public.is_admin() or public.is_account_owner(account_id));

drop policy if exists "invitations_insert_owner_or_admin" on public.invitations;
create policy "invitations_insert_owner_or_admin" on public.invitations
  for insert to authenticated with check (
    public.is_admin() or (public.is_account_owner(account_id) and invited_by = auth.uid())
  );

drop policy if exists "invitations_delete_owner_or_admin" on public.invitations;
create policy "invitations_delete_owner_or_admin" on public.invitations
  for delete to authenticated using (
    public.is_admin() or (public.is_account_owner(account_id) and status = 'pending')
  );

-- csv_files
drop policy if exists "csv_files_select_member_or_admin" on public.csv_files;
create policy "csv_files_select_member_or_admin" on public.csv_files
  for select to authenticated using (public.is_admin() or public.is_account_member(account_id));

drop policy if exists "csv_files_insert_member_or_admin" on public.csv_files;
create policy "csv_files_insert_member_or_admin" on public.csv_files
  for insert to authenticated with check (
    public.is_admin() or (public.is_account_member(account_id) and uploaded_by = auth.uid())
  );

-- audit_log
drop policy if exists "audit_log_select_member_or_admin" on public.audit_log;
create policy "audit_log_select_member_or_admin" on public.audit_log
  for select to authenticated using (public.is_admin() or public.is_account_member(account_id));

drop policy if exists "audit_log_insert_actor_matches" on public.audit_log;
create policy "audit_log_insert_actor_matches" on public.audit_log
  for insert to authenticated with check (auth.uid() is not null and actor_user_id = auth.uid());

commit;
