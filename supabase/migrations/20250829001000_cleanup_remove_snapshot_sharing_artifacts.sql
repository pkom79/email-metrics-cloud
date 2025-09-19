-- Cleanup migration after purging abandoned snapshot sharing feature
-- Date: 2025-08-29
-- Purpose:
--  1. Defensively drop any leftover snapshot_shares table or policies if an environment
--     applied a subset of removed migrations.
--  2. Drop columns on snapshots that were only used for shared dashboard date ranges
--     (range_start, range_end) if they still exist.
--  3. Remove any public storage policy that might have been created for sharing.
-- Safe to run repeatedly (idempotent) and safe if objects already absent.

begin;

-- 1. Drop snapshot_shares table & related artifacts if somehow still present
do $$
declare
  r record;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='snapshot_shares'
  ) then
    -- Drop policies first
    for r in (
      select policyname as polname from pg_policies where schemaname='public' and tablename='snapshot_shares'
    ) loop
      execute format('drop policy if exists %I on public.snapshot_shares', r.polname);
    end loop;
    -- Drop indexes (if they exist)
    execute 'drop index if exists public.snapshot_shares_token_idx';
    execute 'drop index if exists public.snapshot_shares_snapshot_id_idx';
    execute 'drop index if exists public.snapshot_shares_created_by_idx';
    -- Drop constraints (defensive)
    begin
      execute 'alter table public.snapshot_shares drop constraint if exists snapshot_shares_share_token_key';
    exception when undefined_table then null; end;
    -- Finally drop the table
    execute 'drop table if exists public.snapshot_shares cascade';
  end if;
end$$;

-- 2. Drop range_start / range_end columns if they exist and are now unused
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='snapshots' and column_name='range_start'
  ) then
    execute 'alter table public.snapshots drop column if exists range_start';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='snapshots' and column_name='range_end'
  ) then
    execute 'alter table public.snapshots drop column if exists range_end';
  end if;
  -- Drop related index if present
  execute 'drop index if exists public.snapshots_range_start_end_idx';
end$$;

-- 3. Remove any legacy public read policy on storage.objects for csv-uploads (name may vary)
-- We look for policies containing 'public' and 'csv-uploads' and drop them.
do $$
declare
  p record;
begin
  for p in (
    select policyname as polname from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname ilike '%public%csv%uploads%'
  ) loop
    execute format('drop policy if exists %I on storage.objects', p.polname);
  end loop;
end$$;

commit;

comment on schema public is 'Snapshot sharing feature fully purged as of 2025-08-29';
