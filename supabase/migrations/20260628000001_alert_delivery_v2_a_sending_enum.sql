-- Alert Delivery v2 (a): add 'sending' to the alert_status enum.
-- Isolated in its own migration so the new enum value is committed before any later
-- migration or function references it (Postgres forbids using a new enum value in the
-- same transaction that added it).
ALTER TYPE public.alert_status ADD VALUE IF NOT EXISTS 'sending';
