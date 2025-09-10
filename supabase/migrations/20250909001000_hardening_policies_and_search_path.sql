-- Address lints:
-- 0011_function_search_path_mutable: set stable search_path on functions
-- 0014_extension_in_public: move pgjwt to extensions schema
-- 0012_auth_allow_anonymous_sign_ins: restrict policies to authenticated/service_role

begin;

-- Ensure extensions schema exists
create schema if not exists extensions;

-- Move pgjwt to extensions schema only if the extension is relocatable; otherwise skip
do $$
declare
  v_relocatable boolean;
begin
  select e.extrelocatable into v_relocatable
  from pg_extension e
  where e.extname = 'pgjwt';

  if coalesce(v_relocatable, false) then
    execute 'alter extension pgjwt set schema extensions';
  else
    -- Not relocatable on this stack; leave as-is
    perform 1;
  end if;
end $$;

-- Set function-level search_path to avoid role-mutable behavior
-- is_admin()
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin' and p.pronargs = 0
  ) then
    execute 'alter function public.is_admin() set search_path = public';
  end if;
end $$;

-- current_account_id()
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_account_id' and p.pronargs = 0
  ) then
    execute 'alter function public.current_account_id() set search_path = public';
  end if;
end $$;

-- purge_account_children(uuid)
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purge_account_children' and p.pronargs = 1
  ) then
    execute 'alter function public.purge_account_children(uuid) set search_path = public';
  end if;
end $$;

-- resolve_latest_snapshot_for_token(...) – alter all overloads to set search_path
do $$
declare
  r record;
begin
  for r in
    select (p.oid::regprocedure)::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_latest_snapshot_for_token'
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;

-- Restrict RLS policies to authenticated (and service_role where applicable)
-- accounts
drop policy if exists "accounts_owner_or_admin" on public.accounts;
create policy "accounts_owner_or_admin" on public.accounts for select to authenticated using (public.is_admin() or owner_user_id = auth.uid());
drop policy if exists "accounts_owner_insert" on public.accounts;
create policy "accounts_owner_insert" on public.accounts for insert to authenticated with check (owner_user_id = auth.uid());
drop policy if exists "accounts_owner_update" on public.accounts;
create policy "accounts_owner_update" on public.accounts for update to authenticated using (public.is_admin() or owner_user_id = auth.uid()) with check (public.is_admin() or owner_user_id = auth.uid());
drop policy if exists "accounts_owner_delete" on public.accounts;
create policy "accounts_owner_delete" on public.accounts for delete to authenticated using (public.is_admin() or owner_user_id = auth.uid());

-- uploads
drop policy if exists "uploads_select_owner_or_admin" on public.uploads;
create policy "uploads_select_owner_or_admin" on public.uploads for select to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()));
drop policy if exists "uploads_insert_owner_or_admin" on public.uploads;
create policy "uploads_insert_owner_or_admin" on public.uploads for insert to authenticated with check (public.is_admin() OR (account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid())) OR status = 'preauth');
drop policy if exists "uploads_update_owner_or_admin" on public.uploads;
create policy "uploads_update_owner_or_admin" on public.uploads for update to authenticated using (public.is_admin() OR (account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid())) OR status = 'preauth') with check (public.is_admin() OR (account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid())) OR status = 'preauth');
drop policy if exists "uploads_delete_owner_or_admin" on public.uploads;
create policy "uploads_delete_owner_or_admin" on public.uploads for delete to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()));

-- upload_files
drop policy if exists "upload_files_select_owner_or_admin" on public.upload_files;
create policy "upload_files_select_owner_or_admin" on public.upload_files for select to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()));
drop policy if exists "upload_files_insert_owner_or_admin" on public.upload_files;
create policy "upload_files_insert_owner_or_admin" on public.upload_files for insert to authenticated with check (public.is_admin() OR EXISTS (SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()));
drop policy if exists "upload_files_delete_owner_or_admin" on public.upload_files;
create policy "upload_files_delete_owner_or_admin" on public.upload_files for delete to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()));

-- snapshots
drop policy if exists "snapshots_select_owner_or_admin" on public.snapshots;
create policy "snapshots_select_owner_or_admin" on public.snapshots for select to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = snapshots.account_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshots_delete_owner_or_admin" on public.snapshots;
create policy "snapshots_delete_owner_or_admin" on public.snapshots for delete to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = snapshots.account_id AND a.owner_user_id = auth.uid()));

-- snapshot_totals
drop policy if exists "snapshot_totals_select_owner_or_admin" on public.snapshot_totals;
create policy "snapshot_totals_select_owner_or_admin" on public.snapshot_totals for select to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_totals.snapshot_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshot_totals_delete_owner_or_admin" on public.snapshot_totals;
create policy "snapshot_totals_delete_owner_or_admin" on public.snapshot_totals for delete to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_totals.snapshot_id AND a.owner_user_id = auth.uid()));

-- snapshot_series
drop policy if exists "snapshot_series_select_owner_or_admin" on public.snapshot_series;
create policy "snapshot_series_select_owner_or_admin" on public.snapshot_series for select to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_series.snapshot_id AND a.owner_user_id = auth.uid()));
drop policy if exists "snapshot_series_delete_owner_or_admin" on public.snapshot_series;
create policy "snapshot_series_delete_owner_or_admin" on public.snapshot_series for delete to authenticated using (public.is_admin() OR EXISTS (SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id WHERE s.id = snapshot_series.snapshot_id AND a.owner_user_id = auth.uid()));

commit;
