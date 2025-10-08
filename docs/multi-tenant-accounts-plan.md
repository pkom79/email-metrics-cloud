# Multi‑Tenant + Agency Plan (Superseded)

> **Status**: Deprecated September 2025. The product reverted to a single-account-per-user model with Global Admin overrides. This document remains for archival reference only and no longer reflects the live system.

This document defines a secure, scalable, and executable design for a multi‑tenant system with:
- Brand Accounts (companies) with Owner/Member roles and invitations
- Agencies that can manage multiple brand accounts
- CSV uploads with Storage metadata
- Global Admin with full access
- Instant update notifications delivered via Postmark

All components are designed for Supabase (Postgres + Auth + Storage), Next.js on Vercel, and Postmark for email.

## Feasibility Summary
- Security: Strict RLS gates every table; Admin bypass via `is_admin()`; all tokens hashed; notifications outbox is service‑only.
- Scalability: Tenant scoping via indexed `account_id`/`agency_id` columns; background outbox worker; minimal joins on hot paths.
- Permissions:
  - Brand: One canonical Owner (`accounts.owner_user_id`), up to 5 Members via `account_users`.
  - Agency: Users gain access to linked brands via agency entitlements (do not count toward brand’s 5‑member cap).
  - Only brand Owners manage brand Members/invitations. Agency cannot manage brand Members.
- Execution: SQL and policies are copy‑ready; API snippets are server‑safe; notifications integrate with Postmark templates using `{{brand_name}}` and `{{cta_url}}`.


