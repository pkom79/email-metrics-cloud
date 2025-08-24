-- Soft delete + store_url support + RLS for update/delete on accounts
-- Adds deleted_at & store_url columns (idempotent) and policies to allow owners/admin to update or delete.

alter table public.accounts add column if not exists store_url text;
alter table public.accounts add column if not exists deleted_at timestamptz;

create index if not exists accounts_deleted_at_idx on public.accounts (deleted_at);

-- Allow owners & admins to update (e.g., to set deleted_at)
drop policy if exists "accounts_owner_update" on public.accounts;
create policy "accounts_owner_update" on public.accounts
for update using (
  public.is_admin() or owner_user_id = auth.uid()
) with check (
  public.is_admin() or owner_user_id = auth.uid()
);

-- Allow owners & admins to delete (hard delete)
drop policy if exists "accounts_owner_delete" on public.accounts;
create policy "accounts_owner_delete" on public.accounts
for delete using (
  public.is_admin() or owner_user_id = auth.uid()
);

-- Helper function: fully purge account data (snapshots & uploads) but keep tombstone row
create or replace function public.purge_account_children(p_account_id uuid)
returns void language plpgsql security definer as $$
begin
  -- Delete snapshots (cascade will clear totals & series)
  delete from public.snapshots where account_id = p_account_id;
  -- Delete uploads (cascade will clear upload_files)
  delete from public.uploads where account_id = p_account_id;
end;
$$;

-- Delete policies to allow admin (and owners) to purge related data during soft delete
drop policy if exists "uploads_account_delete" on public.uploads;
create policy "uploads_account_delete" on public.uploads
for delete using (
  public.is_admin() or account_id = public.current_account_id()
);

drop policy if exists "upload_files_delete" on public.upload_files;
create policy "upload_files_delete" on public.upload_files
for delete using (
  public.is_admin() or exists (
    select 1 from public.uploads u where u.id = upload_id and u.account_id = public.current_account_id()
  )
);

drop policy if exists "snapshots_delete" on public.snapshots;
create policy "snapshots_delete" on public.snapshots
for delete using (
  public.is_admin() or account_id = public.current_account_id()
);

drop policy if exists "snapshot_totals_delete" on public.snapshot_totals;
create policy "snapshot_totals_delete" on public.snapshot_totals
for delete using (
  public.is_admin() or exists (
    select 1 from public.snapshots s where s.id = snapshot_id and s.account_id = public.current_account_id()
  )
);

drop policy if exists "snapshot_series_delete" on public.snapshot_series;
create policy "snapshot_series_delete" on public.snapshot_series
for delete using (
  public.is_admin() or exists (
    select 1 from public.snapshots s where s.id = snapshot_id and s.account_id = public.current_account_id()
  )
);
