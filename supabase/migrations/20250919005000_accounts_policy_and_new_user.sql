-- Update accounts read policy to include members and agency users
-- Update handle_new_user to skip auto-account for agency signups

begin;

-- Accounts read policy: allow members (via is_account_member)
drop policy if exists accounts_select_read on public.accounts;
drop policy if exists "accounts_owner_or_admin" on public.accounts; -- from baseline, replace with new name
create policy accounts_select_read on public.accounts for select to authenticated
using (public.is_admin() or public.is_account_member(id));

-- New user trigger: skip when signup_type = 'agency'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_business_name text;
  v_name text;
  v_country text;
  v_store_url text;
  v_signup_type text;
begin
  v_signup_type := nullif(trim(new.raw_user_meta_data->>'signup_type'), '');
  if v_signup_type = 'agency' then
    -- Agency signups do not auto-create a brand account
    return new;
  end if;

  v_business_name := nullif(trim(new.raw_user_meta_data->>'businessName'), '');
  v_country := nullif(trim(new.raw_user_meta_data->>'country'), '');
  v_store_url := nullif(trim(new.raw_user_meta_data->>'storeUrl'), '');
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), new.email, 'Account');
  if not exists (select 1 from public.accounts a where a.owner_user_id = new.id) then
    insert into public.accounts (owner_user_id, name, company, country, store_url)
    values (new.id, v_name, v_business_name, v_country, v_store_url);
  end if;
  return new;
end;$$;

commit;

