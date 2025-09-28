-- Stripe billing fields for account-level subscription enforcement

begin;

alter table public.accounts
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_status text not null default 'inactive',
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_trial_ends_at timestamptz,
  add column if not exists stripe_subscription_id text;

create index if not exists accounts_stripe_customer_idx on public.accounts (stripe_customer_id);
create index if not exists accounts_stripe_subscription_idx on public.accounts (stripe_subscription_id);

commit;
