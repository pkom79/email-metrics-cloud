-- Drop per-account integrations table (no longer used)
begin;
drop table if exists public.account_integrations cascade;
commit;

