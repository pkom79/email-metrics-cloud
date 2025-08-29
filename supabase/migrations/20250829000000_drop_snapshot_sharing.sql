-- Migration: drop snapshot sharing feature (snapshot_shares table and related objects)
-- Date: 2025-08-29
-- This is irreversible; ensure no production dependencies remain before applying.

begin;

-- Drop policies if they exist
do $$
declare r record;
begin
  for r in (
    select polname from pg_policies where schemaname='public' and tablename='snapshot_shares'
  ) loop
    execute format('drop policy if exists %I on public.snapshot_shares', r.polname);
  end loop;
end$$;

-- Drop indexes (IF EXISTS guards)
drop index if exists public.snapshot_shares_token_idx;
drop index if exists public.snapshot_shares_snapshot_id_idx;
drop index if exists public.snapshot_shares_created_by_idx;

-- Drop constraint(s)
alter table if exists public.snapshot_shares drop constraint if exists snapshot_shares_share_token_key;

-- Finally drop table
drop table if exists public.snapshot_shares cascade;

comment on schema public is 'snapshot_shares removed in migration 20250829000000';

commit;
