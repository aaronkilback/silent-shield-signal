#!/usr/bin/env node
// Repeatability acceptance harness for the shared subject-retrieval module (WO-RETRIEVAL-NONDETERMINISM-01
// #5). A $10,000 deliverable cannot return different findings each run. This asserts a KNOWN exposure item
// is present in ALL N consecutive runs — not one. It is what would have caught scan d78b9c43 (phase-1 drift
// dropped the case seed → the case item vanished) before the learned battery made it reproducible.
//
// On-demand only (NOT a blocking CI gate — it invokes the live function N times and spends Serper budget).
// Reads credentials from env; never hard-codes a JWT.
//
//   SUBJECT_RETRIEVAL_URL   (default prod function URL)
//   SERVICE_ROLE_JWT        (required — Authorization: Bearer)
//   SR_SUBJECT_NAME         (default "Aaron Kilback")
//   SR_SUBJECT_ENTITY_ID    (default the Kilback test entity)
//   SR_OWNER_CLIENT_ID      (default the Kilbacks test client)
//   SR_EXPECT_FINGERPRINT   (default "case-kilback-olynyk")
//   SR_EXPECT_DOMAIN        (default "wiselaw" — substring match on a location domain)
//   SR_RUNS                 (default 3)

const URL_ = process.env.SUBJECT_RETRIEVAL_URL || "https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/subject-retrieval";
const JWT = process.env.SERVICE_ROLE_JWT;
const NAME = process.env.SR_SUBJECT_NAME || "Aaron Kilback";
const ENTITY_ID = process.env.SR_SUBJECT_ENTITY_ID || "32750258-6874-44d3-9dbb-721469e1fc4f";
const CLIENT_ID = process.env.SR_OWNER_CLIENT_ID || "d3b200b5-1f85-453e-bdba-f2b7b463f308";
const EXPECT_FP = process.env.SR_EXPECT_FINGERPRINT || "case-kilback-olynyk";
const EXPECT_DOMAIN = process.env.SR_EXPECT_DOMAIN || "wiselaw";
const RUNS = Number(process.env.SR_RUNS || 3);

if (!JWT) { console.error("FAIL: SERVICE_ROLE_JWT env var is required"); process.exit(2); }

const body = JSON.stringify({
  subject: { name: NAME, entityId: ENTITY_ID, anchors: { knownHandles: ["aaronkilback", "AaronKilback", "aaron_kilbackdisrupted"], ownDomains: ["yodelme.com"] } },
  scope: { categories: ["legal"], depth: "standard", phase2: true },
  persist: true, owner: { clientId: CLIENT_ID, entityId: ENTITY_ID },
});

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  const resp = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` }, body });
  const j = await resp.json().catch(() => ({}));
  const r = j.data ?? j; // successResponse wraps in {data}
  const items = [...(r.thirdPartyExposure ?? []), ...(r.selfPublishedExposure ?? [])];
  const caseItem = items.find((it) => it.fingerprint === EXPECT_FP);
  const domainPresent = items.some((it) => (it.locations ?? []).some((l) => (l.domain ?? "").includes(EXPECT_DOMAIN)));
  const ok = !!caseItem && domainPresent;
  runs.push({ run: i, scanId: r.scanId, seeded: r.counts?.learned_terms_seeded, phase1: r.counts?.phase1_verified, phase2: r.counts?.phase2_verified, case_item: !!caseItem, [`${EXPECT_DOMAIN}`]: domainPresent, ok });
  console.log(`run ${i}: scan ${String(r.scanId).slice(0, 8)} | seeded ${r.counts?.learned_terms_seeded} phase1 ${r.counts?.phase1_verified} phase2 ${r.counts?.phase2_verified} | ${EXPECT_FP} ${!!caseItem} ${EXPECT_DOMAIN} ${domainPresent} | ${ok ? "PASS" : "FAIL"}`);
}

const allPass = runs.length === RUNS && runs.every((x) => x.ok);
console.log(`\nREPEATABILITY: ${allPass ? "PASS" : "FAIL"} — "${EXPECT_FP}" present in ${runs.filter((x) => x.ok).length}/${RUNS} runs (acceptance requires ${RUNS}/${RUNS}).`);
process.exit(allPass ? 0 : 1);
