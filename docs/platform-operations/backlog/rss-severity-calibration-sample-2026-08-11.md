# RSS Severity Calibration — operator grading sheet (2026-08-11)

**WO-RSS-SEVERITY-CALIBRATION-01.** Population: RSS/news-funnel signals (`raw_json ? 'source_metadata'`, 45-day window). This population is **~77% high/critical** vs a ~18% target — the biggest watchdog finding. Grade the **correct** severity for each; I then compute the confusion matrix (current → correct) and propose a recalibration. **Do not change the severity logic until this is graded** (operator ground truth first).

**50 items · estimated ~30–45 min** (one-line each). Under an hour, so not sampled down. If it runs long, stop — even 30 graded is enough to estimate per-bucket error.

---

## The grading standard — what "correct severity" means for an RSS signal

Severity = **how much of THIS client's attention this deserves, given actual threat to THIS client.** Not headline drama. Two rules govern every call:

1. **Threat-to-THIS-client, not topic alarm.** The `client` column is load-bearing. The *same* wildfire can be CRITICAL for a household in its path and LOW/MEDIUM for a company 700 km away. "State of emergency" is critical *somewhere* — the question is whether it threatens *this* client's people/assets/operations.
2. **Event vs discussion.** Something that *occurred and touches the client* outranks a statement / opinion / call-to-action / analysis. "Chiefs call to halt pipeline" is a statement (awareness); a protest physically blocking a client site is an event (act today).

| Level | Meaning | Test |
|---|---|---|
| **CRITICAL** | Act now / wake someone | Active, imminent, confirmed threat to THIS client's people/assets/ops needing immediate action. Evac **ORDER** over a client asset/household; active incident at a client site; credible imminent attack on named staff. "If we're wrong that it's urgent, someone could be harmed." |
| **HIGH** | Act today | A confirmed **event** that specifically/materially affects THIS client, or a direct near-term threat to its assets/ops/named staff, actionable ~24h. Protest at a client site; regulatory ruling against the client's *own* project; fire within proximity of a client asset (evac **ALERT**). |
| **MEDIUM** | Situational awareness | Relevant to the client's operating context but not direct/imminent. Sector/regional developments; an industry activist campaign not yet targeting this client; a fire in-province but far from any asset. Worth knowing, not worth interrupting. |
| **LOW** | Background / noise | Mentions a client keyword but no real client threat: general news, opinion with no event, out-of-region items, tangential topics, duplicates, sports/travel. |

**How to grade:** put L / M / H / C in each `→` blank (or reply "1C 2L 3M …"). Leave blank = "current is correct."

---

## A. Currently HIGH / CRITICAL (30) — the suspect class

1. `e97601ef` **[HIGH]** Petronas · stand.earth · environmental — Stand.earth's "Forest Eye" tool detects old-growth logging; communities send evidence. → ___
2. `456c9ee7` **[HIGH]** Petronas · thenarwhal · environmental — Residents' concerns re black-smoke emissions from LNG Canada, health impacts. → ___
3. `6ff7d66a` **[HIGH]** Kilbacks · citynews · civil_emergency — "Wildfires burning across western US and Canada," evacuations/concern (generic). → ___
4. `b5ef1ee9` **[HIGH]** Kilbacks · westernstandard · regulatory — Nova Scotia court: homeless person's tent = legal accommodation. → ___
5. `ccae7e18` **[HIGH]** Petronas · cbc.ca · civil_emergency — B.C. provincewide state of emergency, multiple wildfires. → ___
6. `0d3a2109` **[HIGH]** Petronas · energeticcity · regulatory — First Nations chiefs urge Ottawa/Alberta to halt West Coast pipeline. → ___
7. `a8b514d4` **[HIGH]** Petronas · vancouverisawesome · protest — Chiefs call on Carney/Smith to halt West Coast pipeline. → ___
8. `f65a1401` **[CRIT]** Kilbacks · energeticcity · civil_emergency — Massive BC wildfire, structure loss, 10,000 evacuations, state of emergency. → ___
9. `5801041b` **[HIGH]** Kilbacks · energeticcity · civil_emergency — Bald Range wildfire >100 km², thousands evacuate near Summerland. → ___
10. `f986c5b6` **[HIGH]** Petronas · vancouverisawesome · civil_emergency — Video of wildfire aftermath in Faulder, B.C. → ___
11. `48381c6e` **[HIGH]** Kilbacks · westernstandard · regulatory — Flood-insurance surcharge $350/yr for high-risk homeowners. → ___
12. `b41c1183` **[HIGH]** Kilbacks · globalnews · social_sentiment — B.C. murder-case acquittal over tainted evidence. → ___
13. `f888a6dd` **[CRIT]** Petronas · cbc.ca · civil_emergency — BC state of emergency, Bald Range fire near Summerland, mass evacuations. → ___
14. `bbbd0b8f` **[HIGH]** Petronas · westernstandard · regulatory — Debate on abolishing the Indian Act, development/Indigenous rights. → ___
15. `b99374c7` **[CRIT]** Petronas · globalnews · civil_emergency — Summerland wildfire, helicopter rescues of trapped people. → ___
16. `74a726f5` **[CRIT]** Petronas · vancouverisawesome · civil_emergency — Explosive wildfire near Summerland, possible death, state of emergency. → ___
17. `eef4a900` **[HIGH]** Kilbacks · globalnews · civil_emergency — Bald Range fire near Summerland, evacuations, livestock rescue. → ___
18. `55817741` **[HIGH]** Kilbacks · globalnews · civil_emergency — RCMP report possible fatality from Bald Range fire. → ___
19. `3817dff7` **[HIGH]** Petronas · thenorthernview · civil_emergency — Possible death from Bald Range wildfire under investigation. → ___
20. `075717a1` **[HIGH]** Petronas · vancouverisawesome · civil_emergency — RCMP possible fatality, wildfire near Summerland (Okanagan). → ___
21. `7889f94c` **[HIGH]** Petronas · terracestandard · civil_emergency — Possible death from Bald Range wildfire, coroner investigating. → ___
22. `7d4d28a5` **[CRIT]** Kilbacks · globalnews · civil_emergency — Bald Range fire, homes destroyed, people trapped by fast flames. → ___
23. `e4ae8be6` **[HIGH]** Petronas · energeticcity · civil_emergency — BC's most destructive wildfire seasons (historical/retrospective). → ___
24. `eaef91d9` **[CRIT]** Petronas · energeticcity · civil_emergency — State of emergency, 20,000 evacuate Summerland/Peachland. → ___
25. `6f731f98` **[CRIT]** Petronas · vancouverisawesome · civil_emergency — State of emergency, 20,000 evacuations along Okanagan Lake. → ___
26. `4f8beadd` **[CRIT]** Petronas · cbc.ca · civil_emergency — Province-wide state of emergency, tens of thousands displaced. → ___
27. `312c6eb8` **[CRIT]** Petronas · cbc.ca · civil_emergency — Premier declares province-wide emergency (dup of 26). → ___
28. `a938a645` **[HIGH]** Kilbacks · globalnews · civil_emergency — "Wildfires continue to force evacuations across B.C." (generic update). → ___
29. `b95bbdb7` **[CRIT]** Kilbacks · citynews · civil_emergency — Northern Okanagan (Bradley Creek) wildfire destroys homes, evacuations. → ___
30. `964bd7db` **[CRIT]** Kilbacks · cbc.ca · civil_emergency — All 12,000 Summerland residents ordered to evacuate, Bald Range fire, 20,000 affected. → ___

