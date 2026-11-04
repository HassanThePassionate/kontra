-- ============================================================================
-- KONTRORA PROPOSAL LIFECYCLE MANAGEMENT — DATABASE SCHEMA (STEP 3.1)
-- ============================================================================
-- This migration creates the core tables, constraints, relationships, indexes,
-- append-only immutability trigger, and privilege restrictions for proposals
-- and their associated audit history.
--
-- File: supabase/proposals.sql
-- Dependencies: public.accounts, public.user_profiles, public.update_updated_at_column
--
-- ARCHITECTURAL DECISIONS & AUDIT COMPLIANCE:
-- 1. TENANT BOUNDARY:
--    - proposals.account_id references public.accounts(id) ON DELETE RESTRICT.
--    - Proposals represent legal and financial contracts. Deleting an account
--      with active or historical proposals is blocked to prevent accidental
--      destruction of contractual and audit records.
--
-- 2. IMMUTABLE AUDIT TRAIL:
--    - proposal_history is append-only. UPDATE and DELETE are blocked by trigger.
--    - proposal_history.proposal_id references public.proposals(id) ON DELETE RESTRICT.
--    - Hard-deletion of proposals with history is blocked. Normal lifecycle uses
--      archival/restoration (archived_at / archived_by).
--
-- 3. AUDIT ACTOR PRESERVATION:
--    - proposal_history.actor_id is a plain UUID without foreign key constraint.
--      This avoids ON DELETE SET NULL which would attempt to mutate immutable
--      rows (violating the trigger) and preserves historical actor attribution
--      even if the originating user profile is later deleted.
--
-- 4. PRIVILEGE HARDENING & DML LOCKDOWN:
--    - Direct INSERT, UPDATE, DELETE, TRUNCATE are revoked from PUBLIC, anon,
--      authenticated, and service_role.
--    - All mutations in Step 3.2+ are mediated strictly through SECURITY DEFINER RPCs.
--    - Authenticated users and service_role have SELECT only (subject to RLS).
--
-- 5. TRIGGER SAFETY:
--    - References schema-qualified public.update_updated_at_column().
--    - Immutability trigger function uses pinned search_path = public, pg_temp.
-- ============================================================================

-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TABLE: public.proposals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  title            TEXT NOT NULL CHECK (char_length(btrim(title)) > 0),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  deliverables     JSONB NOT NULL DEFAULT '[]'::jsonb
                     CHECK (jsonb_typeof(deliverables) = 'array'),
  total_amount     NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency         TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  valid_until      TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  internal_notes   TEXT,
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  archived_at      TIMESTAMPTZ,
  archived_by      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- State-timestamp consistency constraints
  CONSTRAINT chk_proposals_sent_at CHECK (
    (status = 'draft' AND sent_at IS NULL) OR
    (status != 'draft' AND sent_at IS NOT NULL)
  ),
  CONSTRAINT chk_proposals_accepted_at CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL) OR
    (status != 'accepted' AND accepted_at IS NULL)
  ),
  CONSTRAINT chk_proposals_rejected_at CHECK (
    (status = 'rejected' AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL) OR
    (status != 'rejected' AND rejected_at IS NULL)
  ),
  CONSTRAINT chk_proposals_archived CHECK (
    (archived_at IS NULL AND archived_by IS NULL) OR
    (archived_at IS NOT NULL)
  )
);

-- Comments for database documentation
COMMENT ON TABLE public.proposals IS 'Commercial proposals and contracts associated with accounts.';
COMMENT ON COLUMN public.proposals.account_id IS 'Target client account entity (tenant boundary). Restricts account deletion while proposals exist.';
COMMENT ON COLUMN public.proposals.internal_notes IS 'Proprietary staff estimation notes and margins. Excluded from client-facing views.';
COMMENT ON COLUMN public.proposals.deliverables IS 'Array of proposal line items / deliverable definitions.';

