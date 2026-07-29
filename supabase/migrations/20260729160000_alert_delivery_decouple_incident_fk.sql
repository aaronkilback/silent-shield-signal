-- INC-ALERT-DELIVERY remediation (ruling 2026-07-29): decouple recipient resolution from the
-- incident FK. Alert carries its own client_id (set at emit); claim/verify against
-- client_alert_recipients directly. Full RPC body + column applied via MCP
-- (alert_delivery_decouple_incident_fk). Applied prod+staging 2026-07-29.
alter table public.alerts add column if not exists client_id uuid;
create index if not exists idx_alerts_pending_delivery on public.alerts (status, channel) where status = 'pending';
-- claim_pending_email_alerts rewritten: WHERE clause uses a2.client_id (not incident join):
--   a2.client_id IS NOT NULL AND EXISTS(client_alert_recipients r WHERE r.client_id=a2.client_id
--   AND r.active AND r.verified_at IS NOT NULL AND lower(r.email)=lower(a2.recipient))
