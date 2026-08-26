# venue_security archetype — risk-category SPINE (authoring template for BC Place)

Same structure/depth as PECL's 6 (`client_risk_categories`). WEIGHTS are archetype defaults; the `any:[…]`
anchor lists are the **per-client override** BC Place authors. `assessable` marks whether the matcher has a
LIVE evidence binding today (mirrors PECL's `geo_proximity: assessable:false`). Shape only — no build.

## The five venue-distinctive categories

### 1. event_crowd_threat  · weight 0.90 · critical · include · event
```json
{ "any_of": [
    { "type":"keyword",        "any":["BC Place","BC Place Stadium","<current event names>","<home teams>"], "assessable": true },
    { "type":"named_place",    "any":["BC Place","Terry Fox Plaza","downtown Vancouver"],                     "assessable": true },
    { "type":"event_calendar", "to":"event_day_window",                                                        "assessable": false }
  ],
  "require_signal_category": ["active_threat","physical_threat","weapon","bomb_threat","suspicious_package","active_shooter"] }
```
Threat legs wired; the **event-day-window binding is assessable:false — no event-calendar source exists** (collection inventory: event calendars NOT BUILT). Without it, a threat is scored the same on a dark day as during a 54,000-seat event.

### 2. named_event_or_performer_threat · weight 0.80 · high · include · event
```json
{ "any_of": [
    { "type":"keyword", "any":["<current performers>","<visiting teams>","<event brands>"], "assessable": true },
    { "type":"entity",  "to":"event_entity",                                                "assessable": false }
  ],
  "require_signal_category": ["threat","harassment","active_threat","protest"] }
```
Keyword leg wired (BC Place's live re-attribution already fired on "Vancouver Whitecaps"). Entity-graph leg **assessable:false — entity-anchoring not wired to admission** (keyword-only gate). Anchors need per-event refresh.

### 3. protest_at_venue · weight 0.75 · high · include · campaign
```json
{ "any_of": [
    { "type":"keyword",     "any":["BC Place","<venue/event names>"],                 "assessable": true },
    { "type":"named_place", "any":["BC Place","Terry Fox Plaza","downtown Vancouver"], "assessable": true }
  ],
  "require_signal_category": ["protest","activism","civil_disorder","social_sentiment"] }
```
**Fully wired** (keyword + named_place both live).

### 4. transit_ingress_disruption · weight 0.55 · medium · include · event
```json
{ "any_of": [
    { "type":"named_place",  "any":["Stadium-Chinatown Station","Main Street-Science World","Expo Line","Georgia Viaduct","Pacific Boulevard"], "assessable": true },
    { "type":"transit_feed", "to":"ingress_route",   "assessable": false },
    { "type":"geo_proximity","to":"venue_catchment", "assessable": false }
  ],
  "require_signal_category": ["civil_emergency","operational","natural_disaster","active_threat"] }
```
Named transit-hub strings wired; **transit_feed assessable:false (no transit source — NOT BUILT)** and geo_proximity assessable:false (geo admission not wired). A venue's ingress/egress axis is mostly unwired.

### 5. severe_weather_event_impact · weight 0.50 · medium · include · event
```json
{ "any_of": [
    { "type":"named_place",  "any":["Vancouver","Metro Vancouver","BC Place"], "assessable": true },
    { "type":"geo_proximity","to":"venue_point",                                "assessable": false }
  ],
  "require_signal_category": ["weather","natural_disaster","civil_emergency"] }
```
Weather signals exist (NAAD/CAP). named_place wired; tight-buffer proximity assessable:false. **True relevance depends on the event_calendar binding** (weather matters only on an event day) — which is assessable:false.

## Two carry-overs from the shared pattern (parallel PECL's credential + flaring_exclusion)
- **credential_exposure_venue** · 0.95 · critical · include: `keyword any:["bcplace.com","bcpavco.com"]` × cyber require_signal_category. **assessable:true — wired** (HIBP/darkweb live).
- **routine_event_ops_exclusion** · 0.20 · exclude · `polarity:"exclude"`, `keyword any:["ticketing","concourse","turnstile","concession"]`, `override_if:{any:["evacuation","stampede","crush","breach"]}`, `on_override:"escalate"`, `exclude_floor:0.15`. **assessable:true — wired**.

## Wired vs waiting (the honest read)
- **WIRED today (assessable:true):** protest_at_venue (full), credential_exposure, routine_ops_exclusion, and the keyword/named_place legs of event_crowd / performer / transit / weather. The **threat-DETECTION** half of the spine is live.
- **WAITING on evidence bindings (assessable:false):**
  - **event_calendar** — the venue's #1 relevance axis ("is there an event on, who's performing"). **No source exists (NOT BUILT).** Gates event_crowd_threat's day-window and severe_weather's real relevance.
  - **transit_feed** — ingress/egress disruption. **No source (NOT BUILT).**
  - **geo_proximity** — tight-buffer venue proximity (the geo work; and per the geo finding, a downtown venue is a *weak* proximity axis anyway).
  - **entity** — performer/event entity matching (entity-anchoring not wired).
- **Finding:** the venue spine's **threat detection is wired, but its two DEFINING relevance axes — event-day context and transit — have no evidence source at all.** A venue is fundamentally an event-and-crowd risk model, and exactly that part is `assessable:false`. Authoring BC Place's anchors makes protest/credential/named-threat live now; event_crowd and transit stay partial until an event-calendar and a transit source exist.
