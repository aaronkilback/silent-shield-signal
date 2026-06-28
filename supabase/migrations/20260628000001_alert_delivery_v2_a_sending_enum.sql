-- Alert Delivery v2 (a): add the two new alert_status values.
-- Isolated in its own migration so the new enum values are committed before any later
-- migration or function references them (Postgres forbids using a new enum value in the
-- same transaction that added it).
ALTER TYPE public.alert_status ADD VALUE IF NOT EXISTS 'sending';
-- Terminal reconciliation state: a 'sending' alert whose lease expired AFTER the provider
-- idempotency window — prior provider outcome is unknown; must NEVER be auto-resent.
ALTER TYPE public.alert_status ADD VALUE IF NOT EXISTS 'requires_reconciliation';
