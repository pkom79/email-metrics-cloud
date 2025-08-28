-- Store static reduced snapshot JSON on each share for immutable sharing
alter table public.snapshot_shares
  add column if not exists snapshot_json jsonb;