## B. Currently MEDIUM (12)

31. `348d1b7d` **[MED]** BC Place · dailyhive · operational — Whitecaps sign a new midfielder. → ___
32. `44abfbd4` **[MED]** Petronas · news.google · operational — West Coast pipeline project progresses. → ___
33. `80c42544` **[MED]** Kilbacks · dailyhive · operational — Overlooked free-agent fit for the Canucks. → ___
34. `85bd9178` **[MED]** Kilbacks · globalnews · civil_emergency — B.C. farmers defy evacuation orders to protect homes/livestock. → ___
35. `30420780` **[MED]** Kilbacks · yahoo · regulatory — Judge: homeless man's tent met accommodation requirements (dup of 4). → ___
36. `49e70d85` **[MED]** Kilbacks · vancouverisawesome · operational — Patrick Mahomes out after surgery. → ___
37. `11e43c37` **[MED]** Petronas · energeticcity · civil_emergency — Podcast on the Wildfire-Ready app, Peace-area prep. → ___
38. `99320e89` **[MED]** Kilbacks · globalnews · operational — Winnipeg police seize 600k illegal cigarettes. → ___
39. `c6b920b3` **[MED]** Kilbacks · cbc.ca · social_sentiment — John (Bull) Cook funeral, St. John's nightlife pioneer. → ___
40. `5b9fc190` **[MED]** Kilbacks · cbc.ca · regulatory — Defence minister announces quantum-tech hub. → ___
41. `f6e366a1` **[MED]** Petronas · westernstandard · social_sentiment — Stockwell Day criticizes Ottawa's wildfire climate narrative. → ___
42. `64bf9336` **[MED]** Kilbacks · vancouverislandfreedaily · operational — Taxonomy lab moving to Esquimalt (dup of 44/46). → ___

## C. Currently LOW (8)

43. `082a0c49` **[LOW]** BC Place · bclions.com · social_sentiment — BC Lions Wall of Fame induction. → ___
44. `cdb7f897` **[LOW]** Kilbacks · thenorthernview · operational — Taxonomy lab plans to relocate. → ___
45. `75d29189` **[LOW]** BC Place · dailyhive · operational — BC Lions free tickets for new fans. → ___
46. `35317ded` **[LOW]** Kilbacks · vancouverislandfreedaily · operational — Taxonomy lab relocating (dup). → ___
47. `cecaf188` **[LOW]** Kilbacks · globalnews · operational — Greater Toronto home-sales report. → ___
48. `834853d0` **[LOW]** BC Place · vancouverisawesome · social_sentiment — BC Place named a "global stadium star." → ___
49. `1f27ff53` **[LOW]** Kilbacks · globalnews · social_sentiment — Argonauts happy to return to BMO Field. → ___
50. `c7798f11` **[LOW]** BC Place · globalnews · operational — Ladies Night Out with the Calgary Stampeders. → ___

---

**After grading**, I compute: per-current-bucket regrade rate + direction, the confusion matrix, and a recalibration proposal (measured, not a blind threshold nudge). Watch for the compound case the sample exposes: the Summerland/Bald Range fire is plausibly HIGH/CRITICAL for **Kilbacks** (Okanagan household, in the fire's area) but the *same* fire is attributed to **Petronas Canada** (NE BC, ~700 km away) at CRITICAL — a severity error riding on top of a client-attribution error (ties to WO-CLIENT-THREAT-RELEVANCE / D6 and the geo-anchoring case).
