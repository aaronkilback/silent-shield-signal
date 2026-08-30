-- Device version tri-state (ratified 2026-08-30): distinguish "asked, could not tell us" from "not asked".
-- NULL version alone conflates them; only the first should produce a cannot-assess line.
--   version present               -> assessable: product+version -> NVD CPE -> CVE finding (measured)
--   version NULL, unknown = TRUE  -> asked, subject couldn't provide -> "Cannot assess — version required" REQUEST
--   version NULL, unknown = FALSE -> skipped / not asked -> produces NOTHING (no finding, no request)
alter table public.subject_devices
  add column if not exists version_unknown boolean not null default false;

comment on column public.subject_devices.version_unknown is
  'TRUE only when we ASKED and the subject could not provide the version -> a device with (version IS NULL AND version_unknown) emits a cannot-assess REQUEST, never a finding. version IS NULL AND NOT version_unknown = not asked/skipped -> emits nothing. A non-null version is assessable (CVE lookup). Never guess a version.';
