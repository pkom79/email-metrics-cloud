-- Admin diagnostics table and RPCs per plan; service-role write, admin read

begin;

create table if not exists public.admin_diagnostics (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  level text not null check (level in ('debug','info','warn','error')),
  source text not null check (source in ('api','worker','db','storage','external')),
  account_id uuid references public.accounts(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  code text,
  message text not null,
  http_status int,
  provider text,
  provider_message_id text,
  correlation_id uuid,
  request_id text,
  context jsonb not null default '{}'::jsonb,
  error_stack text
);
create index if not exists admin_diag_account_id_idx on public.admin_diagnostics (account_id, occurred_at desc);
create index if not exists admin_diag_corr_idx on public.admin_diagnostics (correlation_id);
create index if not exists admin_diag_level_idx on public.admin_diagnostics (level);

alter table public.admin_diagnostics enable row level security;
drop policy if exists admin_diag_service_all on public.admin_diagnostics;
create policy admin_diag_service_all on public.admin_diagnostics
  for all to service_role using (true) with check (true);
drop policy if exists admin_diag_admin_read on public.admin_diagnostics;
create policy admin_diag_admin_read on public.admin_diagnostics
  for select to authenticated using (public.is_admin());

-- Helper to log from SECURITY DEFINER RPCs, attaches auth.uid() automatically
create or replace function public.log_diag_event(
  p_level text,
  p_source text,
  p_account_id uuid,
  p_code text,
  p_message text,
  p_context jsonb default '{}'::jsonb,
  p_http_status int default null,
  p_provider text default null,
  p_provider_message_id text default null,
  p_correlation_id uuid default null,
  p_request_id text default null,
  p_error_stack text default null
) returns bigint
language sql security definer set search_path = public as $$
  insert into public.admin_diagnostics (
    level, source, account_id, actor_user_id, code, message, http_status, provider,
    provider_message_id, correlation_id, request_id, context, error_stack
  ) values (
    p_level, p_source, p_account_id, auth.uid(), p_code, p_message, p_http_status, p_provider,
    p_provider_message_id, p_correlation_id, p_request_id, coalesce(p_context, '{}'::jsonb), p_error_stack
  ) returning id;
$$;

-- Purge helpers
create or replace function public.purge_admin_diagnostics(retention_days int)
returns integer language plpgsql security definer set search_path = public as $$
declare cnt int; begin
  with d as (
    delete from public.admin_diagnostics
    where occurred_at < now() - make_interval(days => retention_days)
    returning 1
  ) select count(*) into cnt from d; return cnt; end $$;

create or replace function public.purge_notifications_outbox(retention_days int)
returns integer language plpgsql security definer set search_path = public as $$
declare cnt int; begin
  with d as (
    delete from public.notifications_outbox
    where status in ('sent','dead') and created_at < now() - make_interval(days => retention_days)
    returning 1
  ) select count(*) into cnt from d; return cnt; end $$;

commit;