## Schema
```sql
BEGIN;

-- Assumptions from existing baseline in this repo:
-- - public.accounts(id uuid pk, owner_user_id uuid not null, name text, ...)
-- - public.is_admin() exists (JWT role or equivalent); we keep compatibility.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_role') THEN
    CREATE TYPE public.account_role AS ENUM ('owner', 'member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
    CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agency_role') THEN
    CREATE TYPE public.agency_role AS ENUM ('owner', 'admin', 'member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_status') THEN
    CREATE TYPE public.link_status AS ENUM ('pending','approved','rejected','expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_topic') THEN
    CREATE TYPE public.notification_topic AS ENUM (
      'csv_uploaded','agency_link_requested','agency_link_approved','member_invited','member_revoked'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE public.delivery_status AS ENUM ('pending','processing','sent','error','dead');
  END IF;
END $$;

-- Optional: Global Admin list (in addition to JWT claim). is_admin() may already exist.
CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Compatibility: if your stack already defines is_admin(), either keep it,
-- or extend it to support both JWT roles and table-based admins.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- Table-based override
    EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
    -- Either claim works: legacy 'role' or custom 'app_role'
    OR COALESCE(NULLIF(auth.jwt() ->> 'role', ''), '') = 'admin'
    OR COALESCE(NULLIF(auth.jwt() ->> 'app_role', ''), '') = 'admin';
$$;

-- Account membership (Members separate from canonical Owner in accounts.owner_user_id)
CREATE TABLE IF NOT EXISTS public.account_users (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.account_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_users_one_owner_per_account
  ON public.account_users (account_id)
  WHERE (role = 'owner');

-- Invitations (brand Members only; agencies do not manage brand Members)
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email citext NOT NULL,
  token_hash text NOT NULL,
  status public.invite_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_unique_pending_email
  ON public.invitations (account_id, email)
  WHERE (status = 'pending');
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_unique
  ON public.invitations (token_hash);

-- CSV metadata (files live in Storage; path convention: accountId/*)
CREATE TABLE IF NOT EXISTS public.csv_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csv_files_account_id_idx ON public.csv_files (account_id);

-- Audit log (append‑only)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_table text,
  target_id uuid,
  details jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_account_id_idx ON public.audit_log (account_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_user_id);

-- Agencies (org above brands)
CREATE TABLE IF NOT EXISTS public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  brand_limit int NOT NULL DEFAULT 10,
  seat_limit int NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agency_users (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.agency_role NOT NULL,
  all_accounts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, user_id)
);

-- Link agency -> brand (one agency per brand recommended)
CREATE TABLE IF NOT EXISTS public.agency_accounts (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, account_id),
  UNIQUE (account_id)
);

-- Optional per-user scoping when all_accounts=false
CREATE TABLE IF NOT EXISTS public.agency_user_accounts (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, user_id, account_id)
);

-- Link requests (brand owner approval required when linking existing brands)
CREATE TABLE IF NOT EXISTS public.link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  status public.link_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  acted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS link_requests_token_hash_unique
  ON public.link_requests (token_hash);

-- Notifications (instant only; outbox + per-account subscriptions)
CREATE TABLE IF NOT EXISTS public.account_notification_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  topic public.notification_topic NOT NULL,
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL),
  UNIQUE (account_id, topic,
          COALESCE(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(recipient_email,''))
);

CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  deliver_after timestamptz NOT NULL DEFAULT now(),
  topic public.notification_topic NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  recipient_email text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.delivery_status NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS notifications_outbox_status_idx ON public.notifications_outbox (status, deliver_after);

-- Quota helpers for brand members and invites
CREATE OR REPLACE FUNCTION public.active_member_count(p_account uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int FROM public.account_users au WHERE au.account_id = p_account AND au.role = 'member';
$$;

CREATE OR REPLACE FUNCTION public.pending_invite_count(p_account uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int FROM public.invitations i WHERE i.account_id = p_account AND i.status = 'pending' AND i.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.assert_member_quota(p_account uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE member_count int; BEGIN
  SELECT public.active_member_count(p_account) INTO member_count;
  IF member_count >= 5 THEN RAISE EXCEPTION 'Member limit reached (max 5) for account %', p_account; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_invite_quota(p_account uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE member_count int; pending_count int; BEGIN
  SELECT public.active_member_count(p_account), public.pending_invite_count(p_account) INTO member_count, pending_count;
  IF (member_count + pending_count) >= 5 THEN
    RAISE EXCEPTION 'Invite limit reached: members(%) + pending(%) >= 5 for account %', member_count, pending_count, p_account;
  END IF;
END $$;

-- Quota: enforce on account_users + invitations
CREATE OR REPLACE FUNCTION public.trg_account_users_enforce_member_quota()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'member' THEN PERFORM public.assert_member_quota(NEW.account_id); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_before_account_users_insert_quota ON public.account_users;
CREATE TRIGGER trg_before_account_users_insert_quota BEFORE INSERT ON public.account_users
  FOR EACH ROW EXECUTE FUNCTION public.trg_account_users_enforce_member_quota();

DROP TRIGGER IF EXISTS trg_before_account_users_update_quota ON public.account_users;
CREATE TRIGGER trg_before_account_users_update_quota BEFORE UPDATE OF role ON public.account_users
  FOR EACH ROW WHEN (NEW.role = 'member') EXECUTE FUNCTION public.trg_account_users_enforce_member_quota();

CREATE OR REPLACE FUNCTION public.trg_invitations_enforce_invite_quota()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending' THEN PERFORM public.assert_invite_quota(NEW.account_id); END IF; RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_before_invitations_insert_quota ON public.invitations;
CREATE TRIGGER trg_before_invitations_insert_quota BEFORE INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.trg_invitations_enforce_invite_quota();

-- Agency quotas: seats and brands
CREATE OR REPLACE FUNCTION public.agency_seat_count(p_agency uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int FROM public.agency_users au WHERE au.agency_id = p_agency;
$$;

CREATE OR REPLACE FUNCTION public.agency_brand_count(p_agency uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int FROM public.agency_accounts aa WHERE aa.agency_id = p_agency;
$$;

CREATE OR REPLACE FUNCTION public.assert_agency_seat_quota(p_agency uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cnt int; lim int; BEGIN
  SELECT public.agency_seat_count(p_agency), a.seat_limit INTO cnt, lim FROM public.agencies a WHERE a.id = p_agency;
  IF cnt >= lim THEN RAISE EXCEPTION 'Agency seat limit reached (%) for %', lim, p_agency; END IF; END $$;

CREATE OR REPLACE FUNCTION public.assert_agency_brand_quota(p_agency uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cnt int; lim int; BEGIN
  SELECT public.agency_brand_count(p_agency), a.brand_limit INTO cnt, lim FROM public.agencies a WHERE a.id = p_agency;
  IF cnt >= lim THEN RAISE EXCEPTION 'Agency brand limit reached (%) for %', lim, p_agency; END IF; END $$;

CREATE OR REPLACE FUNCTION public.trg_agency_users_enforce_seats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM public.assert_agency_seat_quota(NEW.agency_id); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.trg_agency_accounts_enforce_brands()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM public.assert_agency_brand_quota(NEW.agency_id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_before_agency_users_insert_quota ON public.agency_users;
CREATE TRIGGER trg_before_agency_users_insert_quota BEFORE INSERT ON public.agency_users
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_users_enforce_seats();

DROP TRIGGER IF EXISTS trg_before_agency_accounts_insert_quota ON public.agency_accounts;
CREATE TRIGGER trg_before_agency_accounts_insert_quota BEFORE INSERT ON public.agency_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_accounts_enforce_brands();

-- Helpers: access resolution
CREATE OR REPLACE FUNCTION public.is_agency_user_of_account(p_account uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agency_accounts aa
    JOIN public.agency_users au ON au.agency_id = aa.agency_id AND au.user_id = auth.uid()
    WHERE aa.account_id = p_account
      AND (au.all_accounts = true OR EXISTS (
            SELECT 1 FROM public.agency_user_accounts aua
            WHERE aua.agency_id = aa.agency_id AND aua.user_id = au.user_id AND aua.account_id = p_account))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(p_account uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = p_account AND a.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.account_users au WHERE au.account_id = p_account AND au.user_id = auth.uid())
    OR public.is_agency_user_of_account(p_account);
$$;

CREATE OR REPLACE FUNCTION public.is_account_owner(p_account uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = p_account AND a.owner_user_id = auth.uid());
$$;

-- Notifications: enqueue on audit_log inserts
CREATE OR REPLACE FUNCTION public.enqueue_notifications_from_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.action IN ('csv_uploaded','agency_link_requested','agency_link_approved','member_invited','member_revoked') THEN
    INSERT INTO public.notifications_outbox (topic, account_id, recipient_user_id, recipient_email, payload)
    SELECT NEW.action::public.notification_topic, NEW.account_id, s.recipient_user_id, s.recipient_email,
           jsonb_build_object('action', NEW.action, 'details', NEW.details, 'target_table', NEW.target_table, 'target_id', NEW.target_id)
    FROM public.account_notification_subscriptions s
    WHERE s.account_id = NEW.account_id AND s.enabled = true AND s.topic = (NEW.action)::public.notification_topic;
  END IF; RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_log_enqueue ON public.audit_log;
CREATE TRIGGER trg_audit_log_enqueue AFTER INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_notifications_from_audit();

-- Minimal audit helper
CREATE OR REPLACE FUNCTION public.audit_log_event(
  p_action text, p_target_table text, p_target_id uuid, p_account_id uuid, p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (actor_user_id, account_id, action, target_table, target_id, details)
  VALUES (auth.uid(), p_account_id, p_action, p_target_table, p_target_id, p_details);
$$;

COMMIT;
```

