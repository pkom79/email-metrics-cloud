-- Recreate membership model on remote DB (idempotent) to support multi-account access.
-- Adds account_users, role helpers, owner sync trigger, and updates RLS + storage policies.

begin;

-- Types
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_role' and typnamespace = 'public'::regnamespace) then
    create type public.account_role as enum ('owner','manager');
  end if;
end $$;

-- Membership table
create table if not exists public.account_users (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.account_role not null,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create unique index if not exists account_users_one_owner_per_account
  on public.account_users (account_id)
  where (role = 'owner');
alter table public.account_users enable row level security;

-- Drop policies that depend on legacy is_account_member so we can replace the function
drop policy if exists audit_log_select_member_or_admin on public.audit_log;
drop policy if exists ans_member_manage on public.account_notification_subscriptions;
drop policy if exists account_ingests_member on public.account_ingests;
drop policy if exists accounts_fingerprint_member on public.accounts_fingerprint;
drop policy if exists accounts_select_read on public.accounts;
drop policy if exists authenticated_csv_uploads_member_or_agency on storage.objects;

-- Helper functions
drop function if exists public.is_account_member(uuid);
drop function if exists public.is_account_owner(uuid);
drop function if exists public.account_role_for_user(uuid, uuid);
drop function if exists public.is_account_member(uuid, uuid);
drop function if exists public.is_account_owner(uuid, uuid);
create or replace function public.account_role_for_user(
  p_account uuid,
  p_user uuid default auth.uid()
) returns public.account_role
language sql
stable
set search_path = public
as $$
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
      where au.account_id = p_account and au.user_id = p_user and au.role = 'manager'
    ) then 'manager'::public.account_role
    else null
  end;
$$;

create or replace function public.is_account_owner(
  p_account uuid
) returns boolean
language sql
stable
set search_path = public
as $$
  select public.account_role_for_user(p_account, auth.uid()) = 'owner';
$$;

create or replace function public.is_account_member(
  p_account uuid
) returns boolean
language sql
stable
set search_path = public
as $$
  select public.account_role_for_user(p_account, auth.uid()) is not null;
$$;

-- Owner sync trigger
create or replace function public.ensure_account_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null then
    delete from public.account_users
    where account_id = new.id and role = 'owner';
  else
    delete from public.account_users
    where account_id = new.id and role = 'owner' and user_id <> new.owner_user_id;
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

-- Backfill owner rows
insert into public.account_users (account_id, user_id, role)
select a.id, a.owner_user_id, 'owner'
from public.accounts a
where a.owner_user_id is not null
on conflict (account_id, user_id) do update set role = excluded.role;

-- Policies on account_users
drop policy if exists account_users_select_member_or_admin on public.account_users;
create policy account_users_select_member_or_admin on public.account_users
  for select to authenticated using (
    public.is_admin()
    or account_users.user_id = auth.uid()
    or exists (select 1 from public.accounts a where a.id = account_users.account_id and a.owner_user_id = auth.uid())
  );

drop policy if exists account_users_insert_owner_or_admin on public.account_users;
create policy account_users_insert_owner_or_admin on public.account_users
  for insert to authenticated with check (
    public.is_admin()
    or exists (select 1 from public.accounts a where a.id = account_id and a.owner_user_id = auth.uid())
  );

drop policy if exists account_users_delete_owner_or_admin on public.account_users;
create policy account_users_delete_owner_or_admin on public.account_users
  for delete to authenticated using (
    public.is_admin()
    or (
      account_users.role <> 'owner'
      and exists (select 1 from public.accounts a where a.id = account_users.account_id and a.owner_user_id = auth.uid())
    )
  );

-- Accounts policies (membership aware)
drop policy if exists accounts_select_member_or_admin on public.accounts;
drop policy if exists "accounts_owner_or_admin" on public.accounts;
drop policy if exists "accounts_owner_insert" on public.accounts;
drop policy if exists "accounts_owner_update" on public.accounts;
drop policy if exists "accounts_owner_delete" on public.accounts;

create policy accounts_select_member_or_admin on public.accounts
  for select to authenticated
  using (public.is_admin() or public.is_account_member(id));

create policy accounts_insert_owner_or_admin on public.accounts
  for insert to authenticated
  with check (public.is_admin() or owner_user_id = auth.uid());

