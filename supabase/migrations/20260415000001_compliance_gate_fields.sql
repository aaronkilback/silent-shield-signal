-- Add data retention date and secure notes to investigation_compliance
ALTER TABLE investigation_compliance
  ADD COLUMN IF NOT EXISTS data_retention_date date,
  ADD COLUMN IF NOT EXISTS secure_notes text;
