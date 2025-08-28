-- Add persistent date range to snapshots so shared dashboards reflect the user-selected window
alter table public.snapshots
  add column if not exists range_start date,
  add column if not exists range_end date;

-- Helpful index for queries filtering by date window (optional, lightweight)
create index if not exists snapshots_range_start_end_idx on public.snapshots (range_start, range_end);

-- Backfill: if a snapshot already has metadata with an embedded date range we could parse it here.
-- (No-op for now; existing snapshots will derive range on first share if unset.)