create policy accounts_update_owner_or_admin on public.accounts
  for update to authenticated
  using (public.is_admin() or public.is_account_owner(id))
  with check (public.is_admin() or public.is_account_owner(id));

create policy accounts_delete_owner_or_admin on public.accounts
  for delete to authenticated
  using (public.is_admin() or public.is_account_owner(id));

-- Uploads
drop policy if exists "uploads_select_owner_or_admin" on public.uploads;
drop policy if exists "uploads_insert_owner_or_admin" on public.uploads;
drop policy if exists "uploads_update_owner_or_admin" on public.uploads;
drop policy if exists "uploads_delete_owner_or_admin" on public.uploads;

create policy uploads_select_member_or_admin on public.uploads
  for select to authenticated
  using (public.is_admin() or public.is_account_member(account_id));

create policy uploads_insert_member_or_admin on public.uploads
  for insert to authenticated
  with check (
    public.is_admin()
    or status = 'preauth'
    or (account_id is not null and public.is_account_member(account_id))
  );

create policy uploads_update_member_or_admin on public.uploads
  for update to authenticated
  using (
    public.is_admin()
    or status = 'preauth'
    or (account_id is not null and public.is_account_member(account_id))
  )
  with check (
    public.is_admin()
    or status = 'preauth'
    or (account_id is not null and public.is_account_member(account_id))
  );

create policy uploads_delete_member_or_admin on public.uploads
  for delete to authenticated
  using (public.is_admin() or public.is_account_member(account_id));

-- Snapshots
drop policy if exists "snapshots_select_owner_or_admin" on public.snapshots;
drop policy if exists "snapshots_delete_owner_or_admin" on public.snapshots;
create policy snapshots_select_member_or_admin on public.snapshots
  for select to authenticated
  using (public.is_admin() or public.is_account_member(account_id));
create policy snapshots_delete_member_or_admin on public.snapshots
  for delete to authenticated
  using (public.is_admin() or public.is_account_member(account_id));

-- Snapshot totals
drop policy if exists "snapshot_totals_select_owner_or_admin" on public.snapshot_totals;
drop policy if exists "snapshot_totals_delete_owner_or_admin" on public.snapshot_totals;
create policy snapshot_totals_select_member_or_admin on public.snapshot_totals
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.snapshots s where s.id = snapshot_totals.snapshot_id and public.is_account_member(s.account_id))
  );
create policy snapshot_totals_delete_member_or_admin on public.snapshot_totals
  for delete to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.snapshots s where s.id = snapshot_totals.snapshot_id and public.is_account_member(s.account_id))
  );

-- Snapshot series
drop policy if exists "snapshot_series_select_owner_or_admin" on public.snapshot_series;
drop policy if exists "snapshot_series_delete_owner_or_admin" on public.snapshot_series;
create policy snapshot_series_select_member_or_admin on public.snapshot_series
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.snapshots s where s.id = snapshot_series.snapshot_id and public.is_account_member(s.account_id))
  );
create policy snapshot_series_delete_member_or_admin on public.snapshot_series
  for delete to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.snapshots s where s.id = snapshot_series.snapshot_id and public.is_account_member(s.account_id))
  );

-- Storage policies (uploads + csv-uploads)
do $$ begin
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then null;
  end;
end $$;

drop policy if exists "authenticated_uploads_access" on storage.objects;
drop policy if exists "authenticated_csv_uploads_access" on storage.objects;
drop policy if exists "authenticated_csv_uploads_member_or_agency" on storage.objects;
drop policy if exists "authenticated_csv_uploads_member" on storage.objects;
drop policy if exists "authenticated_uploads_member" on storage.objects;

create policy "authenticated_uploads_member" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'uploads'
    and (public.is_admin() or public.is_account_member(public.account_id_from_path(name)))
  )
  with check (
    bucket_id = 'uploads'
    and (public.is_admin() or public.is_account_member(public.account_id_from_path(name)))
  );

create policy "authenticated_csv_uploads_member" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'csv-uploads'
    and (public.is_admin() or public.is_account_member(public.account_id_from_path(name)))
  )
  with check (
    bucket_id = 'csv-uploads'
    and (public.is_admin() or public.is_account_member(public.account_id_from_path(name)))
  );

commit;
