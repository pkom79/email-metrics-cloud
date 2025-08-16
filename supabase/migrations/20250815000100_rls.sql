-- RLS policies for Account Module

alter table public.accounts enable row level security;
alter table public.uploads enable row level security;
alter table public.upload_files enable row level security;
alter table public.snapshots enable row level security;
alter table public.snapshot_totals enable row level security;
alter table public.snapshot_series enable row level security;

-- Accounts: owner or admin only
drop policy if exists "accounts_owner_or_admin" on public.accounts;
create policy "accounts_owner_or_admin" on public.accounts
for select using (
  public.is_admin() or owner_user_id = auth.uid()
);

drop policy if exists "accounts_owner_insert" on public.accounts;
create policy "accounts_owner_insert" on public.accounts
for insert with check (owner_user_id = auth.uid());

-- Uploads: scoped by account_id; allow preauth read/write via service endpoints only
drop policy if exists "uploads_account_scope" on public.uploads;
create policy "uploads_account_scope" on public.uploads
for select using (
  public.is_admin() or account_id = public.current_account_id()
);

drop policy if exists "uploads_account_write" on public.uploads;
create policy "uploads_account_write" on public.uploads
for insert with check (
  public.is_admin() or account_id = public.current_account_id()
);

drop policy if exists "uploads_account_update" on public.uploads;
create policy "uploads_account_update" on public.uploads
for update using (
  public.is_admin() or account_id = public.current_account_id()
) with check (
  public.is_admin() or account_id = public.current_account_id()
);

-- Upload files: scoped via parent upload
drop policy if exists "upload_files_scope" on public.upload_files;
create policy "upload_files_scope" on public.upload_files
for select using (
  public.is_admin() or exists (
    select 1 from public.uploads u
    where u.id = upload_id and u.account_id = public.current_account_id()
  )
);

drop policy if exists "upload_files_write" on public.upload_files;
create policy "upload_files_write" on public.upload_files
for insert with check (
  public.is_admin() or exists (
    select 1 from public.uploads u
    where u.id = upload_id and u.account_id = public.current_account_id()
  )
);

-- Snapshots and derived tables
drop policy if exists "snapshots_scope" on public.snapshots;
create policy "snapshots_scope" on public.snapshots
for select using (
  public.is_admin() or account_id = public.current_account_id()
);

drop policy if exists "snapshot_totals_scope" on public.snapshot_totals;
create policy "snapshot_totals_scope" on public.snapshot_totals
for select using (
  public.is_admin() or exists (
    select 1 from public.snapshots s
    where s.id = snapshot_id and s.account_id = public.current_account_id()
  )
);

drop policy if exists "snapshot_series_scope" on public.snapshot_series;
create policy "snapshot_series_scope" on public.snapshot_series
for select using (
  public.is_admin() or exists (
    select 1 from public.snapshots s
    where s.id = snapshot_id and s.account_id = public.current_account_id()
  )
);
