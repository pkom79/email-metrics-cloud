-- Ensure share_token uniqueness and clean up any historical collisions causing
-- 'Cannot coerce the result to a single JSON object' errors when selecting with .single()
begin;

-- Remove duplicate rows keeping the lowest (lexicographically) id per share_token
delete from public.snapshot_shares t
using public.snapshot_shares s
where t.share_token = s.share_token
  and t.id > s.id; -- keeps the smallest id for each token

-- Add unique constraint (if not already present)
do $$
begin
    if not exists (
        select 1 from pg_constraint 
        where conname = 'snapshot_shares_share_token_key'
    ) then
        alter table public.snapshot_shares
            add constraint snapshot_shares_share_token_key unique (share_token);
    end if;
end $$;

commit;

comment on constraint snapshot_shares_share_token_key on public.snapshot_shares is 'Enforces global uniqueness of share tokens for deterministic lookups';