## Policies
```sql
BEGIN;

-- Enable RLS
ALTER TABLE public.account_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_notification_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

-- accounts (assumes baseline policies exist). Recommended read policy:
DROP POLICY IF EXISTS accounts_select_read ON public.accounts;
CREATE POLICY accounts_select_read ON public.accounts FOR SELECT TO authenticated
USING (public.is_admin() OR public.is_account_member(id));

-- account_users
DROP POLICY IF EXISTS account_users_select ON public.account_users;
CREATE POLICY account_users_select ON public.account_users FOR SELECT TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.account_users me WHERE me.account_id = account_users.account_id AND me.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = account_users.account_id AND a.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS account_users_insert ON public.account_users;
CREATE POLICY account_users_insert ON public.account_users FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin() OR (
    -- Brand Owner adds Members (invite acceptance path)
    public.is_account_owner(NEW.account_id) AND NEW.role = 'member'
  )
);

DROP POLICY IF EXISTS account_users_delete ON public.account_users;
CREATE POLICY account_users_delete ON public.account_users FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_account_owner(account_id) AND role = 'member'));

-- invitations (brand Owner only)
DROP POLICY IF EXISTS invitations_select ON public.invitations;
CREATE POLICY invitations_select ON public.invitations FOR SELECT TO authenticated
USING (public.is_admin() OR public.is_account_owner(account_id));

DROP POLICY IF EXISTS invitations_insert ON public.invitations;
CREATE POLICY invitations_insert ON public.invitations FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR public.is_account_owner(account_id));

DROP POLICY IF EXISTS invitations_delete ON public.invitations;
CREATE POLICY invitations_delete ON public.invitations FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_account_owner(account_id) AND status = 'pending'));

-- csv_files (brand members + agency users)
DROP POLICY IF EXISTS csv_files_select ON public.csv_files;
CREATE POLICY csv_files_select ON public.csv_files FOR SELECT TO authenticated
USING (public.is_admin() OR public.is_account_member(account_id));

DROP POLICY IF EXISTS csv_files_insert ON public.csv_files;
CREATE POLICY csv_files_insert ON public.csv_files FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_account_member(account_id) AND uploaded_by = auth.uid()));

-- audit_log (read per account)
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
USING (public.is_admin() OR public.is_account_member(account_id));

DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (auth.uid() IS NOT NULL AND actor_user_id = auth.uid()))
;

-- agencies
DROP POLICY IF EXISTS agencies_owner_or_admin ON public.agencies;
CREATE POLICY agencies_owner_or_admin ON public.agencies FOR ALL TO authenticated
USING (public.is_admin() OR owner_user_id = auth.uid())
WITH CHECK (public.is_admin() OR owner_user_id = auth.uid());

-- agency_users
DROP POLICY IF EXISTS agency_users_manage ON public.agency_users;
CREATE POLICY agency_users_manage ON public.agency_users FOR ALL TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = agency_users.agency_id AND ag.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = agency_users.agency_id AND ag.owner_user_id = auth.uid()
  )
);

-- agency_accounts
DROP POLICY IF EXISTS agency_accounts_manage ON public.agency_accounts;
CREATE POLICY agency_accounts_manage ON public.agency_accounts FOR ALL TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = agency_accounts.agency_id AND ag.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = agency_accounts.agency_id AND ag.owner_user_id = auth.uid()
  )
);

-- agency_user_accounts (per-user scoping)
DROP POLICY IF EXISTS agency_user_accounts_manage ON public.agency_user_accounts;
CREATE POLICY agency_user_accounts_manage ON public.agency_user_accounts FOR ALL TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = agency_user_accounts.agency_id AND ag.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = agency_user_accounts.agency_id AND ag.owner_user_id = auth.uid()
  )
);

-- link_requests (visible to agency owner/admin and brand owner; writable by each side for their action)
DROP POLICY IF EXISTS link_requests_select ON public.link_requests;
CREATE POLICY link_requests_select ON public.link_requests FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.agencies ag JOIN public.agency_users au ON au.agency_id = ag.id AND au.user_id = auth.uid() WHERE ag.id = link_requests.agency_id)
  OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = link_requests.account_id AND a.owner_user_id = auth.uid())
);

DROP POLICY IF EXISTS link_requests_insert ON public.link_requests;
CREATE POLICY link_requests_insert ON public.link_requests FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.agencies ag WHERE ag.id = NEW.agency_id AND ag.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS link_requests_update ON public.link_requests;
CREATE POLICY link_requests_update ON public.link_requests FOR UPDATE TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid()) -- approve/reject by brand owner
  OR EXISTS (SELECT 1 FROM public.agencies ag WHERE ag.id = agency_id AND ag.owner_user_id = auth.uid()) -- cancel by agency
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.agencies ag WHERE ag.id = agency_id AND ag.owner_user_id = auth.uid())
);

-- notifications
DROP POLICY IF EXISTS subs_owner_or_admin ON public.account_notification_subscriptions;
CREATE POLICY subs_owner_or_admin ON public.account_notification_subscriptions FOR ALL TO authenticated
USING (
  public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid())
)
WITH CHECK (
  public.is_admin() OR EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid())
);

DROP POLICY IF EXISTS outbox_service_only ON public.notifications_outbox;
CREATE POLICY outbox_service_only ON public.notifications_outbox FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- app_admins
DROP POLICY IF EXISTS app_admins_select ON public.app_admins;
CREATE POLICY app_admins_select ON public.app_admins FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS app_admins_insert ON public.app_admins;
CREATE POLICY app_admins_insert ON public.app_admins FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS app_admins_delete ON public.app_admins;
CREATE POLICY app_admins_delete ON public.app_admins FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;
```

