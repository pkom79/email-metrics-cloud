-- Drop duplicate redundant indexes created during baseline consolidation
-- Date: 2025-09-02
-- Purpose: Remove *_idx2 duplicates which mirror existing indexes and add write overhead.
-- Safe: Uses IF EXISTS; idempotent.
-- Note: Not using CONCURRENTLY since this is a quick metadata change and can be done in brief maintenance window.
--       If you need to avoid locking on a very large table, run the individual DROP INDEX CONCURRENTLY
--       statements manually outside this migration and remove them here.

begin;

DROP INDEX IF EXISTS public.uploads_status_idx2;
DROP INDEX IF EXISTS public.uploads_account_id_idx2;
DROP INDEX IF EXISTS public.snapshots_account_id_idx2;

commit;
