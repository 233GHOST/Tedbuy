-- Append-only admin audit trail. Exact SQL from .ai/handoffs/ADMIN_AUDIT_LOGS_IMPLEMENTATION_REVIEW.md
-- (approved 2026-09-18), §1-§3. Written only by server.ts recordAdminAudit() with the service-role key.
-- Rollback: DROP TABLE IF EXISTS public.admin_audit_logs; (every writer tolerates the table's absence).

CREATE TABLE public.admin_audit_logs (
  id                 TEXT PRIMARY KEY,
  action             TEXT NOT NULL,
  result             TEXT NOT NULL DEFAULT 'success',
  actor_user_id      TEXT NOT NULL,
  actor_email        TEXT,
  target_user_id     TEXT,
  target_email       TEXT,
  target_product_id  TEXT,
  session_id         TEXT,
  error_message      TEXT,
  ip_address         TEXT,
  user_agent         TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_result_check
  CHECK (result IN ('success', 'failure'));

ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_action_check
  CHECK (action IN (
    'impersonate_start',
    'impersonate_exit',
    'impersonate_expired',
    'security_hold_apply',
    'security_hold_release',
    'user_suspend',
    'user_unsuspend',
    'user_delete',
    'boost_admin_activate',
    'boost_admin_deactivate',
    'retention_purge_run'
  ));

COMMENT ON TABLE public.admin_audit_logs IS
  'Append-only security audit trail for 8 defined admin action types
   (see ADMIN_AUDIT_LOGS_SCHEMA_PROPOSAL.md). Application code must never
   UPDATE or DELETE a row here. Not a general-purpose logging table --
   do not add a 9th action type without a deliberate, separate decision.';

CREATE INDEX admin_audit_logs_actor_idx   ON public.admin_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX admin_audit_logs_target_idx  ON public.admin_audit_logs (target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);

-- RLS on with zero policies, like every other public table: only the service role reaches it.
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
