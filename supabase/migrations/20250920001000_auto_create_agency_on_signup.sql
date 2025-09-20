-- Auto-create Agency on new user signup when signup_type='agency'
begin;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_business_name text;
  v_name text;
  v_country text;
  v_store_url text;
  v_signup_type text;
  v_agency_name text;
  v_agency_id uuid;
begin
  v_business_name := nullif(trim(new.raw_user_meta_data->>'businessName'), '');
  v_country := nullif(trim(new.raw_user_meta_data->>'country'), '');
  v_store_url := nullif(trim(new.raw_user_meta_data->>'storeUrl'), '');
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), new.email, 'Account');
  v_signup_type := lower(nullif(trim(new.raw_user_meta_data->>'signup_type'), ''));
  v_agency_name := nullif(trim(new.raw_user_meta_data->>'agencyName'), '');

  -- Create a default brand account for every new user if they don't have one yet
  if not exists (select 1 from public.accounts a where a.owner_user_id = new.id) then
    insert into public.accounts (owner_user_id, name, company, country, store_url)
    values (new.id, v_name, v_business_name, v_country, v_store_url);
  end if;

  -- If this signup is for an Agency, create the agency + owner seat once
  if v_signup_type = 'agency' then
    if not exists (select 1 from public.agencies ag where ag.owner_user_id = new.id) then
      insert into public.agencies (name, owner_user_id)
      values (coalesce(v_agency_name, v_name, new.email), new.id)
      returning id into v_agency_id;
      -- owner seat
      insert into public.agency_users (agency_id, user_id, role, all_accounts)
      values (v_agency_id, new.id, 'owner', true);
    end if;
  end if;

  return new;
end;$$;

commit;

