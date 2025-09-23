-- Ensure owner membership trigger bypasses RLS and uses explicit search_path.
begin;

create or replace function public.ensure_account_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  if new.owner_user_id is null then
    delete from public.account_users
    where account_id = new.id and role = 'owner';
  else
    insert into public.account_users (account_id, user_id, role)
    values (new.id, new.owner_user_id, 'owner')
    on conflict (account_id, user_id) do update set role = excluded.role;
  end if;
  return new;
end;
$$;

commit;
