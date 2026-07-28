# Backlog: pattern-detector fired-cluster ledger (G-d)

**Status:** Backlog (logged 2026-07-28, G ruling d). Not now.

## Why
The incident near-dupe survey (INC brief-quality G) found one threat cluster generating **37 near-identical incidents over ~4 weeks** ("[PATTERN] Threat type cluster 3 violence signals": 32 collapsed; cluster 7: 29; cluster 9: 19). This means the pattern detector (`threat-cluster-detector` / `detect-threat-patterns`) **has no memory of clusters it has already materialized** — it re-fires the same cluster into a new incident every run.

The G(c) seam-guard trigger **masks** this (it collapses the re-fires into one incident), but the detector is still doing redundant work and would flood any new consumer that reads its raw output.

## Fix
Give the detector a **fired-cluster ledger**: a small table (`cluster_id`/cluster-signature → last_fired_at → incident_id) it checks before creating a cluster incident. If the cluster already fired and its incident is still open, update that incident (or skip) instead of creating a new one. The detector owns the dedup decision; the DB trigger stays as the backstop.

## Related
- G(c) seam guard: `supabase/migrations/20260728050000_incident_dedup_seam_guard.sql` (the backstop this makes redundant for PATTERN incidents).
- G(b) one-time merge of the 114 existing dupes.
