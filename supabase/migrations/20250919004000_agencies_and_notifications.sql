-- Agencies, agency link requests, notifications outbox, admin list, helpers, and policies
-- Implements parts of docs/multi-tenant-accounts-plan.md not yet present.

begin;

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists citext;

-- Admins table (optional in addition to JWT claim)
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
drop policy if exists app_admins_service_all on public.app_admins;
create policy app_admins_service_all on public.app_admins for all to service_role using (true) with check (true);
drop policy if exists app_admins_admin_read on public.app_admins;
create policy app_admins_admin_read on public.app_admins for select to authenticated using (public.is_admin());

-- Update is_admin() to consult table OR JWT claims (role/app_role)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
    or coalesce(nullif(auth.jwt() ->> 'role', ''), '') = 'admin'
    or coalesce(nullif(auth.jwt() ->> 'app_role', ''), '') = 'admin'
$$;

-- Types
do $$
begin
  if not exists (select 1 from pg_type where typname = 'agency_role') then
    create type public.agency_role as enum ('owner','admin','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'link_status') then
    create type public.link_status as enum ('pending','approved','rejected','expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'notification_topic') then
    create type public.notification_topic as enum (
      'csv_uploaded','agency_link_requested','agency_link_approved','member_invited','member_revoked'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_status') then
    create type public.delivery_status as enum ('pending','processing','sent','error','dead');
  end if;
end $$;

-- Agencies
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  brand_limit int not null default 10,
  seat_limit int not null default 20,
  created_at timestamptz not null default now()
);
alter table public.agencies enable row level security;

create table if not exists public.agency_users (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.agency_role not null,
  all_accounts boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);
alter table public.agency_users enable row level security;

-- Link agency -> brand
create table if not exists public.agency_accounts (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agency_id, account_id),
  unique (account_id)
);
alter table public.agency_accounts enable row level security;

-- Optional per-user scoping when all_accounts=false
create table if not exists public.agency_user_accounts (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id, account_id)
);
alter table public.agency_user_accounts enable row level security;

-- Link requests (brand owner approval required when linking existing brands)
create table if not exists public.link_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  token_hash text not null,
  status public.link_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  acted_by uuid references auth.users(id) on delete set null,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, account_id)
);
create unique index if not exists link_requests_token_hash_unique on public.link_requests(token_hash);
alter table public.link_requests enable row level security;

-- Notifications
create table if not exists public.account_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  topic public.notification_topic not null,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_email is not null)
);
create unique index if not exists ans_unique_recipient_per_topic
  on public.account_notification_subscriptions (
    account_id,
    topic,
    coalesce(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(recipient_email, '')
  );
alter table public.account_notification_subscriptions enable row level security;

create table if not exists public.notifications_outbox (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  deliver_after timestamptz not null default now(),
  topic public.notification_topic not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  recipient_user_id uuid,
  recipient_email text,
  payload jsonb not null default '{}'::jsonb,
  status public.delivery_status not null default 'pending',
  attempts int not null default 0,
  last_error text
);
create index if not exists notifications_outbox_status_idx on public.notifications_outbox (status, deliver_after);
alter table public.notifications_outbox enable row level security;

-- Agency quotas: seats and brands
create or replace function public.agency_seat_count(p_agency uuid)
returns integer language sql stable as $$
  select count(*)::int from public.agency_users au where au.agency_id = p_agency;
$$;

create or replace function public.agency_brand_count(p_agency uuid)
returns integer language sql stable as $$
  select count(*)::int from public.agency_accounts aa where aa.agency_id = p_agency;
$$;

create or replace function public.assert_agency_seat_quota(p_agency uuid)
returns void language plpgsql as $$
declare cnt int; lim int; begin
  select public.agency_seat_count(p_agency), a.seat_limit into cnt, lim from public.agencies a where a.id = p_agency;
  if cnt >= lim then raise exception 'Agency seat limit reached (%) for %', lim, p_agency; end if; end $$;

create or replace function public.assert_agency_brand_quota(p_agency uuid)
returns void language plpgsql as $$
declare cnt int; lim int; begin
  select public.agency_brand_count(p_agency), a.brand_limit into cnt, lim from public.agencies a where a.id = p_agency;
  if cnt >= lim then raise exception 'Agency brand limit reached (%) for %', lim, p_agency; end if; end $$;

create or replace function public.trg_agency_users_enforce_seats()
returns trigger language plpgsql as $$
begin perform public.assert_agency_seat_quota(new.agency_id); return new; end $$;

create or replace function public.trg_agency_accounts_enforce_brands()
returns trigger language plpgsql as $$
begin perform public.assert_agency_brand_quota(new.agency_id); return new; end $$;

drop trigger if exists trg_before_agency_users_insert_quota on public.agency_users;
create trigger trg_before_agency_users_insert_quota before insert on public.agency_users
  for each row execute function public.trg_agency_users_enforce_seats();

drop trigger if exists trg_before_agency_accounts_insert_quota on public.agency_accounts;
create trigger trg_before_agency_accounts_insert_quota before insert on public.agency_accounts
  for each row execute function public.trg_agency_accounts_enforce_brands();

-- Access helpers
create or replace function public.is_agency_user_of_account(p_account uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.agency_accounts aa
    join public.agency_users au on au.agency_id = aa.agency_id and au.user_id = auth.uid()
    where aa.account_id = p_account
      and (
        au.all_accounts = true
        or exists (
          select 1 from public.agency_user_accounts aua
          where aua.agency_id = aa.agency_id and aua.user_id = au.user_id and aua.account_id = p_account
        )
      )
  );
$$;

-- Expand is_account_member() to include agency access
create or replace function public.is_account_member(p_account uuid)
returns boolean language sql stable as $$
  select
    exists (select 1 from public.accounts a where a.id = p_account and a.owner_user_id = auth.uid())
    or exists (select 1 from public.account_users au where au.account_id = p_account and au.user_id = auth.uid())
    or public.is_agency_user_of_account(p_account);
$$;

-- Notifications enqueue: fire from audit_log inserts
create or replace function public.enqueue_notifications_from_audit()
returns trigger language plpgsql as $$
begin
  if new.account_id is null then return new; end if;
  if new.action in ('csv_uploaded','agency_link_requested','agency_link_approved','member_invited','member_revoked') then
    insert into public.notifications_outbox (topic, account_id, recipient_user_id, recipient_email, payload)
    select new.action::public.notification_topic, new.account_id, s.recipient_user_id, s.recipient_email,
           jsonb_build_object('action', new.action, 'details', new.details, 'target_table', new.target_table, 'target_id', new.target_id)
    from public.account_notification_subscriptions s
    where s.account_id = new.account_id and s.enabled = true and s.topic = (new.action)::public.notification_topic;
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_log_enqueue on public.audit_log;
create trigger trg_audit_log_enqueue after insert on public.audit_log
  for each row execute function public.enqueue_notifications_from_audit();

-- RLS policies

-- agencies: owner or admin
drop policy if exists agencies_owner_or_admin on public.agencies;
create policy agencies_owner_or_admin on public.agencies for all to authenticated
using (public.is_admin() or owner_user_id = auth.uid())
with check (public.is_admin() or owner_user_id = auth.uid());

-- agency_users: managed by agency owner/admin
drop policy if exists agency_users_manage on public.agency_users;
create policy agency_users_manage on public.agency_users for all to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_users.agency_id and ag.owner_user_id = auth.uid()
  )
)
with check (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_users.agency_id and ag.owner_user_id = auth.uid()
  )
);

