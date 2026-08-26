# WO-AEGIS-PRICING-CANONICAL-TIERS — align AEGIS pricing to the 7 canonical tiers

**Status:** ✅ SHIPPED 2026-08-03 (payment-links approach, operator ruling). AEGIS pricing rewritten to the 7 canonical tiers using the LIVE Stripe payment links (byte-identical to protection.silentshieldsecurity.com, verified). `create-checkout` is **no longer invoked** by the marketing funnel (AegisChat + SnapshotResult) — it is now **UNUSED in `pwnzw`; review before any future use.** Deployed to the apex (CF Pages `2c385ba6`, commit `2b416e3`); build clean (1801 modules); live-verified: counter 0, old tiers 0, create-checkout 0, 6 links present, Sovereign→phone. The original two-Stripe-surface plan below is SUPERSEDED — one surface (payment links), one source of truth.

## ⚠ ATTRIBUTION GAP (report — scope only): conversation→payment link is broken
Dropping `create-checkout` means **no `orders` row is written on purchase** and the Stripe payment (via `buy.stripe.com` link) carries **no reference back to the `aegis_conversations` record**.

**What AEGIS captures into `aegis_conversations` at handoff today (preserved):** the full conversation log + name/email/phone; `saveConversation("payment_initiated", formData)` stamps a status marker + the form data (name/email/phone/address/notes); `send-notification(qualified_lead)` emails the operator with the product/tier + captured fields. So **intent** (who was offered which tier, with contact + conversation) is captured. **What's LOST:** the hard link to the *completed payment* — the `orders` row, `stripe_session_id`, and the CRM funnel "Customer" stage no longer auto-populate from Stripe.

**Cheapest ways to restore conversation→payment attribution (pick one, scope only):**
1. **`client_reference_id` on the payment link (recommended, cheapest robust).** Append `?client_reference_id=<aegis_conversation_id>` (and `?prefilled_email=`) when AEGIS opens the link. Stripe carries it into the Checkout Session + webhook. A small webhook (or extend the protection page's existing Stripe verification) records `session.client_reference_id → conversation` and marks it paid. ~1 line client-side + a lightweight webhook. Ties the ACTUAL payment.
2. **Log the handoff event (intent only).** Extend `saveConversation` to write `handoff_tier` + `handoff_at` + the link clicked onto the `aegis_conversations` row. Trivial, but confirms *intent*, not *purchase* (no payment signal without a webhook).
3. **Both** — client_reference_id (payment truth) + handoff log (funnel intent) = full fidelity.

Recommendation: **#1** (client_reference_id) restores the payment link cheaply while keeping one Stripe surface; add #2 if the CRM funnel needs the intent stage. Neither built.

---

## (SUPERSEDED) original two-surface plan
Kept for history. The ruling chose payment links, not create-checkout.

## Why both sides move together
`AegisChat.tsx` invokes `create-checkout` with **`product_key: selectedProduct`**. `create-checkout` (in the marketing project `pwnzwxfzjkjsbfwtfyip`) maps that key → a Stripe **price ID** server-side. So:
- Changing the client `PRODUCTS` **keys** without updating `create-checkout` → checkout breaks (unknown key).
- Changing only the client **display price** → quote-vs-charge mismatch.
Therefore: client `PRODUCTS` and the `create-checkout` key→price map are ONE change.

## Current (wrong) state — `AegisChat.tsx:63`
4 old tiers: `risk_snapshot $3,500`, `watchtower $7,500`, `garrison $12,500`, `citadel $25,000`. Greetings (`:44/:51`) hardcode "Vulnerability Snapshot ($3,500 USD)". `ClientCommandCenter.tsx` uses old CRM funnel labels (Intel Brief / Booked Risk Briefing / Watchtower+). `HomeSections.tsx:128` shows "$3,500".

## Proposed client `PRODUCTS` (7 canonical tiers) — for review
```ts
const PRODUCTS = {
  fortified_16:          { key:"fortified_16",          name:"The Fortified 16",        price:500,   mode:"payment"      as const, isPaid:true },
  digital_exposure_report:{ key:"digital_exposure_report",name:"Digital Exposure Report",price:1000,  mode:"payment"      as const, isPaid:true },
  vulnerability_snapshot:{ key:"vulnerability_snapshot", name:"Vulnerability Snapshot",   price:10000, mode:"payment"      as const, isPaid:true },
  sentinel:              { key:"sentinel",               name:"Sentinel",                price:7500,  mode:"subscription" as const, isPaid:true },
  command:               { key:"command",                name:"Command",                 price:12500, mode:"subscription" as const, isPaid:true },
  blackshield:           { key:"blackshield",            name:"Blackshield",             price:25000, mode:"subscription" as const, isPaid:true },
  // Sovereign Protocol: NO checkout path. Client shows a "By invitation" CTA that routes to contact,
  // never calls create-checkout. Do NOT add it to PRODUCTS-with-checkout.
};
```
Plus: fix greetings `:44/:51` to stop quoting "$3,500"; fix `HomeSections.tsx:128`; remove old CRM labels in `ClientCommandCenter.tsx` (Intel Brief / Booked Risk Briefing / Watchtower+). Update tier-name matcher `AegisChat.tsx:252-254` (watchtower/garrison/citadel → sentinel/command/blackshield).

## What `create-checkout` (pwnzw) must change — VERIFY the price IDs
Its `product_key → Stripe price` switch must become (price IDs are Stripe `price_…`, NOT the `buy.stripe.com` payment links on the protection page — those are a separate integration; the operator/Stripe must supply the Checkout price IDs, or I read them once I have pwnzw access):

| product_key | amount | interval | Stripe price ID (VERIFY / fill) |
|---|---|---|---|
| `fortified_16` | $500 | one-time | `price_…` |
| `digital_exposure_report` | $1,000 | one-time | `price_…` |
| `vulnerability_snapshot` | $10,000 | one-time | `price_…` |
| `sentinel` | $7,500 | month | `price_…` |
| `command` | $12,500 | month | `price_…` |
| `blackshield` | $25,000 | month | `price_…` |
| `sovereign_protocol` | — | — | **no checkout — reject / not offered** |

`create-checkout` should also **reject any unknown or `sovereign_protocol` key** (fail closed) rather than default to a price. If it currently trusts a client-supplied price/amount, switch it to server-side price IDs only (never trust the client amount).

## Ship order (once verified)
1. Operator confirms the 6 Stripe price IDs above.
2. Update `create-checkout` (pwnzw) first, deploy, test each key → correct Stripe session amount.
3. Then ship the client `PRODUCTS` + string fixes (apex push).
Neither side ships before the mapping is verified.