## API Examples (TypeScript)
```ts
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { ServerClient } from 'postmark';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function supabaseClient(accessToken?: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

export async function isAdmin(client: ReturnType<typeof supabaseClient>): Promise<boolean> {
  const { data, error } = await client.rpc('is_admin');
  if (error) throw error;
  return !!data;
}

// Brand role (from account_users); owner is resolved via accounts.owner_user_id
export async function getAccountRole(
  client: ReturnType<typeof supabaseClient>,
  accountId: string
): Promise<'owner' | 'member' | null> {
  const { data: acc } = await client.from('accounts').select('owner_user_id').eq('id', accountId).single();
  const { data: me } = await client.auth.getUser();
  const uid = me.user?.id;
  if (!uid) return null;
  if (acc?.owner_user_id === uid) return 'owner';
  const { data, error } = await client
    .from('account_users')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data?.role as 'owner' | 'member') ?? null;
}

export async function requireOwnerOrAdmin(client: ReturnType<typeof supabaseClient>, accountId: string) {
  if (await isAdmin(client)) return;
  const role = await getAccountRole(client, accountId);
  if (role !== 'owner') throw new Error('Only Owners (or Admins).');
}

export async function requireMemberOrAdmin(client: ReturnType<typeof supabaseClient>, accountId: string) {
  if (await isAdmin(client)) return;
  const role = await getAccountRole(client, accountId);
  if (!role) throw new Error('Only Members (or Admins).');
}

// Brand: create account (owner = caller)
export async function createAccount(
  client: ReturnType<typeof supabaseClient>,
  name: string
): Promise<{ accountId: string }> {
  const { data: me } = await client.auth.getUser();
  const uid = me.user?.id;
  if (!uid) throw new Error('No authenticated user.');

  const { data: account, error: accErr } = await client
    .from('accounts')
    .insert({ name, owner_user_id: uid })
    .select('id')
    .single();
  if (accErr) throw accErr;
  return { accountId: account.id };
}

// Brand: invite a member (Owner only)
export async function inviteMember(
  client: ReturnType<typeof supabaseClient>,
  accountId: string,
  email: string
): Promise<{ invitationId: string; rawToken: string }> {
  await requireOwnerOrAdmin(client, accountId);
  const rawToken = crypto.randomBytes(24).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const { data: invite, error } = await client
    .from('invitations')
    .insert({ account_id: accountId, email, token_hash: tokenHash })
    .select('id')
    .single();
  if (error) throw error;
  await client
    .rpc('audit_log_event', { p_action: 'member_invited', p_target_table: 'invitations', p_target_id: invite.id, p_account_id: accountId, p_details: { email } })
    .catch(() => {});
  return { invitationId: invite.id, rawToken };
}

// Brand: revoke a member (Owner only)
export async function revokeMember(
  client: ReturnType<typeof supabaseClient>,
  accountId: string,
  userId: string
) {
  await requireOwnerOrAdmin(client, accountId);
  const { error } = await client.from('account_users').delete().eq('account_id', accountId).eq('user_id', userId);
  if (error) throw error;
  await client
    .rpc('audit_log_event', { p_action: 'member_revoked', p_target_table: 'account_users', p_target_id: userId, p_account_id: accountId, p_details: {} })
    .catch(() => {});
}

// Upload a CSV (Brand Members and Agency users with access)
export async function uploadCsv(
  client: ReturnType<typeof supabaseClient>,
  accountId: string,
  file: File | Buffer,
  filename: string
): Promise<{ csvId: string; storagePath: string }> {
  await requireMemberOrAdmin(client, accountId);
  const objectId = crypto.randomUUID();
  const storagePath = `${accountId}/${objectId}-${filename}`;
  const storage = client.storage.from('csv-uploads');
  const uploadRes = await storage.upload(storagePath, file, { cacheControl: '3600', upsert: false, contentType: 'text/csv' });
  if (uploadRes.error) throw uploadRes.error;
  const isFile = typeof File !== 'undefined' && file instanceof File;
  const byteSize = isFile ? (file as File).size : Buffer.byteLength(file as Buffer);
  const buf = isFile ? Buffer.from(await (file as File).arrayBuffer()) : (file as Buffer);
  const checksum = crypto.createHash('sha256').update(buf).digest('hex');
  const { data: me } = await client.auth.getUser();
  const uid = me.user?.id!;
  const { data, error } = await client
    .from('csv_files')
    .insert({ account_id: accountId, storage_path: storagePath, filename, byte_size: byteSize, checksum, uploaded_by: uid })
    .select('id, storage_path')
    .single();
  if (error) throw error;
  await client
    .rpc('audit_log_event', { p_action: 'csv_uploaded', p_target_table: 'csv_files', p_target_id: data.id, p_account_id: accountId, p_details: { filename, storage_path: storagePath, byte_size: byteSize } })
    .catch(() => {});
  return { csvId: data.id, storagePath };
}

// Agencies: create agency (signup path)
export async function createAgency(client: ReturnType<typeof supabaseClient>, name: string, limits?: { brand_limit?: number; seat_limit?: number }) {
  const { data: me } = await client.auth.getUser();
  const uid = me.user?.id;
  if (!uid) throw new Error('No authenticated user.');
  const { data: agency, error } = await client
    .from('agencies')
    .insert({ name, owner_user_id: uid, ...(limits || {}) })
    .select('id')
    .single();
  if (error) throw error;
  // Owner gets an agency_users row
  await client.from('agency_users').insert({ agency_id: agency.id, user_id: uid, role: 'owner', all_accounts: true });
  return { agencyId: agency.id };
}

// Agencies: create brand (agency-owned) and link it
export async function agencyCreateBrand(
  client: ReturnType<typeof supabaseClient>,
  agencyId: string,
  brandName: string,
  ownerUserId?: string // defaults to creator
) {
  const { data: me } = await client.auth.getUser();
  const creator = me.user?.id!;
  const owner = ownerUserId || creator;
  // Create account with agency-selected owner
  const { data: acc, error: e1 } = await client.from('accounts').insert({ name: brandName, owner_user_id: owner }).select('id').single();
  if (e1) throw e1;
  // Link to agency
  const { error: e2 } = await client.from('agency_accounts').insert({ agency_id: agencyId, account_id: acc.id });
  if (e2) throw e2;
  await client.rpc('audit_log_event', { p_action: 'agency_link_approved', p_target_table: 'agency_accounts', p_target_id: acc.id, p_account_id: acc.id, p_details: { agency_id: agencyId } }).catch(() => {});
  return { accountId: acc.id };
}

// Agencies: request link to existing brand (brand owner approval)
export async function requestAgencyLink(
  client: ReturnType<typeof supabaseClient>,
  agencyId: string,
  accountId: string
) {
  const rawToken = crypto.randomBytes(24).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const { error } = await client
    .from('link_requests')
    .insert({ agency_id: agencyId, account_id: accountId, token_hash: tokenHash })
    .select('id')
    .single();
  if (error) throw error;
  await client.rpc('audit_log_event', { p_action: 'agency_link_requested', p_target_table: 'link_requests', p_target_id: null, p_account_id: accountId, p_details: { agency_id: agencyId } }).catch(() => {});
  return { rawToken };
}

// Link approval (server-side with service key)
export async function approveAgencyLink(serviceClient: ReturnType<typeof createClient>, token: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: req, error } = await serviceClient
    .from('link_requests')
    .select('id, agency_id, account_id, status, expires_at')
    .eq('token_hash', tokenHash)
    .single();
  if (error || !req || req.status !== 'pending' || new Date(req.expires_at) <= new Date()) throw new Error('Invalid or expired');
  await serviceClient.from('agency_accounts').insert({ agency_id: req.agency_id, account_id: req.account_id });
  await serviceClient.from('link_requests').update({ status: 'approved', acted_at: new Date().toISOString() }).eq('id', req.id);
  await serviceClient.rpc('audit_log_event', { p_action: 'agency_link_approved', p_target_table: 'link_requests', p_target_id: req.id, p_account_id: req.account_id, p_details: { agency_id: req.agency_id } });
}

// Notifications worker (Vercel cron) – Postmark
export async function processNotifications(serviceClient: ReturnType<typeof createClient>) {
  const postmark = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://emailmetrics.io';

  const { data: rows, error } = await serviceClient
    .from('notifications_outbox')
    .select('*')
    .eq('status', 'pending')
    .lte('deliver_after', new Date().toISOString())
    .limit(50);
  if (error) throw error;

  for (const row of rows ?? []) {
    // Claim
    const { data: claim, error: upd1 } = await serviceClient
      .from('notifications_outbox')
      .update({ status: 'processing', attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .single();
    if (upd1 || !claim) continue;

    try {
      // Resolve brand name dynamically for freshness
      const { data: acc } = await serviceClient.from('accounts').select('name').eq('id', row.account_id).single();
      const brandName = acc?.name ?? 'Brand';
      const dashboardUrl = `${siteUrl}/dashboard?account=${row.account_id}`;

      const to = row.recipient_email || (await resolveUserEmail(serviceClient, row.recipient_user_id));
      if (!to) throw new Error('No recipient');

      await postmark.sendEmailWithTemplate({
        From: process.env.POSTMARK_FROM!,
        To: to,
        TemplateId: Number(process.env.POSTMARK_TEMPLATE_NOTIFICATION_ID!),
        MessageStream: process.env.POSTMARK_STREAM || 'outbound',
        TemplateModel: { brand_name: brandName, cta_url: dashboardUrl },
      });

      await serviceClient.from('notifications_outbox').update({ status: 'sent' }).eq('id', row.id);
    } catch (e: any) {
      const attempts = (row.attempts ?? 0) + 1;
      const nextStatus = attempts >= 5 ? 'dead' : 'pending';
      const delayMs = Math.min(60 * 60 * 1000, 2 ** attempts * 1000);
      await serviceClient
        .from('notifications_outbox')
        .update({ status: nextStatus, last_error: String(e?.message || e), deliver_after: new Date(Date.now() + delayMs).toISOString() })
        .eq('id', row.id);
    }
  }
}

async function resolveUserEmail(serviceClient: ReturnType<typeof createClient>, userId?: string | null) {
  if (!userId) return null;
  const { data, error } = await serviceClient.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user?.email ?? null;
}
```

