# WO-SITE-SURFACE-MONITOR — watch the front door, not just the platform

**Opened:** 2026-08-22. **Do not work tonight** (operator ruling). Priority: high.

## Why
Fortress exhaustively watches its own internals — cron heartbeats, registry promises, anon-surface, ingest
funnel, RLS. **Nothing watches what a stranger actually touches.** In a single day, THREE public-facing
surfaces were found failing silently, each discovered only by manual inspection, none by any monitor:

1. **The published phone number** — two dead `778` numbers hardcoded across two repos; calls went nowhere.
2. **The contact forms** — every form on the site wrote a client-side anon insert to tables that do not exist
   on the target project (WO-MARKETING-SCHEMA-DRIFT); every submission failed with a generic toast, **zero
   ever stored**, no server-side signal.
3. **Five form components wired but unreachable** — Hero, MembershipTiers, ContentHub (and, effectively, the
   whole membership + newsletter surface) were coded, styled, and maintained but mounted on **no route** —
   tree-shaken out, invisible to visitors. The inverse of a broken link: a built feature that renders nowhere.

All three are the same class: **a public surface can be completely broken while every internal health check is
green.** The platform proves the door is shut; nothing proves the door *opens for the person who's supposed to
walk through it.*

## Requirement
A **scheduled probe that exercises each LIVE public surface end to end and alerts on failure** — the front-door
twin of the system-watchdog. Three probe types, matching the three failure modes above:

1. **Functional (form submit E2E).** Actually submit each live form's path and assert the intended effect —
   a row lands in `marketing_contact_submissions` with the right `source_page`. Not "the endpoint returns 200"
   — the *outcome*, measured (measurability-is-part-of-the-feature). Catches failure mode #2.
2. **Reachability (phone).** Assert the published number is live and routed (Twilio number active + voice
   routing configured; ideally a periodic test-call/verification). Catches failure mode #1.
3. **Presence / render (page + surface).** Fetch each live public route, assert it serves real assets (not the
   SPA fallback, not unstyled), and assert the key surfaces are actually present in the served bundle — the
   forms render, the phone number renders, primary CTAs resolve. Catches failure mode #3.
   > **Caveat (learned):** verify render by served-bundle/content assertions, NOT headless pixel screenshots —
   > this site has a known headless↔CDN artifact where byte-identical CSS renders unstyled in headless. Screens
   > lie here; content greps don't.

## Design notes (for when it's worked — not tonight)
- **Coverage is DATA, not code** (same shape as `security_anon_surface_allowlist`): a declared registry of live
  public surfaces — route + kind (form/phone/render) + assertion. A new public surface is added deliberately;
  an un-probed surface is itself a finding. This directly answers the orphan case: the registry says "there
  should be a reachable X," and the probe proves it renders.
- **Synthetic-submission hygiene.** The functional probe writes real rows and would fire a real operator SMS —
  it must run in a synthetic mode: a dedicated marker (synthetic `source_page` or flag) that **stores + self-
  cleans and does NOT page the operator**, or a test sink. A probe that spams the operator every N minutes is a
  worse defect than the one it catches (attention doctrine). Do not reuse the live SMS path for the canary.
- **Consequence-banded alerting.** Front-door failure (a form that stores nothing, a dead published number) is
  high-consequence and page-worthy; a slow render is not. Route through the existing alert path; band it.
- **Companion static check.** Failure mode #3 (built-but-unmounted) is best caught at build time too — a guard
  that flags a form/page component imported by no route. The scheduled probe catches the runtime half; the CI
  guard catches the wiring half before it ships. Consider both.
- **Registry-is-a-Promise, front-door edition.** An entry in the surface registry is a promise that a stranger
  can do X; the probe verifies the promise, exactly as `registry_phantom_check()` verifies cron promises.

## Provenance
Surfaced 2026-08-22 across the phone-swap, contact-form-rebuild, and orphan-deletion work. Three silent
public-surface failures in one day with zero monitor coverage is the motivating evidence. Fortress watches the
platform; this watches the front door.
