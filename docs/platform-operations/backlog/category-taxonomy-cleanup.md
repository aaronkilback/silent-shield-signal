# Backlog: signal category taxonomy cleanup (G-e)

**Status:** Backlog with **priority note** (logged 2026-07-28, G ruling e / H audit). No classifier changes without a ruling.

## ⚠️ Priority note — this is a liability control, not just hygiene
The executive-brief **flash guard** (brief-quality ruling B) restricts the flash + CRITICAL action items to categories `{operational, regulatory, active_threat, security}`. That category wall is only as strong as the categories themselves. The H audit found **`operational` is a catch-all** ("NHL Broadcasting Agreement", "BC Lions Transactions", "Premium Fares", "Home Care Services" all tagged operational). **A junk item mislabeled `operational` can pass the flash guard and reach the executive flash** — so cleaning `operational` protects a liability control, not just tidiness.

## Findings (H category sanity audit, 10-day sample)
- **`operational` (122)** — catch-all: real ("PetroChina LNG Canada stake") mixed with sports/airline/healthcare noise. **Weakens the flash guard.**
- **`social_sentiment` (41)** — junk bucket ("International Friendlies", "Cousin Discovery").
- **`active_threat` (88)** — polluted by `[PATTERN]` meta-observations (cluster/spike) that are not real threats.
- **wildfire split 4 ways** — `civil_emergency` (111) / `wildfire` (13) / `health_concern` / `environmental` classify the same event type inconsistently.
- **`activism` (6)** — mislabels partnership/support ("Ksi Lisims LNG support", "MNT Partnership") as activism — directly the C language failure at the classification layer.
- CVEs scattered across `cybersecurity` / `malware` / `vulnerability`.

## Fix (needs ruling before build)
Tighten the ingest classifier + taxonomy: split/retire the catch-alls (`operational`, `social_sentiment`, `general`), keep `[PATTERN]` meta out of `active_threat`, consolidate wildfire classification, and stop framing partnerships as activism. Re-validate the flash-guard category wall after.
