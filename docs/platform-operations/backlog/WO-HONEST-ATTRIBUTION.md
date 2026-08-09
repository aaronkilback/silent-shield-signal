# WO-HONEST-ATTRIBUTION — label what a signal/client IS, don't overload one field (SCOPE, do not build)

Two related gaps surfaced 2026-08-09 (PECL nexus + fixture demotion). Both are the same shape: **a distinction that exists in reality is collapsed into an undifferentiated field**, so a consumer can't tell two different things apart.

## 1. Signal attribution type — direct vs competitor vs sector (operator ruling 2026-08-09)
**Keep the coverage, fix the label.** Competitor monitoring is legitimate — a client should know when Shell has a protest at a comparable facility. The defect is that the **29 competitor-name signals/30d arrive indistinguishable from signals about PECL itself.** Same for broad-sector matches.

- **Scope:** a `signal_basis` / `attribution_type` on the signal (or the client-attribution edge), enumerated:
  - `direct` — about *this* client (name/asset/entity/named-location match)
  - `competitor` — about a named competitor of this client (`competitor_names` match)
  - `sector` — sector/region-relevant to this client but about someone else (the tier-2 / industry-anchor class)
- **Client-facing surfaces show the distinction** — a competitor/sector signal is presented as "relevant to you, about X," never as "about you." This is the **honest version** and is stronger than either keeping them unlabelled (false "your signal") or dropping them (loses legitimate coverage).
- **Where it's computable today:** the matcher already knows the basis at attribution time — `competitor:` prefix in `matched_keywords` → `competitor`; `tier2:`/industry-anchor → `sector`; client-name/asset/entity → `direct`. Forward-only stamp at write; the existing `matched_keywords` supports a backfill classification.
- **This is a PROVENANCE improvement** — it is exactly what Calvin's provenance lane asks for (why is this signal attributed to this client, and on what basis). Cross-ref [[project_source_provenance_model]] / WO-PROVENANCE-PARTITION-01: attribution_type is the *client-edge* provenance complement to the *source* provenance already modelled (`publisher_kind`/`provenance_path`). Fold into that lane rather than a bolt-on.

## 2. Client `is_internal` flag + `status='active'` overload (operator ruling 2026-08-09)
`__platform_security__` (the WRAITH security-findings sentinel) was correctly **held** from the fixture demotion because `wraith-security-advisor` looks it up with `.eq('status','active')` and skips security-signal emission if it's not active.

- **The conflation is its own small defect:** this client uses **`status='active'` as a functional ENABLEMENT flag** ("WRAITH may route to me"), **not as a lifecycle state** ("this is a live customer"). One column is doing two jobs, so an internal enablement row pollutes every "active customer" metric (it was part of the 9→ inflated count).
- **Scope:** an explicit **`is_internal`** (or `client_kind: customer | internal | fixture`) flag. Then:
  - customer-facing metrics / "active client" counts filter `is_internal = false` (→ the 3 real customers),
  - WRAITH keeps routing to `__platform_security__` on its own identity (by name/kind), **decoupled from `status`**,
  - fixtures get `client_kind='fixture'` instead of relying on `status='inactive'` to hide them.
- Retire the status-as-enablement pattern: `status` should mean lifecycle only.

## Sequencing
Both are honest-labeling/provenance work, not urgent stop-the-bleeding. Item 1 folds into Calvin's provenance lane (WO-PROVENANCE-PARTITION-01). Item 2 is small client-model hygiene. **Scope only — do not build.** Recorded 2026-08-09.
