-- Drop unused upload_files table (no longer used by CSV ingestion)
begin;
drop table if exists public.upload_files cascade;
commit;

