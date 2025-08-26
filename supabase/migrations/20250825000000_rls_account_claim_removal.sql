-- Remove dependency on current_account_id() JWT claim for row access
-- Policies now rely directly on accounts.owner_user_id = auth.uid()
-- Safe to re-run (drops & recreates policies idempotently)

-- Uploads
drop policy if exists "uploads_account_scope" on public.uploads;
drop policy if exists "uploads_account_write" on public.uploads;
drop policy if exists "uploads_account_update" on public.uploads;
drop policy if exists "uploads_account_delete" on public.uploads;

create policy "uploads_select_owner_or_admin" on public.uploads
for select using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()
  )
);

create policy "uploads_insert_owner_or_admin" on public.uploads
for insert with check (
  public.is_admin() OR (
    account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()
    )
  ) OR status = 'preauth' -- allow preauth placeholder rows (no account yet)
);

create policy "uploads_update_owner_or_admin" on public.uploads
for update using (
  public.is_admin() OR (
    account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()
    )
  ) OR status = 'preauth'
) with check (
  public.is_admin() OR (
    account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()
    )
  ) OR status = 'preauth'
);

create policy "uploads_delete_owner_or_admin" on public.uploads
for delete using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = uploads.account_id AND a.owner_user_id = auth.uid()
  )
);

-- Upload files
DROP POLICY IF EXISTS "upload_files_scope" ON public.upload_files;
DROP POLICY IF EXISTS "upload_files_write" ON public.upload_files;
DROP POLICY IF EXISTS "upload_files_delete" ON public.upload_files;

create policy "upload_files_select_owner_or_admin" on public.upload_files
for select using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id
    WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()
  )
);

create policy "upload_files_insert_owner_or_admin" on public.upload_files
for insert with check (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id
    WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()
  )
);

create policy "upload_files_delete_owner_or_admin" on public.upload_files
for delete using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.uploads u JOIN public.accounts a ON a.id = u.account_id
    WHERE u.id = upload_files.upload_id AND a.owner_user_id = auth.uid()
  )
);

-- Snapshots
DROP POLICY IF EXISTS "snapshots_scope" ON public.snapshots;
DROP POLICY IF EXISTS "snapshots_delete" ON public.snapshots;

create policy "snapshots_select_owner_or_admin" on public.snapshots
for select using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = snapshots.account_id AND a.owner_user_id = auth.uid()
  )
);

create policy "snapshots_delete_owner_or_admin" on public.snapshots
for delete using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = snapshots.account_id AND a.owner_user_id = auth.uid()
  )
);

-- Snapshot totals
DROP POLICY IF EXISTS "snapshot_totals_scope" ON public.snapshot_totals;
DROP POLICY IF EXISTS "snapshot_totals_delete" ON public.snapshot_totals;

create policy "snapshot_totals_select_owner_or_admin" on public.snapshot_totals
for select using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id
    WHERE s.id = snapshot_totals.snapshot_id AND a.owner_user_id = auth.uid()
  )
);

create policy "snapshot_totals_delete_owner_or_admin" on public.snapshot_totals
for delete using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id
    WHERE s.id = snapshot_totals.snapshot_id AND a.owner_user_id = auth.uid()
  )
);

-- Snapshot series
DROP POLICY IF EXISTS "snapshot_series_scope" ON public.snapshot_series;
DROP POLICY IF EXISTS "snapshot_series_delete" ON public.snapshot_series;

create policy "snapshot_series_select_owner_or_admin" on public.snapshot_series
for select using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id
    WHERE s.id = snapshot_series.snapshot_id AND a.owner_user_id = auth.uid()
  )
);

create policy "snapshot_series_delete_owner_or_admin" on public.snapshot_series
for delete using (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.snapshots s JOIN public.accounts a ON a.id = s.account_id
    WHERE s.id = snapshot_series.snapshot_id AND a.owner_user_id = auth.uid()
  )
);

-- Index recommendations (no-ops if exist)
create index if not exists uploads_status_idx2 on public.uploads (status);
create index if not exists uploads_account_id_idx2 on public.uploads (account_id);
create index if not exists snapshots_account_id_idx2 on public.snapshots (account_id);
