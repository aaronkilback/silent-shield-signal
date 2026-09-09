# WO-WILDFIRE-IGNITION-TIER — lightning-ignition risk should not borrow general severity

**Status:** LOGGED (scope only, do not build). **Opened:** 2026-09-01.

TIER2-REVIEW correctly identifies "severe thunderstorm + Very-High/Extreme Fire Weather Index" as elevated
lightning-ignition risk — the reasoning is sound and matches the platform's own wildfire lightning-correlation
logic. But promoting every such NAAD alert to **`high` on the general severity scale** means, during BC fire
season, a large fraction of weather alerts become "high" and the tier stops discriminating (82 such promotions
in one 5-day window — see WO-PROPOSAL-QUEUE-AGING).

**Question to scope (do NOT build):** should lightning-ignition risk have its **own tier or flag** —
e.g. a `wildfire_ignition_watch` dimension, or a distinct fire-weather risk score — rather than borrowing the
general `severity` band that pages/dashboards/briefings key on? A dedicated signal preserves the (correct)
analysis while keeping `high` meaningful for cross-domain triage. Consider: who consumes it, whether it should
page, and whether it decays with the weather window (a thunderstorm warning is hours-long, not days).
