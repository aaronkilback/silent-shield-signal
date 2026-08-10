# WO-PRINCIPAL-LOCATION-TRACKING — position paper (SCOPE ONLY, do not build)

**Model (operator, 2026-08-10): PULL-ON-DEMAND, not continuous.** AEGIS requests a location at a triggering event; the principal chooses whether to answer. **No standing location store, no movement history.** A response is a point-in-time answer, never a track. This is a materially different legal/ethical category from continuous tracking — and the whole design must keep it that way (see §4: the moment responses accumulate, we have rebuilt continuous tracking by accident).

---

## §3 FIRST — THE PHISHING PROBLEM (the operator wants this answer before anything else)

**The hazard:** an unsolicited text asking "where are you? tap here" is *exactly* the smishing pattern we teach principals to distrust. Shipping it naively does two unacceptable things: (a) it **trains our own principals to click location-request links**, degrading the security posture we sell; and (b) it is **indistinguishable from an attacker** spoofing Fortress during the exact emergency when an attacker would most want a target's position.

**The answer — it ships ONLY if all of the following hold; otherwise it does not ship:**

1. **INVERT THE INITIATION. The location request is embedded in an evacuation ALERT the principal already subscribed to — never a standalone "where are you?" text.** The principal is not cold-contacted; they receive the hazard alert they opted into (an evac order near their property), and *within that alert* is an option to share location. They **act first, in response to an expected, self-verifying event** — the opposite of the phishing pattern (responding to an unsolicited demand). This single design choice does most of the work.
2. **Known sender, saved at onboarding.** The message comes from the same Twilio number already used for critical alerts, which the principal saved as a Fortress contact during onboarding. An unknown-number location request is, by protocol, to be ignored.
3. **A pre-shared verification element (codeword).** At onboarding each principal is given a codeword known only to them and Fortress. Every location-request message carries it. Real Fortress messages have the codeword; an attacker's do not. The principal is taught: *no codeword → it's not us → ignore.*
4. **A specific, independently-verifiable reason.** The message names the actual event ("Evacuation ORDER issued for [area] near your Kaleden property, [agency], [time]") — a real, public BCWS order the principal can confirm on the official BCWS site out-of-band. Generic phishing cannot supply a real, checkable event tied to their property.
5. **Out-of-band confirmation is always offered and encouraged.** "To verify, call us at [known number]." The protocol tells principals to verify before responding if in any doubt.
6. **No credential/PII surface.** The consent + capture is the **browser's own OS-level geolocation permission prompt** (native UI), not a Fortress form. There is nothing to "fill in," so there is no data-entry phishing surface. The link resolves only to a Fortress-controlled HTTPS domain (`fortress.silentshieldsecurity.com/...`) the principal was told to expect.

**Conclusion:** the phishing problem is solvable, but ONLY under the *(inverted-initiation + known-number + codeword + verifiable-event + out-of-band-verify)* triangle, all mandatory. If we cannot guarantee the codeword and the known-number-saved onboarding and the event being real and independently verifiable, **the feature does not ship** — a standalone "where are you, click here" text is unshippable regardless of how useful the coordinates would be.

---

## §1 CHANNEL — plain SMS reply vs a short-lived geolocation page
Two options, both over the existing Twilio SMS channel:
- **(A) Plain SMS reply** — principal texts back a typed location/description. Pro: zero clicks, no link (sidesteps the click-training concern). Con: a *typed guess* ("at the cabin"), not coordinates; ambiguous; can't compute distance-to-fire.
- **(B) Link to a short-lived page that requests browser geolocation** — the page asks the browser's native permission prompt and returns real lat/lon. Pro: **the browser prompt is itself the consent moment** and yields real coordinates. Con: it is a link in an SMS (the click-training concern) — mitigated by the §3 triangle.