## Signup & Onboarding
- Brand signup (existing): auto‑creates a brand account owned by the user (keep your baseline trigger) – no changes.
- Agency signup (new): separate footer link to Agency signup; collect agency details. On first login, create an Agency and add the user as Agency Owner (all_accounts=true). No brand is auto‑created.
- Agencies see no accounts until they create a brand or a brand owner approves a link (empty state UX required).
- Baseline trigger note: update your `handle_new_user()` trigger to early‑return when `raw_user_meta_data.signup_type = 'agency'` so it does not auto‑create a brand for agency signups.

## Approvals & Invitations
- Link existing brand to agency requires brand Owner approval via `link_requests` token.
- Agency‑created brands designate which agency user is the initial Owner (default: creator).
- Brand Members are invited via `invitations` by brand Owner only; agencies cannot manage brand Members.

## Notifications (Postmark)
- Instant notifications when data updates (e.g., `csv_uploaded`).
- Postmark template variables in use: `{{brand_name}}` and `{{cta_url}}` (subject includes brand_name).
- Worker route: `app/api/cron/notifications/route.ts` scheduled via Vercel cron `*/1 * * * *` (vercel.json adds `/api/cron/notifications`).
- Env vars: `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM`, `POSTMARK_TEMPLATE_NOTIFICATION_ID`, optional `POSTMARK_STREAM`, plus `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Outbox + worker ensures reliability; API paths may also send inline for immediacy.

## Logs & Diagnostics
- Audit log (tenant-visible)
  - Table: `public.audit_log` (already defined).
  - Fields: `occurred_at, account_id, actor_user_id, action, target_table, target_id, details`.
  - Access: Brand Owners/Members and Agency users can read rows for accounts they can access via `public.is_account_member(account_id)`; Admins can read all.
  - Content: Human-friendly actions (signin, csv_uploaded, member_invited/revoked, agency_link_requested/approved). No secrets or raw tokens; keep details sanitized.

- Notifications outbox (system queue)
  - Table: `public.notifications_outbox` (already defined).
  - Fields: `status, attempts, last_error, deliver_after, payload` (optionally add `provider_message_id`, `sent_at`).
  - Access: Service role only (admin UI reads via server). Tenants do not see this table.
  - Purpose: Reliability/diagnostics for email delivery; worker uses it to retry with backoff.

- Admin diagnostics (admin-only)
  - Table: `public.admin_diagnostics` (additive; for deep technical traces: storage errors, provider responses, policy failures).
  - Access: `service_role` can write; Admins can SELECT; tenants have no access.
  - Suggested schema (copy-ready):
    ```sql
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
      p_correlation_id uuid default null
    ) returns void
    language sql
    security definer
    set search_path = public
    as $$
      insert into public.admin_diagnostics
        (level, source, account_id, actor_user_id, code, message, context, correlation_id)
      values
        (p_level, p_source, p_account_id, auth.uid(), p_code, p_message, p_context, p_correlation_id);
    $$;
    commit;
    ```
  - Usage: On API/worker errors, write an entry with `code`, `message`, and minimal `context`. Never log secrets or raw tokens.

- Correlation IDs
  - Generate a `uuid` at the start of key flows (uploads, approvals) and include it in `audit_log.details`, `admin_diagnostics.correlation_id`, and logs. This lets Admins trace incidents end-to-end.

- Retention & cleanup
  - Audit: 180 days; Diagnostics: 30–90 days; Outbox: 30 days. Add purge steps to your existing cleanup job.
  - Copy-ready purge SQL helpers:
    ```sql
    -- Delete diagnostics older than N days; returns deleted row count
    create or replace function public.purge_admin_diagnostics(retention_days int)
    returns int language sql as $$
      with d as (
        delete from public.admin_diagnostics
        where occurred_at < now() - make_interval(days => retention_days)
        returning 1
      ) select count(*) from d;
    $$;

    -- Delete outbox rows in (sent, dead) older than N days; returns deleted row count
    create or replace function public.purge_notifications_outbox(retention_days int)
    returns int language sql as $$
      with d as (
        delete from public.notifications_outbox
        where status in ('sent','dead')
          and created_at < now() - make_interval(days => retention_days)
        returning 1
      ) select count(*) from d;
    $$;
    ```
  - Cleanup integration example (server, service-role):
    ```ts
    // Inside your existing cleanup master route
    const DIAG_DAYS = Number(process.env.DIAG_RETENTION_DAYS || 90);
    const OUTBOX_DAYS = Number(process.env.OUTBOX_RETENTION_DAYS || 30);
    const { data: d1 } = await supabaseAdmin.rpc('purge_admin_diagnostics', { retention_days: DIAG_DAYS });
    const { data: d2 } = await supabaseAdmin.rpc('purge_notifications_outbox', { retention_days: OUTBOX_DAYS });
    results.operations.diagnosticsPurge = { deleted: d1 ?? 0 };
    results.operations.outboxPurge = { deleted: d2 ?? 0 };
    ```

## Storage Policies
- Bucket: `csv-uploads` (private). Path convention: `${accountId}/...`.
- Helper: `public.account_id_from_path(name text) returns uuid` parses the first path segment; returns NULL if invalid.
- Policies on `storage.objects` (to authenticated): allow SELECT/INSERT/UPDATE/DELETE when `bucket_id='csv-uploads'` and `public.is_account_member(public.account_id_from_path(name))` (Admin bypass via is_admin inside helper checks). Service role retains full access for the same bucket.
- Effect: Agency users get Storage read/write for linked brands without being added as brand Members; tenant boundary in Storage matches DB.

Core SQL (reference)
```sql
create or replace function public.account_id_from_path(p_name text)
returns uuid language plpgsql immutable as $$
declare seg text; out_id uuid; begin
  seg := split_part(coalesce(p_name,''), '/', 1);
  begin out_id := seg::uuid; exception when others then return null; end;
  return out_id;
