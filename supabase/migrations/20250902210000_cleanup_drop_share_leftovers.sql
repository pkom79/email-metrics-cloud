-- Defensive cleanup of any lingering share-related database artifacts
-- Date: 2025-09-02
-- Purpose: ensure all functions / tables / policies from abandoned sharing feature are removed.
-- Safe to run multiple times (idempotent).

begin;

-- 1. Drop residual tables if present
do $$
declare
  t text;
begin
  for t in select table_name from information_schema.tables where table_schema='public' and table_name in (
    'snapshot_shares','share_bundles','account_share_links'
  ) loop
    execute format('drop table if exists public.%I cascade', t);
  end loop;
end$$;

-- 2. Drop residual policies containing share/token keywords (defensive)
do $$
declare
  p record;
begin
  for p in (
    select schemaname, tablename, polname
    from pg_policies
    where schemaname='public' and (
      polname ilike '%share%' or polname ilike '%token%'
    )
  ) loop
    execute format('drop policy if exists %I on %I.%I', p.polname, p.schemaname, p.tablename);
  end loop;
end$$;

-- 3. Drop residual functions (any signature) by proname
do $$
declare
  f record;
  drop_stmt text;
begin
  for f in (
    select n.nspname as schema_name, p.proname, oidvectortypes(p.proargtypes) as argtypes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in (
      'generate_share_token','set_share_token','validate_share_access',
      'acquire_share_bundle_lock','build_share_bundle','persist_share_bundle'
    )
  ) loop
    drop_stmt := format('drop function if exists %I.%I(%s) cascade', f.schema_name, f.proname, f.argtypes);
    execute drop_stmt;
  end loop;
end$$;

-- 4. Drop triggers referencing removed functions (heuristic search by name pattern)
do $$
declare
  trg record;
begin
  for trg in (
    select event_object_schema as schema_name, event_object_table as table_name, trigger_name
    from information_schema.triggers
    where (trigger_name ilike '%share%' or trigger_name ilike '%token%')
      and event_object_schema='public'
  ) loop
    execute format('drop trigger if exists %I on %I.%I', trg.trigger_name, trg.schema_name, trg.table_name);
  end loop;
end$$;

-- 5. Drop any comment referencing sharing (optional diagnostic)
comment on schema public is 'Sharing artifacts fully purged as of 2025-09-02';

commit;