-- Auto-update updated_at on UPDATE (schema-qualified)
DROP TRIGGER IF EXISTS trg_proposals_updated_at ON public.proposals;
CREATE TRIGGER trg_proposals_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Performance and Tenant Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_proposals_account_id ON public.proposals(account_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON public.proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_active ON public.proposals(account_id, status)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_stale_check ON public.proposals(valid_until)
  WHERE status = 'sent' AND archived_at IS NULL;

-- ============================================================================
-- 2. TABLE: public.proposal_history (Append-Only Audit Log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.proposal_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id      UUID NOT NULL REFERENCES public.proposals(id) ON DELETE RESTRICT,
  from_status      TEXT,  -- NULL if and only if action = 'create' (NULL -> 'draft')
  to_status        TEXT NOT NULL,
  action           TEXT NOT NULL
                     CHECK (action IN ('create', 'update', 'send', 'accept', 'reject', 'draft', 'expire', 'archive', 'restore')),
  rejection_reason TEXT,
  actor_id         UUID,  -- Plain UUID without foreign key to prevent SET NULL mutation on immutable rows
  actor_email      TEXT,  -- Human-readable actor identity preserved at event time
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('staff', 'client', 'system')),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(metadata) = 'object'),
  snapshot         JSONB NOT NULL
                     CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Initial creation must be unambiguous (NULL -> draft)
  CONSTRAINT chk_proposal_history_create_from_status CHECK (
    (action = 'create' AND from_status IS NULL AND to_status = 'draft') OR
    (action != 'create' AND from_status IS NOT NULL)
  )
);

COMMENT ON TABLE public.proposal_history IS 'Append-only immutable audit log of all proposal transitions and snapshots.';
COMMENT ON COLUMN public.proposal_history.actor_id IS 'UUID of acting user at event time (no FK constraint to preserve audit integrity upon user deletion).';
COMMENT ON COLUMN public.proposal_history.snapshot IS 'Exact JSONB row image of public.proposals produced via to_jsonb() immediately post-transition.';

