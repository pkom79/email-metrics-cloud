begin;

alter table public.accounts
    add column if not exists admin_created_by uuid references auth.users(id) on delete set null,
    add column if not exists admin_contact_label text,
    add column if not exists billing_mode text;

update public.accounts
set billing_mode = 'standard'
where billing_mode is null;

alter table public.accounts
    alter column billing_mode set default 'standard',
    alter column billing_mode set not null;

alter table public.accounts
    drop constraint if exists accounts_billing_mode_check;

alter table public.accounts
    add constraint accounts_billing_mode_check
    check (billing_mode in ('standard', 'admin_free'));

create index if not exists accounts_billing_mode_idx on public.accounts (billing_mode);
create index if not exists accounts_admin_created_by_idx on public.accounts (admin_created_by);

commit;