**Recommendation: (B), gated by §3.** The operator's lean is right — the browser permission prompt is a genuine consent artifact and real coordinates are operationally decisive (which side of an evacuation line are they on?). But (B) is shippable *only* with the full phishing answer; without it, fall back to (A) or don't ship. **Offer both**: the alert can say "reply with your location, or tap the verified link to share exact coordinates" — the principal picks their comfort level.

## §2 TRIGGER — always a visible reason, never routine
- **Default trigger:** an **evacuation ORDER or ALERT within R km of a client property** (the `client_geo_assets` proximity we just built). 
- **Never routine, never scheduled.** A location request with no visible hazard reason is indistinguishable from surveillance and from phishing. Every request states its triggering event.
- Rate-limited and deduplicated: one request per principal per active event, not per alert refresh.

## §4 RETENTION — a point-in-time answer, not a track
- A response is stored **only as long as the triggering event is active + a short tail** (proposed: purge ≤ 7 days after event closure). 
- **Responses MUST NOT accumulate into a per-principal history.** If they do, we have rebuilt continuous tracking by accident — the exact thing this model exists to avoid. No `location_history` table; a response is attached to the event, not to a standing principal record, and is purged with the event.
- **State it as a hard invariant:** "no query, view, or export may reconstruct a principal's movement over time." Enforce by schema (response rows keyed to event_id, hard-purged) + a guard that there is no cross-event location join.

## §5 CONSENT + ACCESS
- **Per-principal, explicit, opt-in at onboarding, revocable at any time.** On revocation: no further requests are sent to that principal, and any retained responses are purged immediately (not just flagged).
- **Subject vs consenter (§ from the original scope):** each *person* consents for themselves. A client (e.g., a household principal) may enroll their own household, but **each adult consents individually**; minors are handled under the parent/guardian with a named guardian consenter recorded. Staff of a corporate client consent individually — the client cannot consent on a staffer's behalf.
- **Access inside Fortress:** a principal's response is visible only to the operator/analyst actively handling that principal's active event, for the event's duration, then purged. Logged access (who viewed, when).
- **Can the AI (me) see it?** Default **no** — a principal's live position is L3 operator/forensic-class data (Aegis grounding doctrine); the tenant-facing agent must not surface or reason over a principal's live coordinates unless explicitly and narrowly wired with the same consent + purge guarantees. Absent that, the agent is blind to it.

## §6 LEGAL — BC PIPA
- **Point-in-time, consented collection is a materially lower bar than continuous tracking.** BC PIPA (Personal Information Protection Act) turns on: consent (explicit, informed, revocable — §5 ✓), purpose limitation (safety during a declared hazard, §2 ✓), retention minimization (§4 ✓), and reasonableness. Pull-on-demand-with-consent is defensible where continuous covert tracking would not be.
- **Purpose limitation must be explicit:** the location may be used ONLY to assess a principal's exposure during an active hazard and coordinate their safety. It may **never** be used for: routine whereabouts, staff management, marketing, sharing with third parties, or building a pattern-of-life. Write this into the consent text and enforce it.
- **Position on counsel:** pull-on-demand likely clears a bar continuous never would, **but this still collects sensitive PII (real-time location of identifiable people, including minors).** Recommendation: **written counsel review of THIS position paper before build** — specifically the consent text, the minor-consent path, the retention invariant, and the cross-border/storage location of responses. Cheaper and faster than counsel on a continuous model, but not skippable given minors + real-time location.

## Technical shape (for the eventual build — not now)
- Twilio SMS (existing critical-alert channel) delivers the alert + optional verified link.
- A short-lived, single-use page on the Fortress domain requests browser geolocation (native permission prompt), posts one coordinate back, then expires.
- No mobile app. No background/continuous capture. No standing location store.
- Response tied to `event_id`, hard-purged on event closure + tail.

**Deliverable = this position paper. No code. The phishing answer (§3) is the ship-gate; the retention invariant (§4) is the "did we accidentally rebuild continuous tracking" gate. Both must hold or it doesn't ship.**