-- agency_accounts: managed by agency owner/admin
drop policy if exists agency_accounts_manage on public.agency_accounts;
create policy agency_accounts_manage on public.agency_accounts for all to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_accounts.agency_id and ag.owner_user_id = auth.uid()
  )
)
with check (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_accounts.agency_id and ag.owner_user_id = auth.uid()
  )
);

-- agency_user_accounts: managed by agency owner/admin
drop policy if exists agency_user_accounts_manage on public.agency_user_accounts;
create policy agency_user_accounts_manage on public.agency_user_accounts for all to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_user_accounts.agency_id and ag.owner_user_id = auth.uid()
  )
)
with check (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_user_accounts.agency_id and ag.owner_user_id = auth.uid()
  )
);

-- link_requests: visible to agency users and brand owners; insert by agency owner
drop policy if exists link_requests_select on public.link_requests;
create policy link_requests_select on public.link_requests for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.agencies ag join public.agency_users au on au.agency_id = ag.id and au.user_id = auth.uid()
    where ag.id = link_requests.agency_id
  )
  or exists (
    select 1 from public.accounts a where a.id = link_requests.account_id and a.owner_user_id = auth.uid()
  )
);

drop policy if exists link_requests_insert on public.link_requests;
create policy link_requests_insert on public.link_requests for insert to authenticated
with check (
  public.is_admin() or exists (
    select 1 from public.agencies ag where ag.id = agency_id and ag.owner_user_id = auth.uid()
  )
);

drop policy if exists link_requests_update on public.link_requests;
create policy link_requests_update on public.link_requests for update to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.agencies ag where ag.id = link_requests.agency_id and ag.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.accounts a where a.id = link_requests.account_id and a.owner_user_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.agencies ag where ag.id = link_requests.agency_id and ag.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.accounts a where a.id = link_requests.account_id and a.owner_user_id = auth.uid()
  )
);

-- account_notification_subscriptions: brand members manage
drop policy if exists ans_member_manage on public.account_notification_subscriptions;
create policy ans_member_manage on public.account_notification_subscriptions for all to authenticated
using (public.is_admin() or public.is_account_member(account_id))
with check (public.is_admin() or public.is_account_member(account_id));

-- notifications_outbox: service only
drop policy if exists notifications_outbox_service_all on public.notifications_outbox;
create policy notifications_outbox_service_all on public.notifications_outbox for all to service_role using (true) with check (true);
drop policy if exists notifications_outbox_admin_read on public.notifications_outbox;
create policy notifications_outbox_admin_read on public.notifications_outbox for select to authenticated using (public.is_admin());

commit;
