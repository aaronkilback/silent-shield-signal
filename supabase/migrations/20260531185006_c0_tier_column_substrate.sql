-- C-0: Tier column substrate per Protect-Attention doctrine
-- Reference: docs/platform-operations/four-tier-classification-design-2026-05-31.md (Task #143)
-- Pre-flight: docs/platform-operations/c0-tier-column-pre-flight-2026-05-31.md (Task #144)
-- Doctrine: feedback_protect_attention_like_critical_infrastructure
--
-- Effect: adds `tier text` column with CHECK constraint to three operator-surface
-- tables. Default 'log' for alerts (most conservative; 13,868 backlog becomes
-- LOG-tier — no row gains push semantics from this migration). Default 'finding'
-- for platform_findings + agent_pending_messages (these tables ARE operator-pull
-- queues by design).
--
-- BEHAVIORAL CHANGE: ZERO. No writer changes. No egress changes. Pure substrate.
--
-- C-1 (separate, future) will update writers to set the correct tier at write time.
-- C-2 (separate, future) will update egress (alert-delivery-secure) to gate on tier.

BEGIN;

-- §A — alerts.tier
ALTER TABLE public.alerts
  ADD COLUMN tier text NOT NULL DEFAULT 'log';

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_tier_check
  CHECK (tier IN ('log', 'finding', 'notification', 'interruption'));

COMMENT ON COLUMN public.alerts.tier IS
  'C-0 (2026-05-31) — alert tier per Protect-Attention doctrine. '
  'log=no push, finding=operator-pull, notification=Slack/Teams, interruption=Teams+Slack+SMS+oncall. '
  'Default ''log'' = no row gains push semantics from this migration alone.';

-- §B — platform_findings.tier
ALTER TABLE public.platform_findings
  ADD COLUMN tier text NOT NULL DEFAULT 'finding';

ALTER TABLE public.platform_findings
  ADD CONSTRAINT platform_findings_tier_check
  CHECK (tier IN ('log', 'finding', 'notification', 'interruption'));

COMMENT ON COLUMN public.platform_findings.tier IS
  'C-0 (2026-05-31) — finding tier per Protect-Attention doctrine. '
  'Default ''finding'' because platform_findings is by design an operator-pull queue '
  '(Neural Constellation UI); rows that should not surface to operator can be downgraded to ''log''.';

-- §C — agent_pending_messages.tier
ALTER TABLE public.agent_pending_messages
  ADD COLUMN tier text NOT NULL DEFAULT 'finding';

ALTER TABLE public.agent_pending_messages
  ADD CONSTRAINT agent_pending_messages_tier_check
  CHECK (tier IN ('log', 'finding', 'notification', 'interruption'));

COMMENT ON COLUMN public.agent_pending_messages.tier IS
  'C-0 (2026-05-31) — chat-push tier per Protect-Attention doctrine. '
  'Default ''finding'' (chat surface is operator-pull). '
  'C-1+ will set ''notification'' for items that should ping the chat panel actively.';

COMMIT;
