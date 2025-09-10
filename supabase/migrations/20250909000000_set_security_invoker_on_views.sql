-- Fix linter 0010_security_definer_view by ensuring views run with invoker privileges
-- This preserves RLS enforcement of the underlying tables for the querying user.
-- The DO blocks are conditional so the migration is safe if a view is absent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'snapshot_totals_pivot'
  ) THEN
    EXECUTE 'ALTER VIEW public.snapshot_totals_pivot SET (security_invoker = true)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'snapshot_series_view'
  ) THEN
    EXECUTE 'ALTER VIEW public.snapshot_series_view SET (security_invoker = true)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'snapshot_totals_view'
  ) THEN
    EXECUTE 'ALTER VIEW public.snapshot_totals_view SET (security_invoker = true)';
  END IF;
END $$;

-- Optional: verify current settings
-- SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname IN ('snapshot_totals_pivot','snapshot_series_view','snapshot_totals_view');
