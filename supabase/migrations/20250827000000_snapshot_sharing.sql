-- Add snapshot sharing functionality
-- Allows creating public read-only links to dashboards

-- Table to track shared snapshots
create table if not exists public.snapshot_shares (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  share_token text not null unique, -- Public URL token (random, URL-safe)
  title text, -- Optional custom title for the shared dashboard
  description text, -- Optional description
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz, -- Optional expiration
  is_active boolean not null default true,
  access_count bigint not null default 0, -- Track usage
  last_accessed_at timestamptz,
  settings jsonb default '{}'::jsonb -- For future customization (hide certain metrics, etc.)
);

-- Indexes for performance
create index if not exists snapshot_shares_token_idx on public.snapshot_shares (share_token);
create index if not exists snapshot_shares_snapshot_id_idx on public.snapshot_shares (snapshot_id);
create index if not exists snapshot_shares_created_by_idx on public.snapshot_shares (created_by);

-- Function to generate URL-safe random tokens
create or replace function public.generate_share_token()
returns text language plpgsql as $$
declare
  token text;
  exists_check boolean;
begin
  loop
    -- Generate a 32-character URL-safe token
    token := encode(gen_random_bytes(24), 'base64');
    token := replace(replace(replace(token, '+', '-'), '/', '_'), '=', '');
    token := substr(token, 1, 32);
    
    -- Check if token already exists
    select exists(select 1 from public.snapshot_shares where share_token = token) into exists_check;
    exit when not exists_check;
  end loop;
  
  return token;
end;
$$;

-- RLS Policies for snapshot_shares
alter table public.snapshot_shares enable row level security;

-- Users can only see/manage shares they created
create policy "Users can view their own shares"
  on public.snapshot_shares for select
  using (created_by = auth.uid());

create policy "Users can create shares for their snapshots"
  on public.snapshot_shares for insert
  with check (
    exists (
      select 1 from public.snapshots s
      join public.accounts a on a.id = s.account_id
      where s.id = snapshot_id 
      and (a.owner_user_id = auth.uid() or public.is_admin())
    )
  );

create policy "Users can update their own shares"
  on public.snapshot_shares for update
  using (created_by = auth.uid());

create policy "Users can delete their own shares"
  on public.snapshot_shares for delete
  using (created_by = auth.uid());

-- Admins can see all shares
create policy "Admins can view all shares"
  on public.snapshot_shares for all
  using (public.is_admin());