-- Indexes for Audit Inquiries & History Lookups
CREATE INDEX IF NOT EXISTS idx_proposal_history_proposal ON public.proposal_history(proposal_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_proposal_history_actor ON public.proposal_history(actor_id);

-- ============================================================================
-- 3. TRIGGER: Enforce History Immutability (Append-Only)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_proposal_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Audit trail violation: proposal_history records are immutable (UPDATE disallowed)'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit trail violation: proposal_history records are immutable (DELETE disallowed)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.prevent_proposal_history_mutation() OWNER TO postgres;

-- Explicitly revoke EXECUTE from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.prevent_proposal_history_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proposal_history_immutable ON public.proposal_history;
CREATE TRIGGER trg_proposal_history_immutable
  BEFORE UPDATE OR DELETE ON public.proposal_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_proposal_history_mutation();

-- ============================================================================
-- 4. ROW-LEVEL SECURITY & PRIVILEGE LOCKDOWN
-- ============================================================================
-- Enable RLS (default-deny for all roles without explicit policies)
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_history ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke ALL privileges (including TRUNCATE, INSERT, UPDATE, DELETE)
-- from PUBLIC, anon, and authenticated to prevent unauthorized mutations
REVOKE ALL PRIVILEGES ON TABLE public.proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.proposal_history FROM PUBLIC, anon, authenticated;

-- Revoke direct DML from service_role to enforce RPC-mediated state machine
REVOKE ALL PRIVILEGES ON TABLE public.proposals FROM service_role;
REVOKE ALL PRIVILEGES ON TABLE public.proposal_history FROM service_role;

-- Apply least-privilege SELECT grants
-- (Mutations are permitted strictly via Step 3.2 SECURITY DEFINER RPCs)
GRANT SELECT ON TABLE public.proposals TO authenticated, service_role;
GRANT SELECT ON TABLE public.proposal_history TO authenticated, service_role;



-- ============================================================================
-- 5. AUTHORIZATION HELPER FUNCTIONS
-- ============================================================================

-- Internal check: Can a specific user view proposals for an account?
CREATE OR REPLACE FUNCTION public._user_can_view_account_proposals_internal(
  p_user_id    UUID,
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_is_superadmin BOOLEAN;
  v_is_client     BOOLEAN;
  v_client_acc_id UUID;
  v_has_access    BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_account_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Check user profile flags
  SELECT is_superadmin, is_client, client_account_id
    INTO v_is_superadmin, v_is_client, v_client_acc_id
    FROM public.user_profiles
   WHERE id = p_user_id;

  -- Superadmin has unconditional access
  IF COALESCE(v_is_superadmin, FALSE) THEN
    RETURN TRUE;
  END IF;

  -- Client user: can only view proposals belonging to their assigned account
  IF COALESCE(v_is_client, FALSE) THEN
    RETURN (v_client_acc_id IS NOT NULL AND v_client_acc_id = p_account_id);
  END IF;

  -- 2. Staff user: Check for organization-wide override permission (view_all_proposals)
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = p_user_id
       AND (
         COALESCE((r.permissions->>'view_all_proposals')::boolean, FALSE) = TRUE
         OR COALESCE((r.permissions->>'view_all_accounts')::boolean, FALSE) = TRUE
       )
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. Staff user: Check base view permission (view_proposals or view_accounts)
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = p_user_id
       AND (
         COALESCE((r.permissions->>'view_proposals')::boolean, FALSE) = TRUE
         OR COALESCE((r.permissions->>'view_accounts')::boolean, FALSE) = TRUE
       )
  ) THEN
    RETURN FALSE;
  END IF;

  -- 4. Context check: Is staff user assigned to this account, its projects, or its tasks?
  -- Check account manager or direct account membership
  IF EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND account_manager_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.account_members WHERE account_id = p_account_id AND user_id = p_user_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check project assignments or project ownership in this account
  IF EXISTS (
    SELECT 1 FROM public.projects
     WHERE account_id = p_account_id
       AND (created_by = p_user_id OR assigned_user_id = p_user_id)
  ) OR EXISTS (
    SELECT 1 FROM public.projects p
      JOIN public.project_assignments pa ON pa.project_id = p.id
     WHERE p.account_id = p_account_id
       AND pa.user_id = p_user_id
       AND pa.removed_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id
     WHERE p.account_id = p_account_id
       AND t.assigned_to = p_user_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

ALTER FUNCTION public._user_can_view_account_proposals_internal(UUID, UUID) OWNER TO postgres;

-- Internal check: Can a specific user manage proposals for an account?
CREATE OR REPLACE FUNCTION public._user_can_manage_account_proposals_internal(
  p_user_id    UUID,
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_is_superadmin BOOLEAN;
  v_is_client     BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_account_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT is_superadmin, is_client
    INTO v_is_superadmin, v_is_client
    FROM public.user_profiles
   WHERE id = p_user_id;

  IF COALESCE(v_is_superadmin, FALSE) THEN
    RETURN TRUE;
  END IF;

  -- Clients can NEVER manage proposals
  IF COALESCE(v_is_client, FALSE) THEN
    RETURN FALSE;
  END IF;

  -- Staff: Check for manage_proposals permission
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = p_user_id
       AND (
         COALESCE((r.permissions->>'manage_proposals')::boolean, FALSE) = TRUE
         OR COALESCE((r.permissions->>'manage_accounts')::boolean, FALSE) = TRUE
       )
  ) THEN
    RETURN FALSE;
  END IF;

  -- Context check: Must be account manager, account member, or project lead
  IF EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND account_manager_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.account_members WHERE account_id = p_account_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.projects
     WHERE account_id = p_account_id
       AND (created_by = p_user_id OR assigned_user_id = p_user_id)
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

ALTER FUNCTION public._user_can_manage_account_proposals_internal(UUID, UUID) OWNER TO postgres;

-- Public wrapper: Binds auth.uid() automatically (prevents identity spoofing)
CREATE OR REPLACE FUNCTION public.user_can_view_account_proposals(
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN public._user_can_view_account_proposals_internal(auth.uid(), p_account_id);
END;
$$;

ALTER FUNCTION public.user_can_view_account_proposals(UUID) OWNER TO postgres;

-- Public wrapper: Binds auth.uid() automatically (prevents identity spoofing)
CREATE OR REPLACE FUNCTION public.user_can_manage_account_proposals(
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN public._user_can_manage_account_proposals_internal(auth.uid(), p_account_id);
END;
$$;

ALTER FUNCTION public.user_can_manage_account_proposals(UUID) OWNER TO postgres;

-- ============================================================================
-- 6. ROW-LEVEL SECURITY POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "proposals_select_authenticated" ON public.proposals;
CREATE POLICY "proposals_select_authenticated"
  ON public.proposals
  FOR SELECT
  TO authenticated
  USING (public.user_can_view_account_proposals(account_id));

DROP POLICY IF EXISTS "proposal_history_select_staff" ON public.proposal_history;
CREATE POLICY "proposal_history_select_staff"
  ON public.proposal_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
       WHERE p.id = proposal_history.proposal_id
         AND public.user_can_manage_account_proposals(p.account_id)
    )
  );

-- ============================================================================
-- 7. CLIENT-SAFE VIEW: public.client_proposals
-- ============================================================================
-- Excludes internal staff notes, drafts, archived proposals, and staff audit metadata
CREATE OR REPLACE VIEW public.client_proposals
WITH (security_barrier = true) AS
SELECT
  p.id,
  p.account_id,
  p.title,
  p.status,
  p.deliverables,
  p.total_amount,
  p.currency,
  p.valid_until,
  p.sent_at,
  p.accepted_at,
  p.rejected_at,
  p.rejection_reason,
  p.version,
  p.created_at,
  p.updated_at
FROM public.proposals p
WHERE p.archived_at IS NULL
  AND p.status IN ('sent', 'accepted', 'rejected', 'expired')
  AND public.user_can_view_account_proposals(p.account_id);

COMMENT ON VIEW public.client_proposals IS 'Client-safe projection of commercial proposals excluding internal estimation notes and draft states.';

-- ============================================================================
-- 8. PROPOSAL LIFECYCLE MANAGEMENT RPCS (SECURITY DEFINER)
-- ============================================================================

-- RPC: Create draft proposal with atomic audit entry
CREATE OR REPLACE FUNCTION public.create_draft_proposal(
  p_account_id     UUID,
  p_title          TEXT,
  p_total_amount   NUMERIC,
  p_currency       TEXT DEFAULT 'USD',
  p_valid_until    TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  p_deliverables   JSONB DEFAULT '[]'::jsonb,
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_caller_id   UUID;
  v_caller_email TEXT;
  v_proposal    public.proposals%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Verify caller has manage permissions for this account
  IF NOT public._user_can_manage_account_proposals_internal(v_caller_id, p_account_id) THEN
    RAISE EXCEPTION 'Permission denied: cannot create proposals for account %', p_account_id
      USING ERRCODE = '42501';
  END IF;

  -- Validate input constraints
  IF btrim(p_title) IS NULL OR char_length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Proposal title cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_total_amount < 0 THEN
    RAISE EXCEPTION 'Proposal total amount cannot be negative' USING ERRCODE = '22023';
  END IF;

  IF p_valid_until <= NOW() THEN
    RAISE EXCEPTION 'Validity period must be in the future' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_deliverables) != 'array' THEN
    RAISE EXCEPTION 'Deliverables must be a JSONB array' USING ERRCODE = '22023';
  END IF;

  -- Resolve actor email for audit record
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  -- Insert proposal in draft status
  INSERT INTO public.proposals (
    account_id,
    title,
    status,
    deliverables,
    total_amount,
    currency,
    valid_until,
    internal_notes,
    created_by
  ) VALUES (
    p_account_id,
    btrim(p_title),
    'draft',
    p_deliverables,
    p_total_amount,
    COALESCE(p_currency, 'USD'),
    p_valid_until,
    p_internal_notes,
    v_caller_id
  )
  RETURNING * INTO v_proposal;

  -- Atomic initial audit log entry (NULL -> draft)
  INSERT INTO public.proposal_history (
    proposal_id,
    from_status,
    to_status,
    action,
    actor_id,
    actor_email,
    actor_type,
    metadata,
    snapshot
  ) VALUES (
    v_proposal.id,
    NULL,
    'draft',
    'create',
    v_caller_id,
    v_caller_email,
    'staff',
    jsonb_build_object('source', 'rpc_create_draft'),
    to_jsonb(v_proposal)
  );

  RETURN to_jsonb(v_proposal);
END;
$$;

ALTER FUNCTION public.create_draft_proposal(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, JSONB, TEXT) OWNER TO postgres;

-- RPC: Update draft proposal
CREATE OR REPLACE FUNCTION public.update_draft_proposal(
  p_proposal_id    UUID,
  p_title          TEXT DEFAULT NULL,
  p_total_amount   NUMERIC DEFAULT NULL,
  p_currency       TEXT DEFAULT NULL,
  p_valid_until    TIMESTAMPTZ DEFAULT NULL,
  p_deliverables   JSONB DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_caller_id   UUID;
  v_caller_email TEXT;
  v_current     public.proposals%ROWTYPE;
  v_updated     public.proposals%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Lock proposal row for update
  SELECT * INTO v_current
    FROM public.proposals
   WHERE id = p_proposal_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
  END IF;

  -- Authorization check
  IF NOT public._user_can_manage_account_proposals_internal(v_caller_id, v_current.account_id) THEN
    RAISE EXCEPTION 'Permission denied to modify proposal %', p_proposal_id USING ERRCODE = '42501';
  END IF;

  -- Only unarchived drafts can be modified
  IF v_current.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived proposals cannot be updated' USING ERRCODE = '55000';
  END IF;

  IF v_current.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft proposals can be updated directly (current status: %)', v_current.status
      USING ERRCODE = '55000';
  END IF;

  -- Input validation
  IF p_title IS NOT NULL AND char_length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Proposal title cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_total_amount IS NOT NULL AND p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative' USING ERRCODE = '22023';
  END IF;

  IF p_deliverables IS NOT NULL AND jsonb_typeof(p_deliverables) != 'array' THEN
    RAISE EXCEPTION 'Deliverables must be a JSONB array' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  -- Update row and increment version
  UPDATE public.proposals
     SET title          = COALESCE(btrim(p_title), v_current.title),
         total_amount   = COALESCE(p_total_amount, v_current.total_amount),
         currency       = COALESCE(p_currency, v_current.currency),
         valid_until    = COALESCE(p_valid_until, v_current.valid_until),
         deliverables   = COALESCE(p_deliverables, v_current.deliverables),
         internal_notes = COALESCE(p_internal_notes, v_current.internal_notes),
         version        = v_current.version + 1,
         updated_at     = NOW()
   WHERE id = p_proposal_id
  RETURNING * INTO v_updated;

  -- Append audit history entry
  INSERT INTO public.proposal_history (
    proposal_id,
    from_status,
    to_status,
    action,
    actor_id,
    actor_email,
    actor_type,
    metadata,
    snapshot
  ) VALUES (
    v_updated.id,
    'draft',
    'draft',
    'update',
    v_caller_id,
    v_caller_email,
    'staff',
    jsonb_build_object('source', 'rpc_update_draft', 'new_version', v_updated.version),
    to_jsonb(v_updated)
  );

  RETURN to_jsonb(v_updated);
END;
$$;

ALTER FUNCTION public.update_draft_proposal(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, JSONB, TEXT) OWNER TO postgres;

-- RPC: Execute state transitions with concurrency protection and audit snapshot
CREATE OR REPLACE FUNCTION public.execute_proposal_transition(
  p_proposal_id UUID,
  p_action      TEXT,
  p_reason      TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_caller_id     UUID;
  v_caller_email  TEXT;
  v_is_client     BOOLEAN;
  v_client_acc_id UUID;
  v_actor_type    TEXT;
  v_proposal      public.proposals%ROWTYPE;
  v_updated       public.proposals%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Lock proposal row with FOR UPDATE
  SELECT * INTO v_proposal
    FROM public.proposals
   WHERE id = p_proposal_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
  END IF;

  -- Resolve caller identity and client status
  SELECT is_client, client_account_id
    INTO v_is_client, v_client_acc_id
    FROM public.user_profiles
   WHERE id = v_caller_id;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  IF COALESCE(v_is_client, FALSE) THEN
    -- ========================================================================
    -- CLIENT TRANSITION RULES
    -- ========================================================================
    v_actor_type := 'client';

    -- NULL-safe client account check
    IF v_client_acc_id IS NULL OR v_client_acc_id != v_proposal.account_id THEN
      RAISE EXCEPTION 'Access denied: caller does not belong to client account %', v_proposal.account_id
        USING ERRCODE = '42501';
    END IF;

    -- Proposals must not be archived
    IF v_proposal.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot interact with an archived proposal' USING ERRCODE = '55000';
    END IF;

    -- Clients can only act on sent proposals
    IF v_proposal.status != 'sent' THEN
      RAISE EXCEPTION 'Clients may only interact with proposals in sent status (current: %)', v_proposal.status
        USING ERRCODE = '55000';
    END IF;

    -- Check validity date
    IF NOW() > v_proposal.valid_until THEN
      RAISE EXCEPTION 'Proposal validity period expired on %', v_proposal.valid_until
        USING ERRCODE = '55000';
    END IF;

    IF p_action = 'accept' THEN
      UPDATE public.proposals
         SET status      = 'accepted',
             accepted_at = NOW(),
             updated_at  = NOW()
       WHERE id = p_proposal_id
      RETURNING * INTO v_updated;

    ELSIF p_action = 'reject' THEN
      IF btrim(p_reason) IS NULL OR char_length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A rejection reason is required when rejecting a proposal'
          USING ERRCODE = '22023';
      END IF;

      UPDATE public.proposals
         SET status           = 'rejected',
             rejected_at      = NOW(),
             rejection_reason = btrim(p_reason),
             updated_at       = NOW()
       WHERE id = p_proposal_id
      RETURNING * INTO v_updated;

    ELSE
      RAISE EXCEPTION 'Invalid client action "%". Allowed actions: accept, reject', p_action
        USING ERRCODE = '22023';
    END IF;

  ELSE
    -- ========================================================================
    -- STAFF TRANSITION RULES
    -- ========================================================================
    v_actor_type := 'staff';

    IF NOT public._user_can_manage_account_proposals_internal(v_caller_id, v_proposal.account_id) THEN
      RAISE EXCEPTION 'Permission denied to manage proposals for account %', v_proposal.account_id
        USING ERRCODE = '42501';
    END IF;

    CASE p_action
      WHEN 'send' THEN
        IF v_proposal.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Archived proposals cannot be sent' USING ERRCODE = '55000';
        END IF;
        IF v_proposal.status != 'draft' THEN
          RAISE EXCEPTION 'Only draft proposals can be sent (current: %)', v_proposal.status
            USING ERRCODE = '55000';
        END IF;
        IF NOW() >= v_proposal.valid_until THEN
          RAISE EXCEPTION 'Cannot send proposal with past validity date' USING ERRCODE = '55000';
        END IF;

        UPDATE public.proposals
           SET status     = 'sent',
               sent_at    = NOW(),
               updated_at = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      WHEN 'draft' THEN
        IF v_proposal.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Archived proposals cannot be converted to draft' USING ERRCODE = '55000';
        END IF;
        IF v_proposal.status NOT IN ('sent', 'rejected', 'expired') THEN
          RAISE EXCEPTION 'Cannot revert proposal with status "%" back to draft', v_proposal.status
            USING ERRCODE = '55000';
        END IF;

        UPDATE public.proposals
           SET status           = 'draft',
               sent_at          = NULL,
               accepted_at      = NULL,
               rejected_at      = NULL,
               rejection_reason = NULL,
               updated_at       = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      WHEN 'accept' THEN
        IF v_proposal.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Archived proposals cannot be accepted' USING ERRCODE = '55000';
        END IF;
        IF v_proposal.status != 'sent' THEN
          RAISE EXCEPTION 'Only sent proposals can be accepted (current: %)', v_proposal.status
            USING ERRCODE = '55000';
        END IF;

        UPDATE public.proposals
           SET status      = 'accepted',
               accepted_at = NOW(),
               updated_at  = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      WHEN 'reject' THEN
        IF v_proposal.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Archived proposals cannot be rejected' USING ERRCODE = '55000';
        END IF;
        IF v_proposal.status != 'sent' THEN
          RAISE EXCEPTION 'Only sent proposals can be rejected (current: %)', v_proposal.status
            USING ERRCODE = '55000';
        END IF;
        IF btrim(p_reason) IS NULL OR char_length(btrim(p_reason)) = 0 THEN
          RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
        END IF;

        UPDATE public.proposals
           SET status           = 'rejected',
               rejected_at      = NOW(),
               rejection_reason = btrim(p_reason),
               updated_at       = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      WHEN 'expire' THEN
        IF v_proposal.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Archived proposals cannot be expired' USING ERRCODE = '55000';
        END IF;
        IF v_proposal.status != 'sent' THEN
          RAISE EXCEPTION 'Only sent proposals can expire (current: %)', v_proposal.status
            USING ERRCODE = '55000';
        END IF;

        UPDATE public.proposals
           SET status     = 'expired',
               updated_at = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      WHEN 'archive' THEN
        IF v_proposal.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Proposal is already archived' USING ERRCODE = '55000';
        END IF;

        UPDATE public.proposals
           SET archived_at = NOW(),
               archived_by = v_caller_id,
               updated_at  = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      WHEN 'restore' THEN
        IF v_proposal.archived_at IS NULL THEN
          RAISE EXCEPTION 'Proposal is not archived' USING ERRCODE = '55000';
        END IF;

        UPDATE public.proposals
           SET archived_at = NULL,
               archived_by = NULL,
               updated_at  = NOW()
         WHERE id = p_proposal_id
        RETURNING * INTO v_updated;

      ELSE
        RAISE EXCEPTION 'Unrecognized staff transition action "%"', p_action
          USING ERRCODE = '22023';
    END CASE;
  END IF;

  -- Append audit history log with full JSONB row snapshot
  INSERT INTO public.proposal_history (
    proposal_id,
    from_status,
    to_status,
    action,
    rejection_reason,
    actor_id,
    actor_email,
    actor_type,
    metadata,
    snapshot
  ) VALUES (
    v_updated.id,
    v_proposal.status,
    v_updated.status,
    p_action,
    v_updated.rejection_reason,
    v_caller_id,
    v_caller_email,
    v_actor_type,
    COALESCE(p_metadata, '{}'::jsonb),
    to_jsonb(v_updated)
  );

  RETURN to_jsonb(v_updated);
END;
$$;

ALTER FUNCTION public.execute_proposal_transition(UUID, TEXT, TEXT, JSONB) OWNER TO postgres;

-- ============================================================================
-- 9. AUDIT & TIMELINE QUERY RPCS (SECURITY DEFINER)
-- ============================================================================

-- RPC: Get client-sanitized proposal timeline
-- Excludes internal notes, full snapshots, and staff-only metadata
CREATE OR REPLACE FUNCTION public.get_client_proposal_timeline(
  p_proposal_id UUID
)
RETURNS TABLE (
  id               UUID,
  proposal_id      UUID,
  from_status      TEXT,
  to_status        TEXT,
  action           TEXT,
  rejection_reason TEXT,
  actor_type       TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_caller_id     UUID;
  v_is_client     BOOLEAN;
  v_client_acc_id UUID;
  v_proposal_acc  UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Get proposal account
  SELECT p.account_id INTO v_proposal_acc
    FROM public.proposals p
   WHERE p.id = p_proposal_id
     AND p.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal % not found or inaccessible', p_proposal_id USING ERRCODE = 'P0002';
  END IF;

  -- Check caller authorization
  SELECT is_client, client_account_id
    INTO v_is_client, v_client_acc_id
    FROM public.user_profiles
   WHERE id = v_caller_id;

  IF COALESCE(v_is_client, FALSE) THEN
    -- Client must strictly belong to the proposal's account
    IF v_client_acc_id IS NULL OR v_client_acc_id != v_proposal_acc THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Staff caller must have view access
    IF NOT public._user_can_view_account_proposals_internal(v_caller_id, v_proposal_acc) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Return sanitized timeline (excludes create/update internal drafts if client)
  RETURN QUERY
  SELECT
    h.id,
    h.proposal_id,
    h.from_status,
    h.to_status,
    h.action,
    h.rejection_reason,
    h.actor_type,
    h.created_at
  FROM public.proposal_history h
  WHERE h.proposal_id = p_proposal_id
    AND (
      -- If caller is staff, return all actions
      COALESCE(v_is_client, FALSE) = FALSE
      -- If caller is client, only expose milestone transitions (send, accept, reject, expire)
      OR h.action IN ('send', 'accept', 'reject', 'expire')
    )
  ORDER BY h.created_at ASC;
END;
$$;

ALTER FUNCTION public.get_client_proposal_timeline(UUID) OWNER TO postgres;

-- RPC: Get full staff proposal audit history
CREATE OR REPLACE FUNCTION public.get_staff_proposal_audit_history(
  p_proposal_id UUID
)
RETURNS TABLE (
  id               UUID,
  proposal_id      UUID,
  from_status      TEXT,
  to_status        TEXT,
  action           TEXT,
  rejection_reason TEXT,
  actor_id         UUID,
  actor_email      TEXT,
  actor_type       TEXT,
  metadata         JSONB,
  snapshot         JSONB,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_caller_id    UUID;
  v_proposal_acc UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT p.account_id INTO v_proposal_acc
    FROM public.proposals p
   WHERE p.id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT public._user_can_manage_account_proposals_internal(v_caller_id, v_proposal_acc) THEN
    RAISE EXCEPTION 'Access denied to audit history for proposal %', p_proposal_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    h.id,
    h.proposal_id,
    h.from_status,
    h.to_status,
    h.action,
    h.rejection_reason,
    h.actor_id,
    h.actor_email,
    h.actor_type,
    h.metadata,
    h.snapshot,
    h.created_at
  FROM public.proposal_history h
  WHERE h.proposal_id = p_proposal_id
  ORDER BY h.created_at ASC;
END;
$$;

ALTER FUNCTION public.get_staff_proposal_audit_history(UUID) OWNER TO postgres;

-- ============================================================================
-- 10. FUNCTION PRIVILEGE LOCKDOWN & LEAST-PRIVILEGE GRANTS
-- ============================================================================

-- Explicitly revoke EXECUTE from PUBLIC and anon on ALL helper and RPC functions
REVOKE ALL ON FUNCTION public._user_can_view_account_proposals_internal(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._user_can_manage_account_proposals_internal(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_can_view_account_proposals(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_can_manage_account_proposals(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_draft_proposal(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_draft_proposal(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_proposal_transition(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_client_proposal_timeline(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_staff_proposal_audit_history(UUID) FROM PUBLIC, anon, authenticated;

-- Grant EXECUTE to authenticated users and service_role (functions enforce internal auth)
GRANT EXECUTE ON FUNCTION public.user_can_view_account_proposals(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_manage_account_proposals(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_draft_proposal(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_draft_proposal(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_proposal_transition(UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_client_proposal_timeline(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_proposal_audit_history(UUID) TO authenticated, service_role;

-- Grant SELECT on client_proposals view to authenticated and service_role
GRANT SELECT ON public.client_proposals TO authenticated, service_role;