end $$;

alter table storage.objects enable row level security;

create policy "authenticated_csv_uploads_member_or_agency" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'csv-uploads' and (
      public.is_admin() or public.is_account_member(public.account_id_from_path(name))
    )
  )
  with check (
    bucket_id = 'csv-uploads' and (
      public.is_admin() or public.is_account_member(public.account_id_from_path(name))
    )
  );

create policy "service_role_csv_uploads_access" on storage.objects
  for all to service_role
  using (bucket_id = 'csv-uploads') with check (bucket_id = 'csv-uploads');
```

## Billing‑Ready Structure (no Stripe yet)
- Add `plan_catalog` and `subscriptions` later to support:
  - Brand plans: single‑tier monthly/annual per account.
  - Agency plans: tiered by managed brand count (e.g., 1–10, 11–25, ...).
- Enforce seat/brand limits using existing triggers; change limits when plan changes.

## Hardening & Indices
- Ensure indexes on: `csv_files(account_id)`, `audit_log(account_id)`, `agency_accounts(account_id)`, `agency_users(agency_id)`, outbox `(status, deliver_after)`.
- Hash all tokens; never store raw tokens.
- All SECURITY DEFINER functions set `search_path = public`.

## Execution Checklist
- Migrations: add agency, link_requests, notifications tables + helpers + policies.
- Storage: add `account_id_from_path` + Storage RLS for `csv-uploads` (authenticated member/agency, service_role full access).
- API: add Agency signup flow, link approval endpoint, CSV upload uses `is_account_member()`.
- Postmark: create/update template; set env vars: POSTMARK_SERVER_TOKEN, POSTMARK_FROM, POSTMARK_TEMPLATE_NOTIFICATION_ID, POSTMARK_STREAM.
- Vercel: ensure cron for `/api/cron/notifications` every minute in vercel.json.

## Branding & UI Notes
- Keep all new UI (Agency signup pages, empty states, link approvals, notifications settings) consistent with existing brand styles (typography, spacing, colors, button styles). Reuse existing components where possible.
- Email templates (Postmark) must match current transactional look and feel. Template variables used: `{{brand_name}}`, `{{cta_url}}`.
- Agency dashboard empty state: clear CTA to “Create Brand” or “Request Access” and brief explainer copy.
- Approvals UI: show agency name, brand name, and consequences of approval; keep primary actions styled as current brand primary buttons.
```
