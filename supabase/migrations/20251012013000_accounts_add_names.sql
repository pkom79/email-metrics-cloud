-- Add first_name / last_name to accounts and update new-user creation to capture names

begin;

alter table public.accounts
  add column if not exists first_name text,
  add column if not exists last_name text;

-- Update handle_new_user to use first/last name from metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_business_name text;
  v_name text;
  v_country text;
  v_store_url text;
  v_signup_type text;
  v_first text;
  v_last text;
begin
  v_signup_type := nullif(trim(new.raw_user_meta_data->>'signup_type'), '');
  v_business_name := nullif(trim(new.raw_user_meta_data->>'businessName'), '');
  v_country := nullif(trim(new.raw_user_meta_data->>'country'), '');
  v_store_url := nullif(trim(new.raw_user_meta_data->>'storeUrl'), '');
  v_first := nullif(trim(new.raw_user_meta_data->>'firstName'), '');
  v_last := nullif(trim(new.raw_user_meta_data->>'lastName'), '');
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), new.email, 'Account');
  if v_first is not null or v_last is not null then
    v_name := trim(coalesce(v_first, '') || ' ' || coalesce(v_last, ''));
  end if;

  if v_signup_type = 'agency' then
    return new;
  end if;

  if not exists (select 1 from public.accounts a where a.owner_user_id = new.id) then
    insert into public.accounts (owner_user_id, name, company, country, store_url, first_name, last_name)
    values (new.id, v_name, v_business_name, v_country, v_store_url, v_first, v_last);
  end if;
  return new;
end;$$;

commit;
