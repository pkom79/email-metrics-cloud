-- Auto-create account row on new auth user + backfill business metadata
-- Idempotent migration: safe to re-run.

-- Function to insert an accounts row when a new auth.users row is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_name text;
  v_name text;
  v_country text;
  v_store_url text;
begin
  -- Pull metadata fields (may be null)
  v_business_name := nullif(trim(new.raw_user_meta_data->>'businessName'), '');
  v_country := nullif(trim(new.raw_user_meta_data->>'country'), '');
  v_store_url := nullif(trim(new.raw_user_meta_data->>'storeUrl'), '');
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), new.email, 'Account');

  -- Insert only if no existing row (defensive / replay-safe)
  if not exists (select 1 from public.accounts a where a.owner_user_id = new.id) then
    insert into public.accounts (owner_user_id, name, company, country, store_url)
    values (new.id, v_name, v_business_name, v_country, v_store_url);
  end if;
  return new;
end;
$$;

-- Drop & recreate trigger (ensures latest function definition is used)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill existing accounts with business metadata from auth.users where missing.
update public.accounts a
set company = coalesce(nullif(trim(u.raw_user_meta_data->>'businessName'), ''), a.company),
    country = coalesce(nullif(trim(u.raw_user_meta_data->>'country'), ''), a.country),
    store_url = coalesce(nullif(trim(u.raw_user_meta_data->>'storeUrl'), ''), a.store_url)
from auth.users u
where a.owner_user_id = u.id
  and (
    a.company is null or trim(a.company) = '' or
    a.country is null or trim(a.country) = '' or
    a.store_url is null or trim(a.store_url) = ''
  );

-- Verification (optional - comment out if migrations runner disallows selects):
-- select id, company, country, store_url from public.accounts order by created_at desc limit 10;
