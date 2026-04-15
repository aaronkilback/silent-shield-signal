CREATE TABLE IF NOT EXISTS client_authorizations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_id       UUID REFERENCES investigation_compliance(id) ON DELETE CASCADE,
  scan_type           TEXT NOT NULL,
  target_name         TEXT NOT NULL,
  scope_summary       TEXT,
  data_retention_date DATE,
  client_name         TEXT NOT NULL,
  client_email        TEXT NOT NULL,
  token               TEXT UNIQUE NOT NULL,
  token_expires_at    TIMESTAMPTZ NOT NULL,
  otp_code            TEXT NOT NULL,
  otp_expires_at      TIMESTAMPTZ NOT NULL,
  otp_attempts        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | authorized | expired
  authorized_at       TIMESTAMPTZ,
  ip_address          TEXT,
  user_agent          TEXT,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE client_authorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage client_authorizations"
ON client_authorizations FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on client_authorizations"
ON client_authorizations FOR ALL TO service_role
USING (true) WITH CHECK (true);
