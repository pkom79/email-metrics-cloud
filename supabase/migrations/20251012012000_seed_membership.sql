-- Seed membership for multi-account access (idempotent)
insert into public.account_users (account_id, user_id, role)
values ('5682f2e8-8b66-46de-a81c-27760938936c', 'd2714d42-148f-4a49-84f5-eb3b0c2f199c', 'manager')
on conflict (account_id, user_id) do update set role = excluded.role;
