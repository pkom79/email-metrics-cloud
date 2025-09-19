-- Harden storage policies to satisfy advisor 0012 (no anon) and avoid broad service role patterns
begin;

-- Enable RLS if possible; ignore insufficient privilege
do $$ begin
  begin
    execute 'alter table if exists storage.objects enable row level security';
  exception when insufficient_privilege then null; end;
end $$;

-- Remove any legacy broad policy names if present
drop policy if exists "service_role_all" on storage.objects;
drop policy if exists "Anyone can read from preauth" on storage.objects;

-- Ensure explicit, scoped service_role policies per bucket (avoids linter false positives)
do $$
begin
  -- Preauth bucket service role full access
  if exists (select 1 from storage.buckets where id = 'preauth-uploads') then
    execute $p$create policy "service_role_preauth_uploads_access" on storage.objects
      for all to service_role
      using (bucket_id = 'preauth-uploads')
      with check (bucket_id = 'preauth-uploads')$p$;
  end if;
exception when duplicate_object then null; end $$;

-- Keep existing csv-uploads/uploads policies in baseline; no changes here.

commit;
